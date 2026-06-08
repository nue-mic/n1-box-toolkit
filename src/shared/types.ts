// 主进程、preload、渲染层三方共享的类型与常量

export type Model = 't1' | 'n1'
export type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'cmd'

export type Phase =
  | 'idle'
  | 'connecting'
  | 'rooting'
  | 'retrying'
  | 'remount'
  | 'verifying'
  | 'pushing'
  | 'writing'
  | 'rebooting'
  | 'recovery'
  | 'usbboot'
  | 'sshconnecting'
  | 'sshexec'
  | 'done'
  | 'error'
  | 'cancelled'

export interface LogEntry {
  id?: number
  ts: number
  level: LogLevel
  text: string
}

export interface OpStatus {
  phase: Phase
  model?: Model
  attempt?: number
  maxAttempts?: number | null
  message?: string
}

export interface RetrySettings {
  maxRetries: number
  retryIntervalMs: number
  infiniteRetry: boolean
  /** 跳过型号(q201/p230)校验，强制刷写——用于已刷第三方系统、型号识别失败但确知机型时 */
  skipModelCheck: boolean
}

export interface FlashPayload {
  ip: string
  model: Model
  settings: RetrySettings
  customBootImg?: string | null
}

export interface RecoveryPayload {
  ip: string
  settings: RetrySettings
}

export interface UsbBootPayload {
  ip: string
}

export interface DetectPayload {
  ip: string
}

// ===== SSH（已刷 OpenWrt 的盒子）=====
export type SshAction = 'recovery' | 'usbboot'

export interface SshCreds {
  host: string
  port: number
  username: string
  password: string
}

export interface SshTestResult {
  ok: boolean
  info?: string
  error?: string
}

export interface DetectResult {
  ok: boolean
  model: Model | 'unknown'
  raw: string
  error?: string
}

export interface OpResult {
  ok: boolean
  error?: string
  cancelled?: boolean
}

// ===== 升级更新（electron-updater + 自建 Release 代理）=====
export interface UpdateAsset {
  /** 资产文件名，如 N1 OneKey-1.0.9-setup-x64.exe */
  name: string
  /** 浏览器下载直链（经代理，含令牌） */
  url: string
  /** 字节数 */
  size: number
  /** latest.yml 给出的 sha512（base64），electron-updater 用它对比下载内容；无则未启用专业更新机制 */
  sha512?: string
}

export interface UpdateInfo {
  /** 检查是否成功（网络/解析成功）；false 时看 error */
  ok: boolean
  /** 当前运行版本（app.getVersion） */
  current: string
  /** 线上最新版本（去掉 v 前缀） */
  latest?: string
  /** 是否有可用更新（latest > current） */
  hasUpdate: boolean
  /** 最新版的 changelog（markdown，来自 release body） */
  notes?: string
  /** 当前平台对应的安装包资产（Windows = setup.exe） */
  asset?: UpdateAsset
  /** 检查失败时的错误信息 */
  error?: string
}

export interface UpdateProgress {
  /** 0~100 */
  percent: number
  /** 已下载字节 */
  transferred: number
  /** 总字节 */
  total: number
}

export interface SaveResult {
  ok: boolean
  path?: string
  error?: string
}

// ===== 电脑端烧录工具（USB Burning Tool） =====
export interface BurningTool {
  /** 唯一 id (内部用) */
  id: string
  /** 展示给用户的版本标签，如 "v2.2.0" */
  label: string
  /** 是否标记为"推荐"（在 UI 上加突出徽章） */
  recommended: boolean
  /** 适用机型一句话描述，如 "N1 / T1 推荐" */
  forBoxes: string
  /** 完整说明，UI 显示在卡片描述区 */
  description: string
  /** 资产文件名 (用于显示 + 默认保存名) */
  fileName: string
  /** 文件字节数 */
  size: number
}

export interface BurningToolProgress {
  toolId: string
  /** 0~100 */
  percent: number
  transferred: number
  total: number
  /** 写入目标路径，UI 完成后用它"在文件夹中显示" */
  path: string
}

export interface BurningToolDownloadResult {
  ok: boolean
  path?: string
  size?: number
  error?: string
  cancelled?: boolean
}

// preload 通过 contextBridge 暴露给渲染层的受控 API
export interface Api {
  minimize(): void
  close(): void
  maximizeToggle(): void
  flash(p: FlashPayload): Promise<OpResult>
  recovery(p: RecoveryPayload): Promise<OpResult>
  usbBoot(p: UsbBootPayload): Promise<OpResult>
  detect(p: DetectPayload): Promise<DetectResult>
  sshTest(p: SshCreds): Promise<SshTestResult>
  sshRecovery(p: SshCreds): Promise<OpResult>
  sshUsbBoot(p: SshCreds): Promise<OpResult>
  cancel(): void
  pickBootImg(): Promise<string | null>
  saveLog(text: string): Promise<SaveResult>
  onLog(cb: (e: LogEntry) => void): () => void
  onStatus(cb: (s: OpStatus) => void): () => void

  // 应用信息
  getAppVersion(): Promise<string>

  // 升级更新
  checkUpdate(): Promise<UpdateInfo>
  downloadUpdate(): Promise<OpResult>
  onUpdateProgress(cb: (p: UpdateProgress) => void): () => void

  // 电脑端烧录工具下载
  listBurningTools(): Promise<BurningTool[]>
  downloadBurningTool(toolId: string): Promise<BurningToolDownloadResult>
  revealBurningTool(filePath: string): void
  onBurningToolProgress(cb: (p: BurningToolProgress) => void): () => void
}

// 型号 → adb devices -l 输出中用于识别的关键字
export const MODEL_TAG: Record<Model, string> = { t1: 'q201', n1: 'p230' }

export const MODEL_LABEL: Record<Model, string> = { t1: 'T1 (q201)', n1: 'N1 (p230)' }

export const PHASE_LABEL: Record<Phase, string> = {
  idle: '空闲',
  connecting: '正在连接盒子',
  rooting: '开启 Root 权限',
  retrying: '等待盒子重连',
  remount: '重新挂载分区',
  verifying: '校验设备型号',
  pushing: '推送 boot 镜像',
  writing: '写入 boot 分区',
  rebooting: '重启盒子',
  recovery: '进入线刷模式',
  usbboot: '进入 U 盘启动',
  sshconnecting: 'SSH 连接中',
  sshexec: 'SSH 执行命令',
  done: '已完成',
  error: '出错',
  cancelled: '已取消'
}
