import { Stack, Paper, Alert, Text, Accordion, Group, List, Anchor } from '@mantine/core'
import {
  IconInfoCircle,
  IconBook2,
  IconAlertTriangle,
  IconListNumbers
} from '@tabler/icons-react'
import { BurningToolPanel } from './BurningToolPanel'

/**
 * 独立 tab：电脑端烧录工具下载 + 完整安装指南。
 * 与 SSH 线刷流程分离，让首次用户能从顶部 tab 直接发现该工具。
 */
export function BurningToolTab(): React.JSX.Element {
  return (
    <Stack gap="md">
      <Alert color="blue" variant="light" icon={<IconInfoCircle size={16} />} p="sm">
        <Text size="sm">
          线刷盒子必须配合<b>电脑端的 USB 烧录工具</b>。下面提供两个版本一键下载，走自建代理，
          国内可达。下载完按说明安装后，回到「SSH · 已刷 OpenWrt」tab 走线刷流程即可。
        </Text>
      </Alert>

      {/* 复用紧凑式两卡片面板 */}
      <BurningToolPanel />

      <Accordion variant="separated" radius="md" multiple defaultValue={['guide']}>
        <Accordion.Item value="guide">
          <Accordion.Control icon={<IconListNumbers size={18} color="var(--mantine-color-teal-4)" />}>
            <Text fw={700} size="sm">
              v2.2.0 套装安装步骤（N1 / T1 推荐）
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <List type="ordered" size="sm" spacing={6}>
              <List.Item>
                下载 zip 后解压到任意目录，里面包含三个文件：
                <Text component="span" c="brand.4">
                  {' '}
                  USB_Burning_Tool-v2.2.0-exe.exe
                </Text>
                、
                <Text component="span" c="brand.4">
                  {' '}
                  UsbRomDrv.dll
                </Text>
                、
                <Text component="span" c="brand.4">
                  {' '}
                  README-N1-T1-使用说明.txt
                </Text>
                。
              </List.Item>
              <List.Item>
                双击 exe 完成安装（默认路径{' '}
                <Text component="span" ff="monospace" size="xs">
                  C:\Program Files (x86)\Amlogic\USB_Burning_Tool\
                </Text>
                ）。Windows SmartScreen 警告点「仍要运行」即可。
              </List.Item>
              <List.Item>
                <b>不要立即启动工具</b>。打开安装目录，把 zip 里的{' '}
                <Text component="span" ff="monospace" size="xs">
                  UsbRomDrv.dll
                </Text>{' '}
                复制过去，<b>覆盖</b>原文件（需要管理员权限）。
              </List.Item>
              <List.Item>启动桌面快捷方式「USB Burning Tool」。</List.Item>
              <List.Item>
                菜单「文件 → 导入烧录包」选择 .img 固件；
                <b>务必【取消勾选】「擦除 flash」「擦除 bootloader」</b>（误擦会变砖）。
              </List.Item>
              <List.Item>点「开始」让工具进入【等待连接】状态。</List.Item>
              <List.Item>
                回到本程序「SSH · 已刷 OpenWrt」tab，按提示让盒子重启进入线刷模式 —— 烧录工具
                捕获后自动开始刷机。
              </List.Item>
            </List>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="faq">
          <Accordion.Control icon={<IconAlertTriangle size={18} color="var(--mantine-color-yellow-5)" />}>
            <Text fw={700} size="sm">
              常见问题排查
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              <FAQItem
                q="为什么要替换 UsbRomDrv.dll？"
                a="官方 v2.2.0 自带的 dll 有内置超时，N1/T1 烧录到 98% 时常被中止。社区版（来自 hqvv/onecloud）去掉了 timeout，能稳定刷完。"
              />
              <FAQItem
                q="安装时杀毒软件报毒？"
                a="社区修改版 dll 的常见误报。本工具仅本地操作、不联网。信任来源公开仓库：github.com/hqvv/onecloud。"
              />
              <FAQItem
                q="启动工具后点「开始」无反应？"
                a="多为没装 Amlogic USB 驱动。安装程序应自动装；失败则重启电脑后再试。Windows 11 上极少数情况需手动签名。"
              />
              <FAQItem
                q="烧录到 98% 卡死？"
                a="你忘了第 3 步：覆盖 UsbRomDrv.dll。重新操作即可。"
              />
              <FAQItem
                q='工具提示「Get Key Failed」？'
                a="USB 线问题。务必用「公对公」USB 2.0 线，不要用 USB 3.0 口。"
              />
              <FAQItem
                q="v2.2.0 不识别我的盒子？"
                a="试试 v3.1.0（用于较新机型 S905X3 / S922）。N1/T1 极少需要 v3.x。"
              />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="source">
          <Accordion.Control icon={<IconBook2 size={18} color="var(--mantine-color-gray-5)" />}>
            <Text fw={700} size="sm">
              来源与声明
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              <Group gap="xs">
                <Text size="sm" c="dimmed">
                  v2.2.0 + 修改版 dll:
                </Text>
                <Anchor size="sm" href="https://github.com/hqvv/onecloud" target="_blank" rel="noreferrer">
                  github.com/hqvv/onecloud
                </Anchor>
              </Group>
              <Group gap="xs">
                <Text size="sm" c="dimmed">
                  v3.1.0 镜像:
                </Text>
                <Anchor
                  size="sm"
                  href="https://github.com/Ayx03/USB_Burning_Tool"
                  target="_blank"
                  rel="noreferrer"
                >
                  github.com/Ayx03/USB_Burning_Tool
                </Anchor>
              </Group>
              <Group gap="xs">
                <Text size="sm" c="dimmed">
                  本工具整合发布:
                </Text>
                <Anchor
                  size="sm"
                  href="https://github.com/mia-clark/n1-box-toolkit/releases/tag/tools-burning-v1"
                  target="_blank"
                  rel="noreferrer"
                >
                  mia-clark/n1-box-toolkit · tools-burning-v1
                </Anchor>
              </Group>
              <Text size="xs" c="dimmed" mt="xs">
                Amlogic USB Burning Tool 系 Amlogic 公司官方工具。本程序仅做下载分发便利，
                所有版权归原厂商所有。仅供 N1/T1 老盒子刷机研究学习使用，非商业用途。
              </Text>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  )
}

function FAQItem({ q, a }: { q: string; a: string }): React.JSX.Element {
  return (
    <Paper className="glass-strong" radius="sm" p="xs">
      <Text fw={600} size="sm" mb={2}>
        Q：{q}
      </Text>
      <Text size="xs" c="dimmed">
        A：{a}
      </Text>
    </Paper>
  )
}
