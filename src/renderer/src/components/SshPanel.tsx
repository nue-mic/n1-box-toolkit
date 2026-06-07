import { useState } from 'react'
import { Paper, Stack, Group, Text, Badge, TextInput, PasswordInput, NumberInput, Button, SimpleGrid, Alert } from '@mantine/core'
import { IconTerminal, IconPlugConnected, IconReload, IconUsb, IconInfoCircle } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { ActionCard } from './ActionCard'
import type { ActionType } from './ActionGrid'
import { useStore } from '../store'
import { api } from '../ipc'

interface Props {
  disabled?: boolean
  onAction: (type: ActionType) => void
}

export function SshPanel({ disabled, onAction }: Props) {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const sshPassword = useStore((s) => s.sshPassword)
  const setSshPassword = useStore((s) => s.setSshPassword)
  const running = useStore((s) => s.running)
  const [testing, setTesting] = useState(false)

  const ip = settings.ip.trim()

  const onTest = async () => {
    if (!ip) {
      notifications.show({ color: 'red', title: '缺少 IP', message: '请先在上方填写盒子的 IP 地址。' })
      return
    }
    setTesting(true)
    try {
      const r = await api.sshTest({ host: ip, port: settings.sshPort, username: settings.sshUser, password: sshPassword })
      if (r.ok) notifications.show({ color: 'teal', title: 'SSH 连接成功', message: r.info || '已连接', autoClose: 4000 })
      else notifications.show({ color: 'red', title: 'SSH 连接失败', message: r.error || '失败', autoClose: 6000 })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Paper className="glass" radius="lg" p="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Group gap="xs">
            <IconTerminal size={18} color="var(--mantine-color-teal-4)" />
            <Text fw={700}>SSH · 已刷 OpenWrt 的盒子</Text>
            <Badge color="teal" variant="light">
              SSH
            </Badge>
          </Group>
        </Group>

        <Alert color="yellow" variant="light" icon={<IconInfoCircle size={16} />} p="xs">
          盒子刷成 OpenWrt 后 ADB 连不上，改用 SSH。注意：OpenWrt 下 <b>reboot update</b> 实为普通重启 + u-boot 的 U 盘优先引导；
          真正的 PC 线刷（USB 烧录工具）需短接主板触点，无法用此命令触发。
        </Alert>

        <Group align="flex-end" gap="sm" wrap="wrap">
          <NumberInput
            label="端口"
            w={96}
            min={1}
            max={65535}
            disabled={running}
            value={settings.sshPort}
            onChange={(v) => setSettings({ sshPort: typeof v === 'number' ? v : 22 })}
          />
          <TextInput
            label="用户名"
            w={130}
            disabled={running}
            value={settings.sshUser}
            onChange={(e) => setSettings({ sshUser: e.currentTarget.value })}
          />
          <PasswordInput
            label="密码（OpenWrt 首启可空 · 不保存）"
            style={{ flex: 1, minWidth: 200 }}
            disabled={running}
            value={sshPassword}
            placeholder="留空 = 空密码"
            onChange={(e) => setSshPassword(e.currentTarget.value)}
          />
          <Button
            leftSection={<IconPlugConnected size={16} />}
            variant="light"
            color="teal"
            loading={testing}
            disabled={running}
            onClick={onTest}
          >
            测试连接
          </Button>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <ActionCard
            icon={<IconReload size={26} />}
            title="进入线刷模式 (SSH)"
            description="SSH 执行 reboot update。插好已写镜像的 U 盘 → 重启后从 U 盘启动；不插 → 回原系统/recovery。"
            color="teal"
            disabled={disabled}
            onClick={() => onAction('ssh-recovery')}
          />
          <ActionCard
            icon={<IconUsb size={26} />}
            title="U 盘启动 (SSH)"
            description="SSH 执行 reboot update。需先插好含引导文件的 U 盘，盒子重启后优先从 U 盘引导。"
            color="cyan"
            disabled={disabled}
            onClick={() => onAction('ssh-usbboot')}
          />
        </SimpleGrid>
      </Stack>
    </Paper>
  )
}
