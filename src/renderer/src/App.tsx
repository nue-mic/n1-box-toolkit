import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box, Stack, Tabs, Indicator } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconBrandAndroid, IconTerminal2, IconSparkles } from '@tabler/icons-react'
import { TitleBar } from './components/TitleBar'
import { ConnectionPanel } from './components/ConnectionPanel'
import { ActionGrid, type ActionType } from './components/ActionGrid'
import { SshPanel } from './components/SshPanel'
import { LogConsole } from './components/LogConsole'
import { ProgressOverlay } from './components/ProgressOverlay'
import { ConfirmModal } from './components/ConfirmModal'
import { UpdatePanel } from './components/UpdatePanel'
import { useStore } from './store'
import { useIpcBridge, api } from './ipc'
import type { Model, OpResult, RetrySettings, SshCreds } from '@shared/types'

const ACTION_TITLE: Record<ActionType, string> = {
  'flash-t1': 'T1 降级',
  'flash-n1': 'N1 降级',
  recovery: '进入线刷模式',
  usbboot: 'U 盘启动',
  'ssh-recovery': '进入线刷模式 (SSH)',
  'ssh-usbboot': 'U 盘启动 (SSH)'
}

export default function App() {
  useIpcBridge()

  const settings = useStore((s) => s.settings)
  const running = useStore((s) => s.running)
  const setRunning = useStore((s) => s.setRunning)
  const detected = useStore((s) => s.detected)
  const addLog = useStore((s) => s.addLog)
  const setStatus = useStore((s) => s.setStatus)
  const update = useStore((s) => s.update)
  const setUpdate = useStore((s) => s.setUpdate)

  const [confirmAction, setConfirmAction] = useState<ActionType | null>(null)
  const [tab, setTab] = useState<string | null>('adb')
  const tabScrollRef = useRef<HTMLDivElement>(null)

  // 启动时静默检查更新（失败不打扰用户）
  useEffect(() => {
    api.checkUpdate().then(setUpdate).catch(() => {})
  }, [setUpdate])

  // 切 tab 时重置面板滚动位置，避免从一个长面板（SSH 展开）切到短面板后视野错位。
  // 用 useLayoutEffect 在 paint 前同步置 0，否则会有一帧"旧位置→0"的闪烁。
  useLayoutEffect(() => {
    if (tabScrollRef.current) tabScrollRef.current.scrollTop = 0
  }, [tab])

  const sshPassword = useStore((s) => s.sshPassword)

  const ip = settings.ip.trim()
  const retry: RetrySettings = {
    maxRetries: settings.maxRetries,
    retryIntervalMs: Math.max(1, settings.retryIntervalSec) * 1000,
    infiniteRetry: settings.infiniteRetry,
    skipModelCheck: settings.skipModelCheck
  }
  const sshCreds: SshCreds = { host: ip, port: settings.sshPort, username: settings.sshUser, password: sshPassword }

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
      } else if (type === 'usbboot') {
        result = await api.usbBoot({ ip })
      } else if (type === 'ssh-recovery') {
        result = await api.sshRecovery(sshCreds)
      } else {
        result = await api.sshUsbBoot(sshCreds)
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

      <Box p="md" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {/*
          Tabs 与 LogConsole 用 flex 3:2 共享可用空间；Tab 面板内部自带滚动，
          这样：(1) 大屏时双方按比例增长；(2) 内容过长时只让面板内滚，不挤压日志；
          (3) 没有嵌套滚动 —— LogConsole 自己的 ScrollArea 是兄弟而非父子关系。
        */}
        <Tabs
          value={tab}
          onChange={setTab}
          radius="md"
          style={{
            flex: 3,
            minHeight: 200,
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <Tabs.List style={{ flexShrink: 0 }}>
            <Tabs.Tab value="adb" leftSection={<IconBrandAndroid size={16} />}>
              ADB · 安卓原系统
            </Tabs.Tab>
            <Tabs.Tab value="ssh" leftSection={<IconTerminal2 size={16} />}>
              SSH · 已刷 OpenWrt
            </Tabs.Tab>
            <Tabs.Tab value="update" leftSection={<IconSparkles size={16} />}>
              <Indicator color="grape" size={8} offset={-4} disabled={!update?.hasUpdate} processing>
                升级更新
              </Indicator>
            </Tabs.Tab>
          </Tabs.List>

          {/* 面板滚动区：内容超出时仅此处出现纵向滚动条，不会挤压下方日志 */}
          <Box
            ref={tabScrollRef}
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'hidden'
            }}
          >
            <Tabs.Panel value="adb" pt="md">
              <Stack gap="md">
                <ConnectionPanel />
                <ActionGrid disabled={running} onAction={handleCardClick} />
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="ssh" pt="md">
              <SshPanel disabled={running} onAction={handleCardClick} />
            </Tabs.Panel>

            <Tabs.Panel value="update" pt="md" keepMounted>
              <UpdatePanel />
            </Tabs.Panel>
          </Box>
        </Tabs>

        {running && (
          <Box mt="md" style={{ flexShrink: 0 }}>
            <ProgressOverlay />
          </Box>
        )}

        <Box mt="md" style={{ flex: 2, minHeight: 200, display: 'flex' }}>
          <LogConsole />
        </Box>
      </Box>

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
