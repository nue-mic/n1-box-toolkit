import { useEffect, useState } from 'react'
import { Group, Text, Badge, ActionIcon, Tooltip, useMantineColorScheme, useComputedColorScheme, ThemeIcon } from '@mantine/core'
import { IconMinus, IconSquare, IconX, IconSun, IconMoon, IconDeviceTv } from '@tabler/icons-react'
import { api } from '../ipc'

export function TitleBar() {
  const { setColorScheme } = useMantineColorScheme()
  const computed = useComputedColorScheme('dark', { getInitialValueInEffect: true })
  const toggleTheme = () => setColorScheme(computed === 'dark' ? 'light' : 'dark')
  const [version, setVersion] = useState('')
  useEffect(() => {
    api.getAppVersion().then(setVersion).catch(() => {})
  }, [])

  return (
    <Group
      className="titlebar"
      justify="space-between"
      px="sm"
      style={{ height: 'var(--tb-height)', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.06)' }}
    >
      <Group gap="xs">
        <ThemeIcon variant="gradient" gradient={{ from: 'brand', to: 'accent', deg: 135 }} radius="md" size={28}>
          <IconDeviceTv size={18} />
        </ThemeIcon>
        <Text fw={800} size="sm" className="gradient-text" style={{ letterSpacing: 0.5 }}>
          N1 OneKey
        </Text>
        {version && (
          <Badge size="xs" variant="light" color="brand" radius="sm">
            v{version}
          </Badge>
        )}
        <Text size="xs" c="dimmed" visibleFrom="sm">
          斐讯 T1/N1 一键降级工具
        </Text>
      </Group>

      <Group gap={4}>
        <Tooltip label={computed === 'dark' ? '浅色模式' : '深色模式'} withArrow>
          <ActionIcon variant="subtle" color="gray" onClick={toggleTheme} aria-label="切换主题">
            {computed === 'dark' ? <IconSun size={17} /> : <IconMoon size={17} />}
          </ActionIcon>
        </Tooltip>
        <ActionIcon variant="subtle" color="gray" onClick={() => api.minimize()} aria-label="最小化">
          <IconMinus size={17} />
        </ActionIcon>
        <ActionIcon variant="subtle" color="gray" onClick={() => api.maximizeToggle()} aria-label="最大化">
          <IconSquare size={14} />
        </ActionIcon>
        <ActionIcon variant="subtle" color="red" onClick={() => api.close()} aria-label="关闭">
          <IconX size={17} />
        </ActionIcon>
      </Group>
    </Group>
  )
}
