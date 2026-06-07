import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { LogEntry, OpStatus, Model, UpdateInfo } from '@shared/types'

let logSeq = 0
const MAX_LOGS = 2000

export interface Settings {
  ip: string
  maxRetries: number
  retryIntervalSec: number
  infiniteRetry: boolean
  skipModelCheck: boolean
  customBootImg: Record<Model, string | null>
  // SSH（已刷 OpenWrt）——端口/用户名持久化，密码不持久化（见下方 sshPassword）
  sshPort: number
  sshUser: string
}

interface AppState {
  // 设置（持久化）
  settings: Settings
  setSettings: (patch: Partial<Settings>) => void
  setCustomBootImg: (model: Model, path: string | null) => void

  // 日志（瞬态）
  logs: LogEntry[]
  addLog: (e: LogEntry) => void
  clearLogs: () => void
  autoScroll: boolean
  setAutoScroll: (b: boolean) => void

  // 运行状态（瞬态）
  status: OpStatus
  setStatus: (s: OpStatus) => void
  running: boolean
  setRunning: (b: boolean) => void
  detected: Model | 'unknown' | null
  setDetected: (m: Model | 'unknown' | null) => void
  // adb 是否在线（连接成功，瞬态）
  online: boolean
  setOnline: (b: boolean) => void

  // SSH 密码（瞬态，不持久化）
  sshPassword: string
  setSshPassword: (p: string) => void

  // 升级更新（瞬态）
  update: UpdateInfo | null
  setUpdate: (u: UpdateInfo | null) => void
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      settings: {
        ip: '',
        // 原 run.bat :second 为无限重连；这里默认给较宽的 40 次(约 2 分钟)兼容 root 生效慢的盒子，可在设置里开“无限重试”
        maxRetries: 40,
        retryIntervalSec: 3,
        infiniteRetry: false,
        skipModelCheck: false,
        customBootImg: { t1: null, n1: null },
        sshPort: 22,
        sshUser: 'root'
      },
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setCustomBootImg: (model, path) =>
        set((s) => ({ settings: { ...s.settings, customBootImg: { ...s.settings.customBootImg, [model]: path } } })),

      logs: [],
      addLog: (e) =>
        set((s) => {
          const next = [...s.logs, { ...e, id: ++logSeq }]
          if (next.length > MAX_LOGS) next.splice(0, next.length - MAX_LOGS)
          return { logs: next }
        }),
      clearLogs: () => set({ logs: [] }),
      autoScroll: true,
      setAutoScroll: (b) => set({ autoScroll: b }),

      status: { phase: 'idle' },
      setStatus: (status) => set({ status }),
      running: false,
      setRunning: (running) => set({ running }),
      detected: null,
      setDetected: (detected) => set({ detected }),
      online: false,
      setOnline: (online) => set({ online }),
      sshPassword: 'admin@local',
      setSshPassword: (sshPassword) => set({ sshPassword }),
      update: null,
      setUpdate: (update) => set({ update })
    }),
    {
      name: 'n1-onekey-settings',
      storage: createJSONStorage(() => localStorage),
      // 仅持久化设置与自动滚动开关，日志/运行状态不持久化
      partialize: (s) => ({ settings: s.settings, autoScroll: s.autoScroll })
    }
  )
)
