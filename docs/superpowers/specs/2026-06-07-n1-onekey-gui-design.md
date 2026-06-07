# N1 OneKey · 斐讯 T1/N1 一键降级图形工具 — 设计文档

- 日期：2026-06-07
- 状态：已确认（用户授权直接实现）

## 1. 背景与目标

把原有的命令行批处理工具（`run.bat` + `U盘启动.BAT`）改造成**跨平台图形化桌面应用**：

- 主用 Windows，同时支持 macOS / Linux
- 高大上、好看（现代 UI + 玻璃拟态 + 渐变色系）
- **实时日志输出**
- **支持重试**（可配置次数 / 间隔 / 无限重试）
- 本地打 Windows 包，其它平台由 GitHub Actions 打包

## 2. 原系统逻辑（被复刻的对象）

`run.bat`（斐讯 T1/N1 官方系统 boot 分区降级工具）：

1. 通过网络 ADB 连接盒子（T1 型号 `q201` / N1 型号 `p230`）
2. 三大功能：T1 降级 / N1 降级 / 进入线刷模式
3. 流程：`adb connect` → 校验型号 → 开 root(`setprop service.phiadb.root 1`) → **循环重试连接**(原 `:second` 标签，每 3s 重连) → `remount` → `push boot.img` → `dd` 写入 `/dev/block/boot` → `reboot`
4. `U盘启动.BAT`：连接后 `adb shell reboot update` 进入 recovery

依赖：`adb` + Windows DLL + `t1/boot.img`、`n1/boot.img`、`fastboot`。

## 3. 技术栈（已定）

- **Electron 42** + **React 19** + **TypeScript** + **Mantine v9**（UI 库）+ **Vite 8**
- 脚手架 **electron-vite 5**，打包 **electron-builder 26**
- 状态管理 **zustand 5**，图标 **@tabler/icons-react**
- 色系方案 **A 电光青紫**（深石板近黑底 + 青→紫渐变强调）

## 4. 架构

```
Renderer (React+Mantine)  ──invoke──▶  Main (Node)  ──spawn──▶  adb (sidecar) / boot.img
        ▲                                   │
        └────── 事件(实时日志/状态) ──────────┘
   preload(contextBridge, contextIsolation) 暴露受控 window.api
```

- **主进程**：`paths.ts`(资源路径) / `adb.ts`(spawn adb，流式读 stdout/stderr) / `flow.ts`(连接·重试·刷写状态机，可取消) / `index.ts`(窗口·IPC)
- **preload**：经 `contextBridge` 暴露 `window.api`，`contextIsolation:true`、`nodeIntegration:false`
- **渲染层**：TitleBar / ConnectionPanel / ActionGrid(4 卡片) / LogConsole / ConfirmModal / ProgressOverlay

## 5. IPC 契约

- 渲染→主(invoke)：`op:flash` `op:recovery` `op:usbBoot` `op:detect`；(send)`op:cancel` `app:minimize/close/maximize-toggle`；`dialog:pickBootImg` `log:save`
- 主→渲染(send)：`op:log`(每行日志 {ts,level,text}) / `op:status`({phase,model?,attempt?,maxAttempts?})

## 6. 核心流程（严格复刻 run.bat，状态机化）

降级：`kill-server`→`connect`→`devices -l`(识别+校验型号)→`setprop ...root 1`×2→`kill-server`→**重试循环**(可配置/无限)→`remount`→型号二次校验→危险确认→`push boot.img`→`dd of=/dev/block/boot`→`rm`→`reboot`。
线刷：完整 root 准备后 `reboot update`。U盘启动：快速连接后 `shell reboot update`。
取消：每步之间检查 AbortSignal，取消即杀子进程。

## 7. 跨平台 adb 与打包

- adb 按平台放 `resources/adb/{win,mac,linux}/`；Win 复用现成 `adb.exe`+DLL，mac/linux 由 `scripts/fetch-adb.mjs` 下载官方 platform-tools
- `boot.img` 放 `resources/boot/{t1,n1}/`，全平台通用
- electron-builder 每平台用 `extraResources` 打入 `adb`、`boot`
- 本地：`npm run build:win`；CI：`.github/workflows/release.yml` 矩阵跑 win/mac/linux，推 tag 出 Release

## 8. 安全

- `contextIsolation` 开、`nodeIntegration` 关、`sandbox:false`(仅供 preload 用 ipcRenderer)
- adb 只在主进程执行，渲染层无 Node 能力
- 危险写入操作前型号二次校验 + 确认弹窗
- 离线本地工具，不加载任何远程资源
