import { useState } from 'react'
import { Box, Stack } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { TitleBar } from './components/TitleBar'
import { ConnectionPanel } from './components/ConnectionPanel'
import { ActionGrid, type ActionType } from './components/ActionGrid'
import { LogConsole } from './components/LogConsole'
import { ProgressOverlay } from './components/ProgressOverlay'
import { ConfirmModal } from './components/ConfirmModal'
import { useStore } from './store'
import { useIpcBridge, api } from './ipc'
import type { Model, OpResult, RetrySettings } from '@shared/types'

const ACTION_TITLE: Record<ActionType, string> = {
  'flash-t1': 'T1 降级',
  'flash-n1': 'N1 降级',
  recovery: '进入线刷模式',
  usbboot: 'U 盘启动'
}

export default function App() {
  useIpcBridge()

  const settings = useStore((s) => s.settings)
  const running = useStore((s) => s.running)
  const setRunning = useStore((s) => s.setRunning)
  const detected = useStore((s) => s.detected)
  const addLog = useStore((s) => s.addLog)
  const setStatus = useStore((s) => s.setStatus)

  const [confirmAction, setConfirmAction] = useState<ActionType | null>(null)

  const ip = settings.ip.trim()
  const retry: RetrySettings = {
    maxRetries: settings.maxRetries,
    retryIntervalMs: Math.max(1, settings.retryIntervalSec) * 1000,
    infiniteRetry: settings.infiniteRetry
  }

  const handleCardClick = (type: ActionType) => {
    if (!ip) {
      notifications.show({ color: 'red', title: '缺少 IP', message: '请先填写盒子的 IP 地址。' })
      return
    }
    setConfirmAction(type)
  }

  const runAction = async (type: ActionType) => {
    setRunning(true)
    setStatus({ phase: 'connecting' })
    addLog({ ts: Date.now(), level: 'cmd', text: `===== 开始：${ACTION_TITLE[type]} (IP ${ip}) =====` })

    let result: OpResult
    try {
      if (type === 'flash-t1' || type === 'flash-n1') {
        const model: Model = type === 'flash-t1' ? 't1' : 'n1'
        result = await api.flash({ ip, model, settings: retry, customBootImg: settings.customBootImg[model] })
      } else if (type === 'recovery') {
        result = await api.recovery({ ip, settings: retry })
      } else {
        result = await api.usbBoot({ ip })
      }
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      setRunning(false)
    }

    if (result.ok) {
      notifications.show({ color: 'teal', title: '完成', message: `${ACTION_TITLE[type]} 执行成功。` })
    } else if (result.cancelled) {
      notifications.show({ color: 'gray', title: '已取消', message: `${ACTION_TITLE[type]} 已被取消。` })
    } else {
      notifications.show({ color: 'red', title: '失败', message: result.error || '执行失败，详见日志。', autoClose: 6000 })
    }
  }

  const onConfirm = () => {
    const action = confirmAction
    setConfirmAction(null)
    if (action) void runAction(action)
  }

  return (
    <Box style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TitleBar />
      <Stack gap="md" p="md" style={{ flex: 1, minHeight: 0 }}>
        <ConnectionPanel />
        <ActionGrid disabled={running} onAction={handleCardClick} />
        {running && <ProgressOverlay />}
        <LogConsole />
      </Stack>

      <ConfirmModal
        opened={confirmAction !== null}
        action={confirmAction}
        ip={ip}
        detected={detected}
        onConfirm={onConfirm}
        onCancel={() => setConfirmAction(null)}
      />
    </Box>
  )
}
