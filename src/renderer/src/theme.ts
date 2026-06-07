import { createTheme, type MantineColorsTuple } from '@mantine/core'

// 电光青（brand）—— 主色
const brand: MantineColorsTuple = [
  '#e0fbff',
  '#caf6ff',
  '#99ebff',
  '#62e0ff',
  '#37d8fd',
  '#1dd2fc',
  '#06cffd',
  '#00b5e3',
  '#00a1cb',
  '#008bb2'
]

// 紫色强调（accent）
const accent: MantineColorsTuple = [
  '#f3edff',
  '#e2d6ff',
  '#c3a9ff',
  '#a378ff',
  '#884ffe',
  '#7635fe',
  '#6d28ff',
  '#5b1de4',
  '#5018cc',
  '#430fb4'
]

// 深石板近黑 dark 调色（[0] 最浅文字 → [9] 最深背景）
const dark: MantineColorsTuple = [
  '#c4cad6',
  '#aab2c0',
  '#8e97a8',
  '#697282',
  '#3a4150',
  '#2a303c',
  '#1c2230',
  '#141925',
  '#0d111a',
  '#080b12'
]

export const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: { light: 6, dark: 5 },
  colors: { brand, accent, dark },
  defaultGradient: { from: 'brand', to: 'accent', deg: 135 },
  defaultRadius: 'md',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace: '"JetBrains Mono", "Cascadia Code", "Consolas", "SFMono-Regular", Menlo, monospace',
  headings: { fontWeight: '700' },
  cursorType: 'pointer'
})
