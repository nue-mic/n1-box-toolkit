# 设计文档 · 应用内「升级更新」功能

> 日期：2026-06-08 ｜ 状态：已实现

## 目标
在应用内新增「升级更新」Tab：判断当前版本、联网检测 GitHub 最新版本、对比后展示 markdown 更新日志，并支持一键全自动更新（下载 → 校验 → 关闭自身 → 静默安装 → 重启新版）。

## 关键决策（已确认）
| 项 | 决策 | 理由 |
|---|---|---|
| 技术路线 | 自研轻量更新（GitHub Releases API） | 适配现有 softprops 发布流（无需 latest.yml），改动小、可控 |
| 分发形式 | 安装版 setup.exe 为主 | nsis 支持覆盖安装，全自动最顺 |
| 检测时机 | 启动自动检查 + 可手动 | 体验好，失败不打扰 |
| 平台 | 仅 Windows（先） | 主用平台；mac/linux 留接口 |
| 完整性校验 | sha256（GitHub 资产 digest） | 防损坏/篡改 |

## 架构

### 主进程 `src/main/updater.ts`
- `checkUpdate()`：`GET /repos/mia-clark/n1-box-toolkit/releases/latest`（带 User-Agent）→ 解析 `tag_name`/`body`/`assets`；挑 `*-setup-*.exe`，从 `asset.digest`（`sha256:...`）取 sha256；与 `app.getVersion()` 做 semver 比较 → 返回 `UpdateInfo`。
- `downloadUpdate(onProgress)`：重新取资产 → `net.fetch` 流式下载到 temp（边下边算 sha256、回调进度）→ 校验 → 写 helper 批处理 → `spawn(detached).unref()` → `app.quit()`。
  - 守卫：非 Windows / 非打包（`!app.isPackaged`）直接返回提示。
- helper 批处理：`轮询当前 PID 退出 → setup.exe /S 静默安装（覆盖同目录）→ start 新版（路径 = 覆盖前 execPath）→ 自删`。

### IPC（`src/main/index.ts` + `src/preload/index.ts`）
- `update:check` (invoke) → `UpdateInfo`
- `update:download` (invoke) → `OpResult`
- `update:progress` (event) → `UpdateProgress`

### 渲染层
- `store.ts`：新增瞬态 `update: UpdateInfo | null`。
- `App.tsx`：第 3 个 Tab「升级更新」（`Indicator` 红点=有更新）；启动 `useEffect` 静默 `checkUpdate`。
- `components/UpdatePanel.tsx`：当前版本、检查按钮、最新版本 + changelog（`react-markdown` + `remark-gfm`，`Typography` 美化、`ScrollArea` 滚动、链接 `target=_blank` 走系统浏览器）、一键更新按钮、下载进度条。

### 共享类型（`src/shared/types.ts`）
`UpdateAsset` / `UpdateInfo` / `UpdateProgress`，`Api` 加 `checkUpdate` / `downloadUpdate` / `onUpdateProgress`。

## 数据流
启动 → 渲染层 `checkUpdate` → 主进程请求 GitHub → 返回 `UpdateInfo` → Tab 红点 + 面板展示 → 用户点「一键更新」→ 主进程下载（进度事件流式回传）→ 校验 → spawn helper → `app.quit()` → helper 静默安装并重启新版。

## 错误处理
- 无网/API 限流/解析失败：面板提示，**不影响刷机主功能**。
- 下载中断 / sha256 不匹配：中止并提示，不启动安装。
- dev 模式 / 非 Windows：一键更新返回明确提示，不执行。

## 依赖
新增 `react-markdown` + `remark-gfm`（渲染 changelog）。

## 取舍与已知限制
- 「零点击全自动」依赖 helper 脚本（等退出→静默装→重启），略 hack 但成熟可靠。
- 仅 Windows 安装版可全自动；便携版/其他平台后续扩展。
- 版本号来源为 CI 自增（每次推 main +1），`releases/latest`（make_latest）为对比基准。
