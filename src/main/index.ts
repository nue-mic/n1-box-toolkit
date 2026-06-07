import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import type {
  FlashPayload,
  RecoveryPayload,
  UsbBootPayload,
  DetectPayload,
  LogEntry,
  LogLevel,
  OpStatus,
  OpResult,
  DetectResult,
  SaveResult,
  SshCreds,
  SshTestResult
} from '@shared/types'
import { runFlash, runRecovery, runUsbBoot, detectDevice, CancelledError, FlowError, type Ctx } from './flow'
import { runSshTest, runSshRecovery, runSshUsbBoot } from './ssh'

let mainWindow: BrowserWindow | null = null
let currentAbort: AbortController | null = null

/** 仅允许 http/https/mailto 交由系统浏览器打开 */
function isSafeExternal(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:'
  } catch {
    return false
  }
}

/** 主窗口仅允许导航到本地内容：dev 为开发服务器同源，prod 为 file: */
function isAllowedNavigation(url: string): boolean {
  try {
    const u = new URL(url)
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl) return u.origin === new URL(devUrl).origin
    return u.protocol === 'file:'
  } catch {
    return false
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 940,
    minHeight: 660,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0b0e14',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // 仅允许 http/https/mailto 外链交系统浏览器打开，其余(file:/smb:/自定义协议等)一律拒绝
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // 限制主窗口导航：仅允许本地内容(dev 为 devServer 同源，prod 为 file:)
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!isAllowedNavigation(url)) e.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function emitLog(level: LogLevel, text: string): void {
  const entry: LogEntry = { ts: Date.now(), level, text }
  mainWindow?.webContents.send('op:log', entry)
}

function emitStatus(s: OpStatus): void {
  mainWindow?.webContents.send('op:status', s)
}

/** 串行执行一个操作：保证同时只有一个流程在跑，统一处理取消/错误 */
async function withOp(fn: (ctx: Ctx) => Promise<void>): Promise<OpResult> {
  if (currentAbort) {
    return { ok: false, error: '已有任务正在执行，请先取消或等待完成。' }
  }
  currentAbort = new AbortController()
  const ctx: Ctx = { signal: currentAbort.signal, emitLog, emitStatus }
  try {
    await fn(ctx)
    return { ok: true }
  } catch (err) {
    if (err instanceof CancelledError) {
      emitStatus({ phase: 'cancelled' })
      emitLog('warn', '操作已取消。')
      return { ok: false, cancelled: true }
    }
    const msg = err instanceof FlowError ? err.message : err instanceof Error ? err.message : String(err)
    emitStatus({ phase: 'error', message: msg })
    emitLog('error', msg)
    return { ok: false, error: msg }
  } finally {
    currentAbort = null
  }
}

function registerIpc(): void {
  // 窗口控制
  ipcMain.on('app:minimize', () => mainWindow?.minimize())
  ipcMain.on('app:close', () => mainWindow?.close())
  ipcMain.on('app:maximize-toggle', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })

  // 业务操作
  ipcMain.handle('op:flash', (_e, p: FlashPayload): Promise<OpResult> => withOp((ctx) => runFlash(p, ctx)))
  ipcMain.handle('op:recovery', (_e, p: RecoveryPayload): Promise<OpResult> => withOp((ctx) => runRecovery(p, ctx)))
  ipcMain.handle('op:usbBoot', (_e, p: UsbBootPayload): Promise<OpResult> => withOp((ctx) => runUsbBoot(p, ctx)))

  ipcMain.handle('op:detect', async (_e, p: DetectPayload): Promise<DetectResult> => {
    if (currentAbort) return { ok: false, model: 'unknown', raw: '', error: '有任务正在执行，无法同时检测。' }
    // 纳入 currentAbort：与刷写双向互斥，且可被“取消”中断
    currentAbort = new AbortController()
    const ctx: Ctx = { signal: currentAbort.signal, emitLog, emitStatus }
    try {
      return await detectDevice(p, ctx)
    } catch (err) {
      if (err instanceof CancelledError) {
        emitStatus({ phase: 'cancelled' })
        emitLog('warn', '检测已取消。')
        return { ok: false, model: 'unknown', raw: '', error: '已取消' }
      }
      const msg = err instanceof Error ? err.message : String(err)
      emitLog('error', msg)
      emitStatus({ phase: 'idle' })
      return { ok: false, model: 'unknown', raw: '', error: msg }
    } finally {
      currentAbort = null
    }
  })

  // SSH（已刷 OpenWrt 的盒子）
  ipcMain.handle('op:sshRecovery', (_e, p: SshCreds): Promise<OpResult> => withOp((ctx) => runSshRecovery(p, ctx)))
  ipcMain.handle('op:sshUsbBoot', (_e, p: SshCreds): Promise<OpResult> => withOp((ctx) => runSshUsbBoot(p, ctx)))
  ipcMain.handle('op:sshTest', async (_e, p: SshCreds): Promise<SshTestResult> => {
    if (currentAbort) return { ok: false, error: '有任务正在执行，无法同时测试。' }
    currentAbort = new AbortController()
    const ctx: Ctx = { signal: currentAbort.signal, emitLog, emitStatus }
    try {
      const r = await runSshTest(p, ctx)
      return { ok: true, info: r.info }
    } catch (err) {
      if (err instanceof CancelledError) {
        emitStatus({ phase: 'cancelled' })
        emitLog('warn', 'SSH 测试已取消。')
        return { ok: false, error: '已取消' }
      }
      const msg = err instanceof Error ? err.message : String(err)
      emitLog('error', msg)
      emitStatus({ phase: 'idle' })
      return { ok: false, error: msg }
    } finally {
      currentAbort = null
    }
  })

  ipcMain.on('op:cancel', () => currentAbort?.abort())

  // 选择自定义 boot.img
  ipcMain.handle('dialog:pickBootImg', async (): Promise<string | null> => {
    if (!mainWindow) return null
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择自定义 boot.img',
      filters: [
        { name: 'Boot Image', extensions: ['img'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
  })

  // 保存日志
  ipcMain.handle('log:save', async (_e, text: string): Promise<SaveResult> => {
    if (!mainWindow) return { ok: false }
    const r = await dialog.showSaveDialog(mainWindow, {
      title: '保存日志',
      defaultPath: `n1-onekey-log-${Date.now()}.txt`,
      filters: [{ name: '文本文件', extensions: ['txt'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false }
    try {
      await fs.writeFile(r.filePath, text, 'utf-8')
      return { ok: true, path: r.filePath }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

// 单实例
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    registerIpc()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
