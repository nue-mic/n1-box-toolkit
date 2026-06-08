import { useLayoutEffect, useRef } from 'react'
import { Paper, Group, Text, Switch, Tooltip, ActionIcon, Badge } from '@mantine/core'
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
  const lastLineRef = useRef<HTMLDivElement>(null)

  // 新版日志面板不自带内部滚动条 —— 整页统一由 App 外层主滚动容器接管。
  // autoScroll 时让最后一行 scrollIntoView，浏览器会自动定位到最近的可滚动祖先（即主滚动容器）。
  // 用 useLayoutEffect 在 commit 后 paint 前同步执行，避免一帧"旧位置→新位置"的视觉跳动。
  useLayoutEffect(() => {
    if (autoScroll && lastLineRef.current) {
      lastLineRef.current.scrollIntoView({ block: 'end', inline: 'nearest' })
    }
  }, [logs, autoScroll])

  const onCopy = async (): Promise<void> => {
    await navigator.clipboard.writeText(logToText(logs))
    notifications.show({ color: 'teal', message: '日志已复制到剪贴板', autoClose: 1500 })
  }

  const onSave = async (): Promise<void> => {
    const r = await api.saveLog(logToText(logs))
    if (r.ok) notifications.show({ color: 'teal', message: `日志已保存：${r.path}`, autoClose: 2500 })
    else if (r.error) notifications.show({ color: 'red', message: `保存失败：${r.error}` })
  }

  return (
    <Paper
      className="glass"
      radius="lg"
      p="xs"
      style={{
        // 不再 flex:1，改由外层包装控制最低高度；内容自然撑高，与外层主滚动联动
        width: '100%',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <Group justify="space-between" px="xs" pt={4} pb="xs" style={{ flexShrink: 0 }}>
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

      <div className="log-viewport" style={{ padding: '4px 10px', flex: 1 }}>
        {logs.length === 0 ? (
          <Text size="sm" c="dimmed" ta="center" mt="xl">
            暂无日志。填写 IP 后点「检测设备」或选择上方操作即可开始。
          </Text>
        ) : (
          logs.map((l, idx) => (
            <div
              key={l.id}
              ref={idx === logs.length - 1 ? lastLineRef : undefined}
              className="log-line"
            >
              <span className="log-ts">{fmtTime(l.ts)}</span>
              <span className={`log-${l.level}`}>{l.text}</span>
            </div>
          ))
        )}
      </div>
    </Paper>
  )
}
