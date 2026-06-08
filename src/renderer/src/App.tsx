import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box, Stack, Tabs, Indicator } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconBrandAndroid, IconTerminal2, IconSparkles, IconUsb } from '@tabler/icons-react'
import { TitleBar } from './components/TitleBar'
import { ConnectionPanel } from './components/ConnectionPanel'
import { ActionGrid, type ActionType } from './components/ActionGrid'
import { SshPanel } from './components/SshPanel'
import { LogConsole } from './components/LogConsole'
import { ProgressOverlay } from './components/ProgressOverlay'
import { ConfirmModal } from './components/ConfirmModal'
import { UpdatePanel } from './components/UpdatePanel'
import { BurningToolTab } from './components/BurningToolTab'
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
  const mainScrollRef = useRef<HTMLDivElement>(null)

  // 启动时静默检查更新（失败不打扰用户）
  useEffect(() => {
    api.checkUpdate().then(setUpdate).catch(() => {})
  }, [setUpdate])

  // 切 tab 时把主滚动容器归零，避免从一个长 Tab（SSH 展开 + 长日志）切到短 Tab 后视野悬在底部。
  // 用 useLayoutEffect 在 paint 前同步置 0，消除一帧"旧位置→0"的闪烁。
  useLayoutEffect(() => {
    if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0
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

      {/*
        统一的主滚动容器 —— 所有元素（Tab 面板 + ProgressOverlay + LogConsole）共享同一条滚动条。
        设计目标：
        (1) 窗口空间够时，内层 flex column 撑满到 100% 视口，LogConsole 包装层 flex:1 吃掉剩余空间，
            页面无滚动条；用户拖大窗口，LogConsole 跟着变高（响应式）。
        (2) 窗口空间不够时，内层内容自然撑高超出视口，主滚动条出现；用户滚一条统一的滚动条就能看
            到所有元素，包括日志区。
        (3) 每个关键元素都有 minHeight 保底，永不被压扁到 0。
        (4) 没有嵌套滚动 —— LogConsole 内部已去掉 ScrollArea，autoScroll 通过 scrollIntoView
            驱动主滚动容器。
      */}
      <Box
        ref={mainScrollRef}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}
      >
        <Box
          p="md"
          style={{
            minHeight: '100%',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <Tabs value={tab} onChange={setTab} radius="md" style={{ flexShrink: 0 }}>
            <Tabs.List>
              <Tabs.Tab value="adb" leftSection={<IconBrandAndroid size={16} />}>
                ADB · 安卓原系统
              </Tabs.Tab>
              <Tabs.Tab value="ssh" leftSection={<IconTerminal2 size={16} />}>
                SSH · 已刷 OpenWrt
              </Tabs.Tab>
              <Tabs.Tab value="burning" leftSection={<IconUsb size={16} />}>
                电脑端烧录工具
              </Tabs.Tab>
              <Tabs.Tab value="update" leftSection={<IconSparkles size={16} />}>
                <Indicator color="grape" size={8} offset={-4} disabled={!update?.hasUpdate} processing>
                  升级更新
                </Indicator>
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="adb" pt="md">
              <Stack gap="md">
                <ConnectionPanel />
                <ActionGrid disabled={running} onAction={handleCardClick} />
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="ssh" pt="md">
              <SshPanel disabled={running} onAction={handleCardClick} />
            </Tabs.Panel>

            <Tabs.Panel value="burning" pt="md" keepMounted>
              <BurningToolTab />
            </Tabs.Panel>

            <Tabs.Panel value="update" pt="md" keepMounted>
              <UpdatePanel />
            </Tabs.Panel>
          </Tabs>

          {running && (
            <Box mt="md" style={{ flexShrink: 0 }}>
              <ProgressOverlay />
            </Box>
          )}

          {/*
            LogConsole 包装层：flex:1 让其在空间充裕时撑满剩余视口高度（响应式），
            minHeight:220 保证拥挤时不被压扁；同时把 SshPanel 默认折叠后，
            1600x1000 大窗口下日志区能真正吃掉 ≥500px 剩余空间不再触发主滚动。
          */}
          <Box mt="md" style={{ flex: 1, minHeight: 220, display: 'flex' }}>
            <LogConsole />
          </Box>
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
