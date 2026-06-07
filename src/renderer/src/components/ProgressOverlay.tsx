import { Paper, Group, Loader, Text, Badge, Button } from '@mantine/core'
import { IconPlayerStopFilled } from '@tabler/icons-react'
import { useStore } from '../store'
import { api } from '../ipc'
import { PHASE_LABEL } from '@shared/types'

export function ProgressOverlay() {
  const status = useStore((s) => s.status)

  const attemptText =
    status.phase === 'retrying'
      ? `第 ${status.attempt} 次${status.maxAttempts ? ` / 最多 ${status.maxAttempts}` : '（无限重试）'}`
      : null

  return (
    <Paper
      radius="lg"
      p="sm"
      px="md"
      style={{
        background: 'linear-gradient(135deg, rgba(6,207,253,0.16), rgba(124,77,255,0.16))',
        border: '1px solid rgba(55,216,253,0.35)'
      }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap">
          <Loader size="sm" color="brand" />
          <Text fw={700} size="sm">
            {PHASE_LABEL[status.phase] ?? status.phase}
            {status.message ? ` — ${status.message}` : ''}
          </Text>
          {status.model && (
            <Badge color={status.model === 't1' ? 'brand' : 'accent'} variant="light">
              {status.model.toUpperCase()}
            </Badge>
          )}
          {attemptText && (
            <Badge color="yellow" variant="light">
              {attemptText}
            </Badge>
          )}
        </Group>
        <Button
          size="xs"
          color="red"
          variant="light"
          leftSection={<IconPlayerStopFilled size={14} />}
          onClick={() => api.cancel()}
        >
          取消
        </Button>
      </Group>
    </Paper>
  )
}
