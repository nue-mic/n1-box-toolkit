import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  Api,
  FlashPayload,
  RecoveryPayload,
  UsbBootPayload,
  DetectPayload,
  SshCreds,
  LogEntry,
  OpStatus,
  UpdateProgress
} from '@shared/types'

const api: Api = {
  minimize: () => ipcRenderer.send('app:minimize'),
  close: () => ipcRenderer.send('app:close'),
  maximizeToggle: () => ipcRenderer.send('app:maximize-toggle'),

  flash: (p: FlashPayload) => ipcRenderer.invoke('op:flash', p),
  recovery: (p: RecoveryPayload) => ipcRenderer.invoke('op:recovery', p),
  usbBoot: (p: UsbBootPayload) => ipcRenderer.invoke('op:usbBoot', p),
  detect: (p: DetectPayload) => ipcRenderer.invoke('op:detect', p),
  sshTest: (p: SshCreds) => ipcRenderer.invoke('op:sshTest', p),
  sshRecovery: (p: SshCreds) => ipcRenderer.invoke('op:sshRecovery', p),
  sshUsbBoot: (p: SshCreds) => ipcRenderer.invoke('op:sshUsbBoot', p),
  cancel: () => ipcRenderer.send('op:cancel'),

  pickBootImg: () => ipcRenderer.invoke('dialog:pickBootImg'),
  saveLog: (text: string) => ipcRenderer.invoke('log:save', text),

  onLog: (cb: (e: LogEntry) => void) => {
    const handler = (_e: IpcRendererEvent, data: LogEntry) => cb(data)
    ipcRenderer.on('op:log', handler)
    return () => ipcRenderer.removeListener('op:log', handler)
  },
  onStatus: (cb: (s: OpStatus) => void) => {
    const handler = (_e: IpcRendererEvent, data: OpStatus) => cb(data)
    ipcRenderer.on('op:status', handler)
    return () => ipcRenderer.removeListener('op:status', handler)
  },

  getAppVersion: () => ipcRenderer.invoke('app:version'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  onUpdateProgress: (cb: (p: UpdateProgress) => void) => {
    const handler = (_e: IpcRendererEvent, data: UpdateProgress) => cb(data)
    ipcRenderer.on('update:progress', handler)
    return () => ipcRenderer.removeListener('update:progress', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
