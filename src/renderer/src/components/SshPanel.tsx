import { useState } from 'react'
import { Paper, Stack, Group, Text, TextInput, PasswordInput, NumberInput, Button, SimpleGrid, Alert, Accordion, List } from '@mantine/core'
import { IconPlugConnected, IconReload, IconUsb, IconInfoCircle, IconListNumbers } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { ActionCard } from './ActionCard'
import type { ActionType } from './ActionGrid'
import { useStore } from '../store'
import { api } from '../ipc'
import { LINE_FLASH_STEPS, LINE_FLASH_TIP } from '../flashSteps'

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
        <Alert color="yellow" variant="light" icon={<IconInfoCircle size={16} />} p="xs">
          盒子刷成 OpenWrt 后 ADB 连不上，本页改用 SSH。<b>线刷必须配合电脑端的 USB 烧录工具</b>，并严格按下方步骤
          （先在电脑开工具点「开始」等待，再回本工具点「进入线刷模式」）执行——<b>顺序错了不生效</b>。
        </Alert>

        <Accordion variant="separated" radius="md" defaultValue="steps">
          <Accordion.Item value="steps">
            <Accordion.Control icon={<IconListNumbers size={18} color="var(--mantine-color-teal-4)" />}>
              <Text fw={700} size="sm">
                线刷操作步骤（必读 · 顺序不能错）
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <List type="ordered" size="sm" spacing={6}>
                {LINE_FLASH_STEPS.map((s, i) => (
                  <List.Item key={i}>{s}</List.Item>
                ))}
              </List>
              <Text size="xs" c="dimmed" mt="sm">
                💡 {LINE_FLASH_TIP}
              </Text>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>

        <TextInput
          label="盒子 IP 地址"
          placeholder="192.168.1.x"
          disabled={running}
          value={settings.ip}
          onChange={(e) => setSettings({ ip: e.currentTarget.value })}
        />

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
            description="配合电脑端 USB 烧录工具做 PC 线刷。务必先按上方步骤让工具进入「等待」，再点此经 SSH 触发重启，工具捕获后自动开刷。"
            color="teal"
            disabled={disabled}
            onClick={() => onAction('ssh-recovery')}
          />
          <ActionCard
            icon={<IconUsb size={26} />}
            title="U 盘启动 (SSH)"
            description="需先插好含引导文件的 U 盘。经 SSH 触发 reboot update，盒子重启后优先从 U 盘引导启动。"
            color="cyan"
            disabled={disabled}
            onClick={() => onAction('ssh-usbboot')}
          />
        </SimpleGrid>
      </Stack>
    </Paper>
  )
}
