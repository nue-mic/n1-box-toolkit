import { Card, Group, Text, ThemeIcon, Stack } from '@mantine/core'
import type { ReactNode } from 'react'

interface Props {
  icon: ReactNode
  title: string
  description: string
  color: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}

export function ActionCard({ icon, title, description, color, danger, disabled, onClick }: Props) {
  return (
    <Card
      className="action-card glass"
      data-danger={danger ? 'true' : 'false'}
      data-disabled={disabled ? 'true' : 'false'}
      radius="lg"
      padding="lg"
      onClick={disabled ? undefined : onClick}
    >
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <ThemeIcon
            size={46}
            radius="md"
            variant="light"
            color={color}
            style={{ border: `1px solid var(--mantine-color-${color}-8)` }}
          >
            {icon}
          </ThemeIcon>
          {danger && (
            <Text size="xs" fw={700} c="red.5" style={{ letterSpacing: 1 }}>
              危险操作
            </Text>
          )}
        </Group>
        <div>
          <Text fw={700} size="lg">
            {title}
          </Text>
          <Text size="sm" c="dimmed" mt={4} style={{ lineHeight: 1.5 }}>
            {description}
          </Text>
        </div>
      </Stack>
    </Card>
  )
}
