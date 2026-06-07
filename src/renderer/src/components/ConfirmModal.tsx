import { useRef } from 'react'
import { Modal, Stack, Group, Text, Button, Alert, Code, ThemeIcon } from '@mantine/core'
import { IconAlertTriangle, IconReload, IconUsb } from '@tabler/icons-react'
import type { ActionType } from './ActionGrid'
import type { Model } from '@shared/types'

interface Props {
  opened: boolean
  action: ActionType | null
  ip: string
  detected: Model | 'unknown' | null
  onConfirm: () => void
  onCancel: () => void
}

const isFlash = (a: ActionType | null): a is 'flash-t1' | 'flash-n1' => a === 'flash-t1' || a === 'flash-n1'

export function ConfirmModal({ opened, action, ip, detected, onConfirm, onCancel }: Props) {
  // 缓存最近一次非空 action，使关闭(opened:true→false)时 Modal 仍有内容、能播放退出动画
  const lastActionRef = useRef<ActionType | null>(action)
  if (action) lastActionRef.current = action
  const a = action ?? lastActionRef.current
  if (!a) return null

  const flashModel: Model | null = a === 'flash-t1' ? 't1' : a === 'flash-n1' ? 'n1' : null
  const mismatch = flashModel && detected && detected !== 'unknown' && detected !== flashModel

  const isSsh = a === 'ssh-recovery' || a === 'ssh-usbboot'
  const titleMap: Record<ActionType, string> = {
    'flash-t1': '确认对 T1 盒子降级 boot 分区？',
    'flash-n1': '确认对 N1 盒子降级 boot 分区？',
    recovery: '确认让盒子进入线刷模式？',
    usbboot: '确认让盒子进入 U 盘启动？',
    'ssh-recovery': '确认通过 SSH 让盒子进入线刷/更新模式？',
    'ssh-usbboot': '确认通过 SSH 让盒子进入 U 盘启动？'
  }
  const useReloadIcon = a === 'recovery' || a === 'ssh-recovery'

  return (
    <Modal opened={opened} onClose={onCancel} centered title={titleMap[a]} radius="lg" overlayProps={{ blur: 3 }}>
      <Stack gap="md">
        {isFlash(a) ? (
          <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />} title="不可逆 · 务必核对型号">
            该操作会把内置/自定义 <Code>boot.img</Code> 通过 <Code>dd</Code> 写入盒子的 <Code>/dev/block/boot</Code> 分区。
            刷错型号可能导致盒子无法启动，请确认型号无误。
          </Alert>
        ) : (
          <Group gap="sm" align="flex-start" wrap="nowrap">
            <ThemeIcon variant="light" color={useReloadIcon ? 'teal' : 'cyan'} size="lg" radius="md">
              {useReloadIcon ? <IconReload size={18} /> : <IconUsb size={18} />}
            </ThemeIcon>
            <Text size="sm" c="dimmed">
              {isSsh
                ? '将通过 SSH 执行 reboot update 让盒子重启。注意：OpenWrt 下这实为普通重启 + u-boot 的 U 盘优先引导（busybox 会忽略 update 参数）；真正的 PC 线刷需短接主板触点 + USB 烧录工具，无法用此命令触发。'
                : '将连接盒子并发送重启进入对应模式的指令，不会写入 boot 分区。'}
            </Text>
          </Group>
        )}

        <Group gap="xs">
          <Text size="sm" c="dimmed">
            目标 IP：
          </Text>
          <Code>{ip || '(未填写)'}</Code>
          {flashModel && (
            <>
              <Text size="sm" c="dimmed">
                目标型号：
              </Text>
              <Code>{flashModel.toUpperCase()}</Code>
            </>
          )}
        </Group>

        {mismatch && (
          <Alert color="orange" variant="light" icon={<IconAlertTriangle size={18} />}>
            注意：当前检测到的是 <b>{(detected as string).toUpperCase()}</b>，与所选 <b>{flashModel!.toUpperCase()}</b> 不一致。
            执行时会在连接后再次校验型号，不匹配将自动中止。
          </Alert>
        )}

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onCancel}>
            取消
          </Button>
          <Button color={isFlash(a) ? 'red' : 'brand'} onClick={onConfirm}>
            {isFlash(a) ? '确认刷写' : '确认执行'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
