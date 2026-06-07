import { useState } from 'react'
import {
  Paper,
  Group,
  TextInput,
  Button,
  Badge,
  Popover,
  Stack,
  NumberInput,
  Switch,
  Text,
  ActionIcon,
  Tooltip,
  Divider
} from '@mantine/core'
import { IconRadar2, IconSettings, IconFolderOpen, IconX } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { useStore } from '../store'
import { api } from '../ipc'
import type { Model } from '@shared/types'

export function ConnectionPanel() {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const setCustomBootImg = useStore((s) => s.setCustomBootImg)
  const running = useStore((s) => s.running)
  const detected = useStore((s) => s.detected)
  const setDetected = useStore((s) => s.setDetected)
  const online = useStore((s) => s.online)
  const setOnline = useStore((s) => s.setOnline)
  const status = useStore((s) => s.status)

  const [detecting, setDetecting] = useState(false)

  const busy = running || detecting
  const dotState = busy ? { 'data-busy': 'true' } : { 'data-on': online ? 'true' : 'false' }

  const onDetect = async () => {
    const ip = settings.ip.trim()
    if (!ip) {
      notifications.show({ color: 'red', title: '缺少 IP', message: '请先填写盒子的 IP 地址。' })
      return
    }
    setDetecting(true)
    setDetected(null)
    setOnline(false)
    try {
      const r = await api.detect({ ip })
      setDetected(r.model)
      setOnline(r.ok)
      if (r.ok) {
        notifications.show({
          color: 'teal',
          title: '已连接',
          message: r.model === 'unknown' ? '已连接，型号未知（可能已刷第三方系统），详见日志。' : `识别到 ${r.model.toUpperCase()} 盒子。`
        })
      } else {
        notifications.show({ color: 'orange', title: '连接失败', message: r.error || '未连接到盒子。', autoClose: 6000 })
      }
    } finally {
      setDetecting(false)
    }
  }

  const pickImg = async (model: Model) => {
    const p = await api.pickBootImg()
    if (p) setCustomBootImg(model, p)
  }

  const detectedBadge = () => {
    if (online) {
      if (detected === 't1') return <Badge color="brand" variant="light">已连接 · T1 (q201)</Badge>
      if (detected === 'n1') return <Badge color="accent" variant="light">已连接 · N1 (p230)</Badge>
      return <Badge color="teal" variant="light">已连接 · 型号未知</Badge>
    }
    if (detected === null) return <Badge color="gray" variant="light">未检测</Badge>
    return <Badge color="red" variant="light">未连接</Badge>
  }

  const baseName = (p: string | null) => (p ? p.replace(/\\/g, '/').split('/').pop() : null)

  return (
    <Paper className="glass" radius="lg" p="md">
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="md">
        <Group align="flex-end" gap="sm" style={{ flex: 1, minWidth: 280 }}>
          <span className="status-dot" {...dotState} style={{ marginBottom: 10 }} />
          <TextInput
            label="盒子 IP 地址"
            placeholder="192.168.1.x"
            value={settings.ip}
            disabled={busy}
            onChange={(e) => setSettings({ ip: e.currentTarget.value })}
            style={{ flex: 1, minWidth: 180 }}
          />
          <Button
            leftSection={<IconRadar2 size={16} />}
            variant="light"
            color="brand"
            loading={detecting}
            disabled={running}
            onClick={onDetect}
          >
            检测设备
          </Button>
        </Group>

        <Group gap="sm">
          {detectedBadge()}
          {status.phase !== 'idle' && (
            <Badge color="gray" variant="outline">
              状态：{status.phase}
            </Badge>
          )}

          <Popover width={320} position="bottom-end" withArrow shadow="md" disabled={running}>
            <Popover.Target>
              <Tooltip label="高级设置（重试 / 自定义镜像）" withArrow>
                <ActionIcon variant="light" color="gray" size="lg" aria-label="高级设置">
                  <IconSettings size={18} />
                </ActionIcon>
              </Tooltip>
            </Popover.Target>
            <Popover.Dropdown className="glass-strong">
              <Stack gap="sm">
                <Text fw={700} size="sm">
                  重试设置
                </Text>
                <Group grow>
                  <NumberInput
                    label="最大重试次数"
                    min={1}
                    max={999}
                    disabled={settings.infiniteRetry}
                    value={settings.maxRetries}
                    onChange={(v) => setSettings({ maxRetries: typeof v === 'number' ? v : 20 })}
                  />
                  <NumberInput
                    label="间隔(秒)"
                    min={1}
                    max={60}
                    value={settings.retryIntervalSec}
                    onChange={(v) => setSettings({ retryIntervalSec: typeof v === 'number' ? v : 3 })}
                  />
                </Group>
                <Switch
                  label="无限重试（还原原版批处理行为）"
                  checked={settings.infiniteRetry}
                  onChange={(e) => setSettings({ infiniteRetry: e.currentTarget.checked })}
                />
                <Switch
                  color="orange"
                  label="跳过型号校验（强制刷写 · 谨慎）"
                  description="已刷第三方系统、型号识别失败但确知机型时再开；刷错型号会变砖"
                  checked={settings.skipModelCheck}
                  onChange={(e) => setSettings({ skipModelCheck: e.currentTarget.checked })}
                />

                <Divider />
                <Text fw={700} size="sm">
                  自定义 boot.img（留空用内置）
                </Text>
                {(['t1', 'n1'] as Model[]).map((m) => (
                  <Group key={m} justify="space-between" gap="xs" wrap="nowrap">
                    <Text size="sm" w={28}>
                      {m.toUpperCase()}
                    </Text>
                    <Text size="xs" c={settings.customBootImg[m] ? 'brand.4' : 'dimmed'} style={{ flex: 1 }} truncate>
                      {baseName(settings.customBootImg[m]) || '内置镜像'}
                    </Text>
                    <Tooltip label="选择镜像文件" withArrow>
                      <ActionIcon variant="subtle" color="brand" onClick={() => pickImg(m)}>
                        <IconFolderOpen size={16} />
                      </ActionIcon>
                    </Tooltip>
                    {settings.customBootImg[m] && (
                      <ActionIcon variant="subtle" color="red" onClick={() => setCustomBootImg(m, null)}>
                        <IconX size={16} />
                      </ActionIcon>
                    )}
                  </Group>
                ))}
              </Stack>
            </Popover.Dropdown>
          </Popover>
        </Group>
      </Group>
    </Paper>
  )
}
