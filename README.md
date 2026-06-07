# N1 OneKey · 斐讯 T1/N1 一键降级图形工具

把原来的命令行批处理（`run.bat` / `U盘启动.BAT`）改造成的**跨平台图形化桌面应用**：现代界面、实时日志、可配置重试、一键操作。

> 技术栈：**Electron + React + TypeScript + Mantine v9 + Vite**（脚手架 electron-vite，打包 electron-builder）。
> 色系：电光青紫暗色玻璃拟态。

## ✨ 功能

- **T1 降级 / N1 降级**：通过网络 ADB 把 `boot.img` 写入盒子 boot 分区（复刻原版 `dd` 流程），写入前**型号二次校验 + 危险确认弹窗**。
- **进入线刷模式**：连接并开启 Root 后让盒子 `reboot update`。
- **U 盘启动**：快速连接后发送 `reboot update`。
- **设备自动识别**：识别斐讯 T1(`q201`) / N1(`p230`)。
- **实时彩色日志**：每一条 adb 命令与输出按级别（命令 / 信息 / 成功 / 警告 / 错误）实时着色，支持自动滚动、复制、保存到文件。
- **可配置重试**：最大次数 / 间隔秒数 / 无限重试（还原原版批处理行为），随时可取消。
- **自定义 boot.img**：可为 T1/N1 各自指定外部镜像，留空用内置。
- **SSH（已刷 OpenWrt 的盒子）**：盒子刷成 OpenWrt 后 ADB 连不上，改用 SSH（`ssh2`，密码默认不保存）。提供「测试连接」与两个 `reboot update` 按钮（进入线刷/更新模式、U 盘启动）。
  > ⚠️ 诚实说明：OpenWrt 下 busybox 的 `reboot update` 会忽略 `update` 参数，**实为普通重启**；之所以能进 U 盘系统是靠斐讯 u-boot 的「USB 优先引导」。真正的 PC 线刷（USB 烧录工具）需短接主板触点，**无法**用此命令触发。

- **升级更新**：内置「升级更新」Tab，启动自动检测 GitHub 最新版本、显示 markdown 更新日志，一键全自动下载 + 静默安装 + 重启（仅 Windows 安装版，sha256 完整性校验）。

## 🖥️ 平台

- 主用 **Windows**（本地可直接打包）。
- **macOS / Linux** 由 GitHub Actions 自动打包。

## 🚀 开发与运行（本地）

前置：Node ≥ 20（已用 22 验证）。Windows 上无需任何额外工具链。

```bash
npm install        # 安装依赖
npm run dev        # 启动开发模式（HMR）
npm run typecheck  # 类型检查
```

## 📦 本地打 Windows 包（安装版 + 便携版）

```bash
npm run build:win
```

产物在 `release/`，一次产出两种：

- **安装版**：`N1 OneKey-<版本>-setup-x64.exe`（NSIS 安装器，可选目录、建快捷方式）
- **便携版**：`N1 OneKey-<版本>-portable-x64.exe`（**免安装，下载后双击即用**，运行时自解压到临时目录）

Windows 所需的 `adb.exe` + DLL 已内置于 `resources/adb/win/`，开箱即用。

## 🤖 GitHub Actions 自动打包（mac / linux / win）

[`.github/workflows/release.yml`](.github/workflows/release.yml) 在 `windows-latest` / `macos-latest(arm64)` /
`ubuntu-latest` 上分别构建（已移除 Intel mac `macos-13`：GitHub 免费 Intel 运行器紧缺常卡队列；现 Mac 多为 Apple Silicon，需 Intel 覆盖可改 `--mac --universal`）。非 Windows 平台先用 [`scripts/fetch-adb.mjs`](scripts/fetch-adb.mjs)
下载官方 platform-tools 的 adb），**无需手动操作**：

- **推送到 `main`（或手动 Run workflow）**：自动构建四平台包，并发布/更新一个滚动的 **`latest` 预发布**——
  在 `Releases → latest` 永远能下到最新的安装版/便携版/dmg/AppImage。
- **推送 `v*` 标签**：发布对应版本号的正式 Release。

```bash
# 日常：直接推代码即自动出包到 latest 预发布
git push

# 想发正式版本时（可选）
git tag v1.0.0 && git push origin v1.0.0
```

## 🗂️ 项目结构

```
src/
  shared/types.ts            三端共享类型与常量（型号关键字、阶段文案、IPC 契约）
  main/                      主进程（Node）
    index.ts                 窗口 + IPC 注册 + 取消控制
    paths.ts                 adb / boot.img 资源路径解析（dev/打包、跨平台）
    adb.ts                   spawn adb，流式读 stdout/stderr，可取消/超时
    flow.ts                  连接·开 root·重试循环·remount·dd 写入 状态机
  preload/index.ts           contextBridge 暴露受控 window.api
  renderer/                  渲染层（React + Mantine）
    src/theme.ts             电光青紫主题
    src/store.ts             zustand 状态（设置持久化 + 日志/运行态）
    src/components/          TitleBar / ConnectionPanel / ActionGrid / LogConsole / ConfirmModal / ProgressOverlay
resources/
  adb/{win,mac,linux}/       各平台 adb（win 已内置；mac/linux 由 CI 下载）
  boot/{t1,n1}/boot.img      内置 boot 镜像（全平台通用）
scripts/fetch-adb.mjs        下载各平台 adb
```

## 🍎 macOS 首次运行（重要）

mac 产物未做 Apple 签名/公证（个人使用定位），从网络下载后会被 Gatekeeper 拦截。首次运行前在终端执行解隔离：

```bash
xattr -dr com.apple.quarantine "/Applications/N1 OneKey.app"
```

内置 adb 已在打包时做 ad-hoc 签名，解隔离后即可正常运行。

## ⚠️ 安全与免责

- 刷写会通过 `dd` 覆盖盒子 `/dev/block/boot`，**刷错型号可能导致无法启动**。本工具已做型号自动识别 + 二次校验 + 确认弹窗，但请务必自行核对。
- 渲染层无 Node 权限（`contextIsolation` 开、`nodeIntegration` 关），adb 仅在主进程执行。
- 刷机流程完全离线；仅「升级更新」会访问 GitHub 检查/下载新版本（不上传任何信息），CI 下载 adb 除外。

## 🙏 致谢

原始命令行工具 `run.bat`（2018, by webpad）与 `U盘启动.BAT`（by KIFEN）。本项目在其逻辑基础上做图形化重制。
