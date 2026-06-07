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

export interface SaveResult {
  ok: boolean
  path?: string
  error?: string
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
  cancel(): void
  pickBootImg(): Promise<string | null>
  saveLog(text: string): Promise<SaveResult>
  onLog(cb: (e: LogEntry) => void): () => void
  onStatus(cb: (s: OpStatus) => void): () => void
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
  done: '已完成',
  error: '出错',
  cancelled: '已取消'
}
