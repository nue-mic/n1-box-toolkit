import { useEffect, useRef } from 'react'
import { Paper, Group, Text, ScrollArea, Switch, Tooltip, ActionIcon, Badge } from '@mantine/core'
import { IconTerminal2, IconCopy, IconTrash, IconDeviceFloppy } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { useStore } from '../store'
import { api } from '../ipc'
import type { LogEntry } from '@shared/types'

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function logToText(logs: LogEntry[]): string {
  return logs.map((l) => `[${fmtTime(l.ts)}] ${l.level === 'cmd' ? '$ ' : ''}${l.text}`).join('\n')
}

export function LogConsole() {
  const logs = useStore((s) => s.logs)
  const clearLogs = useStore((s) => s.clearLogs)
  const autoScroll = useStore((s) => s.autoScroll)
  const setAutoScroll = useStore((s) => s.setAutoScroll)
  const viewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // 实时高频日志用瞬时贴底，避免平滑动画追不上而抖动
    if (autoScroll && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  const onCopy = async () => {
    await navigator.clipboard.writeText(logToText(logs))
    notifications.show({ color: 'teal', message: '日志已复制到剪贴板', autoClose: 1500 })
  }

  const onSave = async () => {
    const r = await api.saveLog(logToText(logs))
    if (r.ok) notifications.show({ color: 'teal', message: `日志已保存：${r.path}`, autoClose: 2500 })
    else if (r.error) notifications.show({ color: 'red', message: `保存失败：${r.error}` })
  }

  return (
    <Paper
      className="glass"
      radius="lg"
      p="xs"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
    >
      <Group justify="space-between" px="xs" pt={4} pb="xs">
        <Group gap="xs">
          <IconTerminal2 size={16} color="var(--mantine-color-brand-4)" />
          <Text fw={700} size="sm">
            实时日志
          </Text>
          <Badge size="sm" variant="light" color="gray">
            {logs.length}
          </Badge>
        </Group>
        <Group gap="xs">
          <Switch
            size="xs"
            label="自动滚动"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.currentTarget.checked)}
          />
          <Tooltip label="复制全部" withArrow>
            <ActionIcon variant="subtle" color="gray" onClick={onCopy} disabled={!logs.length}>
              <IconCopy size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="保存到文件" withArrow>
            <ActionIcon variant="subtle" color="gray" onClick={onSave} disabled={!logs.length}>
              <IconDeviceFloppy size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="清空" withArrow>
            <ActionIcon variant="subtle" color="red" onClick={clearLogs} disabled={!logs.length}>
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <ScrollArea
        viewportRef={viewportRef}
        style={{ flex: 1, minHeight: 0 }}
        type="auto"
        scrollbarSize={9}
      >
        <div className="log-viewport" style={{ padding: '4px 10px' }}>
          {logs.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" mt="xl">
              暂无日志。填写 IP 后点「检测设备」或选择上方操作即可开始。
            </Text>
          ) : (
            logs.map((l) => (
              <div key={l.id} className="log-line">
                <span className="log-ts">{fmtTime(l.ts)}</span>
                <span className={`log-${l.level}`}>{l.text}</span>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </Paper>
  )
}
