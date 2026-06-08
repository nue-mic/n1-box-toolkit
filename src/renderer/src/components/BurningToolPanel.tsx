import { useEffect, useState } from 'react'
import {
  Paper,
  Group,
  Stack,
  Text,
  Button,
  Badge,
  Progress,
  ActionIcon,
  Tooltip,
  SimpleGrid
} from '@mantine/core'
import {
  IconDownload,
  IconCheck,
  IconFolderOpen,
  IconUsb,
  IconReload
} from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { api } from '../ipc'
import type { BurningTool, BurningToolProgress } from '@shared/types'

interface DownloadState {
  progress?: BurningToolProgress
  downloadedPath?: string
  inFlight?: boolean
  error?: string
}

const fmtMB = (n: number): string => (n / 1048576).toFixed(1)

/**
 * 电脑端烧录工具下载面板。
 * 紧凑形态：默认显示两个版本卡片 + 推荐徽章；下载时显示进度条；下载完显示路径 + 打开文件夹。
 * 走自建 Release 代理，多域名 fallback；首次刷机的用户在 SSH 流程顶部能看到、点一下就好。
 */
export function BurningToolPanel(): React.JSX.Element {
  const [tools, setTools] = useState<BurningTool[]>([])
  const [states, setStates] = useState<Record<string, DownloadState>>({})

  useEffect(() => {
    api.listBurningTools().then(setTools).catch(() => setTools([]))
    const off = api.onBurningToolProgress((p) => {
      setStates((s) => ({ ...s, [p.toolId]: { ...s[p.toolId], progress: p, inFlight: true } }))
    })
    return off
  }, [])

  const onDownload = async (tool: BurningTool): Promise<void> => {
    setStates((s) => ({ ...s, [tool.id]: { inFlight: true } }))
    try {
      const r = await api.downloadBurningTool(tool.id)
      if (r.ok && r.path) {
        setStates((s) => ({
          ...s,
          [tool.id]: { downloadedPath: r.path, inFlight: false }
        }))
        notifications.show({
          color: 'teal',
          title: '烧录工具已下载',
          message: `已保存到：${r.path}`,
          autoClose: 4000
        })
      } else if (r.cancelled) {
        setStates((s) => ({ ...s, [tool.id]: { inFlight: false } }))
      } else {
        setStates((s) => ({
          ...s,
          [tool.id]: { inFlight: false, error: r.error || '下载失败' }
        }))
        notifications.show({
          color: 'red',
          title: '下载失败',
          message: r.error || '未知错误',
          autoClose: 6000
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setStates((s) => ({ ...s, [tool.id]: { inFlight: false, error: msg } }))
      notifications.show({ color: 'red', title: '下载异常', message: msg, autoClose: 6000 })
    }
  }

  const onReveal = (filePath: string): void => api.revealBurningTool(filePath)

  if (tools.length === 0) return <></>

  return (
    <Paper className="glass" radius="md" p="sm">
      <Stack gap="xs">
        <Group gap="xs">
          <IconUsb size={16} color="var(--mantine-color-brand-4)" />
          <Text fw={700} size="sm">
            电脑端烧录工具
          </Text>
          <Badge size="xs" variant="light" color="gray">
            Windows
          </Badge>
          <Text size="xs" c="dimmed">
            · 走自建代理下载，国内可达
          </Text>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          {tools.map((tool) => {
            const st = states[tool.id] || {}
            const pct = st.progress?.percent ?? 0
            return (
              <Paper
                key={tool.id}
                className="glass-strong"
                radius="md"
                p="sm"
                style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
              >
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Group gap={6} wrap="nowrap">
                    <Text fw={700} size="sm">
                      {tool.label}
                    </Text>
                    {tool.recommended && (
                      <Badge size="xs" color="teal" variant="filled">
                        推荐
                      </Badge>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed">
                    {fmtMB(tool.size)} MB
                  </Text>
                </Group>

                <Text size="xs" c="brand.4" fw={600}>
                  {tool.forBoxes}
                </Text>
                <Text size="xs" c="dimmed" lineClamp={2}>
                  {tool.description}
                </Text>

                {st.inFlight && st.progress ? (
                  <Stack gap={2} mt={4}>
                    <Progress value={pct} striped animated color="brand" size="sm" />
                    <Text size="xs" c="dimmed" ta="center">
                      {pct}% · {fmtMB(st.progress.transferred)}/{fmtMB(st.progress.total)} MB
                    </Text>
                  </Stack>
                ) : st.downloadedPath ? (
                  <Group gap={6} mt={2} wrap="nowrap">
                    <Badge color="teal" variant="light" leftSection={<IconCheck size={12} />} style={{ flex: 1, minWidth: 0 }}>
                      <Text size="xs" truncate>
                        已下载
                      </Text>
                    </Badge>
                    <Tooltip label="在文件夹中显示" withArrow>
                      <ActionIcon
                        variant="light"
                        color="brand"
                        size="sm"
                        onClick={() => onReveal(st.downloadedPath!)}
                      >
                        <IconFolderOpen size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="重新下载" withArrow>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="sm"
                        onClick={() => onDownload(tool)}
                      >
                        <IconReload size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                ) : (
                  <Button
                    leftSection={<IconDownload size={14} />}
                    size="xs"
                    variant="light"
                    color={tool.recommended ? 'brand' : 'gray'}
                    onClick={() => onDownload(tool)}
                    mt={2}
                  >
                    下载
                  </Button>
                )}
              </Paper>
            )
          })}
        </SimpleGrid>
      </Stack>
    </Paper>
  )
}
