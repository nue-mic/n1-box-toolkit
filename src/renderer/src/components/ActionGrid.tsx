import { SimpleGrid } from '@mantine/core'
import { IconArrowBigDownLines, IconReload, IconUsb } from '@tabler/icons-react'
import { ActionCard } from './ActionCard'

export type ActionType = 'flash-t1' | 'flash-n1' | 'recovery' | 'usbboot'

interface Props {
  disabled?: boolean
  onAction: (type: ActionType) => void
}

export function ActionGrid({ disabled, onAction }: Props) {
  return (
    <SimpleGrid cols={{ base: 2, lg: 4 }} spacing="md">
      <ActionCard
        icon={<IconArrowBigDownLines size={26} />}
        title="T1 降级"
        description="把 boot 分区降级到内置镜像（型号 q201），便于后续线刷。"
        color="brand"
        danger
        disabled={disabled}
        onClick={() => onAction('flash-t1')}
      />
      <ActionCard
        icon={<IconArrowBigDownLines size={26} />}
        title="N1 降级"
        description="把 boot 分区降级到内置镜像（型号 p230），便于后续线刷。"
        color="accent"
        danger
        disabled={disabled}
        onClick={() => onAction('flash-n1')}
      />
      <ActionCard
        icon={<IconReload size={26} />}
        title="进入线刷模式"
        description="连接并开启 Root 后让盒子重启进入 recovery / update 模式。"
        color="teal"
        disabled={disabled}
        onClick={() => onAction('recovery')}
      />
      <ActionCard
        icon={<IconUsb size={26} />}
        title="U 盘启动"
        description="快速连接后发送 reboot update 指令，进入 U 盘启动。"
        color="cyan"
        disabled={disabled}
        onClick={() => onAction('usbboot')}
      />
    </SimpleGrid>
  )
}
