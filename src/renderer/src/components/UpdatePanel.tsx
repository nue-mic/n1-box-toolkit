import { useEffect, useState } from 'react'
import {
  Paper,
  Stack,
  Group,
  Text,
  Button,
  Badge,
  Progress,
  Alert,
  ScrollArea,
  Typography
} from '@mantine/core'
import {
  IconRefresh,
  IconDownload,
  IconCircleCheck,
  IconAlertTriangle,
  IconSparkles
} from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '../store'
import { api } from '../ipc'
import type { UpdateProgress } from '@shared/types'

const fmtMB = (n: number): string => (n / 1048576).toFixed(1)

export function UpdatePanel() {
  const update = useStore((s) => s.update)
  const setUpdate = useStore((s) => s.setUpdate)
  const [checking, setChecking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)

  // 订阅下载进度
  useEffect(() => api.onUpdateProgress((p) => setProgress(p)), [])

  const onCheck = async () => {
    setChecking(true)
    try {
      const info = await api.checkUpdate()
      setUpdate(info)
      if (!info.ok) {
        notifications.show({ color: 'red', title: '检查失败', message: info.error || '无法获取最新版本', autoClose: 6000 })
      } else if (!info.hasUpdate) {
        notifications.show({ color: 'teal', title: '已是最新', message: `当前 v${info.current} 已是最新版本。` })
      } else {
        notifications.show({ color: 'grape', title: '发现新版本', message: `v${info.latest} 可用，可一键更新。` })
      }
    } finally {
      setChecking(false)
    }
  }

  const onUpdate = async () => {
    setDownloading(true)
    setProgress({ percent: 0, transferred: 0, total: update?.asset?.size || 0 })
    try {
      const r = await api.downloadUpdate()
      // 成功时主进程会退出自身（窗口关闭），通常走不到这；失败才提示
      if (!r.ok) {
        notifications.show({ color: 'red', title: '更新失败', message: r.error || '更新过程出错', autoClose: 8000 })
        setDownloading(false)
        setProgress(null)
      }
    } catch {
      // 应用退出导致 IPC 通道关闭属正常，忽略
    }
  }

  return (
    <Paper className="glass" radius="lg" p="md">
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Group gap="xs">
            <IconSparkles size={20} color="var(--mantine-color-grape-4)" />
            <Text fw={700}>升级更新</Text>
            {update?.current && (
              <Badge variant="light" color="gray">
                当前 v{update.current}
              </Badge>
            )}
          </Group>
          <Button
            leftSection={<IconRefresh size={16} />}
            variant="light"
            color="brand"
            loading={checking}
            disabled={downloading}
            onClick={onCheck}
          >
            检查更新
          </Button>
        </Group>

        {!update && !checking && (
          <Alert color="gray" variant="light">
            点「检查更新」获取 GitHub 上的最新版本（仅访问 GitHub，不上传任何信息）。
          </Alert>
        )}

        {update && update.ok && !update.hasUpdate && (
          <Alert color="teal" variant="light" icon={<IconCircleCheck size={18} />}>
            已是最新版本（v{update.current}）。
          </Alert>
        )}

        {update && !update.ok && (
          <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />}>
            检查失败：{update.error}
          </Alert>
        )}

        {update && update.ok && update.hasUpdate && (
          <>
            <Group justify="space-between" align="center" wrap="wrap" gap="sm">
              <Group gap="xs">
                <Badge color="grape" variant="filled" size="lg">
                  新版本 v{update.latest}
                </Badge>
                {update.asset && (
                  <Text size="xs" c="dimmed">
                    {update.asset.name} · {fmtMB(update.asset.size)} MB
                  </Text>
                )}
              </Group>
              <Button
                leftSection={<IconDownload size={16} />}
                color="grape"
                loading={downloading}
                disabled={!update.asset}
                onClick={onUpdate}
              >
                一键更新
              </Button>
            </Group>

            {!update.asset && (
              <Alert color="orange" variant="light" icon={<IconAlertTriangle size={18} />}>
                未找到 Windows 安装包资产，无法一键更新。请前往 GitHub Releases 手动下载。
              </Alert>
            )}

            {downloading && progress && (
              <Stack gap={4}>
                <Progress value={progress.percent} striped animated color="grape" />
                <Text size="xs" c="dimmed" ta="center">
                  {progress.percent}% · {fmtMB(progress.transferred)}/{fmtMB(progress.total)} MB
                  {progress.percent >= 100 ? ' · 准备安装，即将自动重启…' : ''}
                </Text>
              </Stack>
            )}

            {update.notes && (
              <Paper className="glass-strong" radius="md" p="sm">
                <Text fw={600} size="sm" mb={6}>
                  更新日志
                </Text>
                <ScrollArea.Autosize mah={280}>
                  <Typography>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: (props) => (
                          <a href={props.href} target="_blank" rel="noreferrer">
                            {props.children}
                          </a>
                        )
                      }}
                    >
                      {update.notes}
                    </ReactMarkdown>
                  </Typography>
                </ScrollArea.Autosize>
              </Paper>
            )}
          </>
        )}
      </Stack>
    </Paper>
  )
}
