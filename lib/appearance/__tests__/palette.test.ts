/**
 * Chart colour presets and how preferences become CSS variables
 * (lib/appearance/palette.ts), checked against app/globals.css.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CARD_BACKGROUND,
  CHART_PRESET_DEFINITIONS,
  CHART_PRESETS,
  CHART_SERIES,
  CHART_THEMES,
  DEFAULT_APPEARANCE,
  HEX_COLOR,
  chartStyleVariables,
  resolveChartColors,
  type AppearancePreferences,
} from '../palette'
import { contrastRatio, NON_TEXT_MIN_CONTRAST } from '../contrast'

const css = readFileSync(path.resolve(__dirname, '../../../app/globals.css'), 'utf8')

describe('presets', () => {
  it('give every series a #rrggbb colour in both themes', () => {
    for (const preset of CHART_PRESETS) {
      for (const theme of CHART_THEMES) {
        const colors = CHART_PRESET_DEFINITIONS[preset].colors[theme]
        expect(Object.keys(colors).sort(), `${preset} ${theme}`).toEqual([...CHART_SERIES].sort())
        for (const color of Object.values(colors)) expect(color, `${preset} ${theme}`).toMatch(HEX_COLOR)
      }
    }
  })

  it('resolve to their light values in the light theme and their dark values in the dark theme', () => {
    const prefs: AppearancePreferences = { palette: 'daltonisme', base: 'daltonisme', custom: { light: {}, dark: {} } }
    expect(resolveChartColors(prefs, 'light').revenue).toBe('#0072b2')
    expect(resolveChartColors(prefs, 'dark').revenue).toBe('#56b4e9')
    expect(resolveChartColors(prefs, 'light').expenses).toBe('#d55e00')
    expect(resolveChartColors(prefs, 'dark').expenses).toBe('#e69f00')
  })

  it('ignore stored custom colours unless the palette is custom', () => {
    const prefs: AppearancePreferences = { palette: 'pastel', base: 'pastel', custom: { light: { revenue: '#123456' }, dark: {} } }
    expect(resolveChartColors(prefs, 'light')).toEqual(CHART_PRESET_DEFINITIONS.pastel.colors.light)
  })

  it('reach 3:1 against the card in both themes, the default Sobre included', () => {
    const failures: string[] = []
    for (const preset of CHART_PRESETS) {
      for (const theme of CHART_THEMES) {
        for (const [series, color] of Object.entries(CHART_PRESET_DEFINITIONS[preset].colors[theme])) {
          if (contrastRatio(color, CARD_BACKGROUND[theme]) < NON_TEXT_MIN_CONTRAST) failures.push(`${preset} ${theme} ${series}`)
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('keep Sobre equal to the defaults of globals.css', () => {
    // brand-600 / base-500 (charges, crédit) / foreground in light, brand-400 / base-500 / foreground in dark
    expect(css).toMatch(/--chart-1: var\(--brand-600\)/)
    expect(css).toMatch(/--chart-2: var\(--base-400\)/)
    expect(css).toMatch(/--chart-1: var\(--brand-400\)/)
    expect(css).toMatch(/--chart-2: var\(--base-500\)/)
    expect(css).toMatch(/--chart-expenses: var\(--chart-expenses-light, var\(--base-500\)\)/)
    expect(CHART_PRESET_DEFINITIONS.sobre.colors.light).toMatchObject({ revenue: '#1c7f55', expenses: '#737373', balance: '#0a0a0a' })
    expect(CHART_PRESET_DEFINITIONS.sobre.colors.dark).toMatchObject({ revenue: '#55c08c', expenses: '#737373', balance: '#f5f5f5' })
  })
})

describe('CSS variables', () => {
  it('are empty for the default and for Sobre: the charts keep globals.css', () => {
    expect(chartStyleVariables(DEFAULT_APPEARANCE)).toEqual({})
    expect(chartStyleVariables({ palette: 'sobre', base: 'sobre', custom: { light: { revenue: '#000000' }, dark: {} } })).toEqual({})
  })

  it('set the light and dark value of every series for another preset', () => {
    const vars = chartStyleVariables({ palette: 'contraste', base: 'contraste', custom: { light: {}, dark: {} } })
    expect(Object.keys(vars)).toHaveLength(CHART_SERIES.length * 2)
    expect(vars['--chart-revenue-light']).toBe(CHART_PRESET_DEFINITIONS.contraste.colors.light.revenue)
    expect(vars['--chart-revenue-dark']).toBe(CHART_PRESET_DEFINITIONS.contraste.colors.dark.revenue)
  })

  it('set only the colours the user changed on top of Sobre, per theme', () => {
    const vars = chartStyleVariables({ palette: 'custom', base: 'sobre', custom: { light: { revenue: '#ABCDEF' }, dark: { balance: '#fafafa' } } })
    expect(vars).toEqual({ '--chart-revenue-light': '#abcdef', '--chart-balance-dark': '#fafafa' })
  })

  it('complete a custom palette with its starting preset', () => {
    const prefs: AppearancePreferences = { palette: 'custom', base: 'pastel', custom: { light: { revenue: '#111111' }, dark: {} } }
    const vars = chartStyleVariables(prefs)
    expect(vars['--chart-revenue-light']).toBe('#111111')
    expect(vars['--chart-expenses-light']).toBe(CHART_PRESET_DEFINITIONS.pastel.colors.light.expenses)
    expect(vars['--chart-revenue-dark']).toBe(CHART_PRESET_DEFINITIONS.pastel.colors.dark.revenue)
  })

  it('never carry anything but a hex colour', () => {
    const prefs = { palette: 'custom', base: 'sobre', custom: { light: { revenue: 'red;background:url(x)' }, dark: {} } } as AppearancePreferences
    expect(chartStyleVariables(prefs)).toEqual({})
  })

  it('are read by globals.css for every series, with the Sobre fallback, in both themes', () => {
    for (const series of CHART_SERIES) {
      expect(css, series).toMatch(new RegExp(`--chart-${series}: var\\(--chart-${series}-light, var\\(--`))
      expect(css, series).toMatch(new RegExp(`--chart-${series}: var\\(--chart-${series}-dark, var\\(--`))
      expect(css, series).toContain(`--color-chart-${series}: var(--chart-${series});`)
    }
  })
})

describe('charts', () => {
  const ROOT = path.resolve(__dirname, '../../..')
  const CHARTS = ['components/features/dashboard/widgets/chart-widgets.tsx', 'components/features/accounting/account-balance-evolution-chart.tsx']

  it('read the series variables, never a fixed colour or a palette slot', () => {
    for (const file of CHARTS) {
      const source = readFileSync(path.join(ROOT, file), 'utf8')
      expect(source, file).not.toMatch(/var\(--chart-[1-5]\)|chart-[1-5]\b|var\(--foreground\)|#[0-9a-f]{3,6}\b/i)
      expect(source, file).toMatch(/var\(--chart-(revenue|debit)\)/)
    }
  })
})
