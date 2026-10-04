/** Validation of chart colour preferences (lib/appearance/schema.ts). */

import { describe, expect, it } from 'vitest'
import { AppearanceBody, parseStoredAppearance, toPreferences, toStoredAppearance } from '../schema'
import { CHART_SERIES, DEFAULT_APPEARANCE } from '../palette'

const parse = (value: unknown) => AppearanceBody.safeParse(value)

describe('AppearanceBody', () => {
  it('accepts a preset alone and fills the defaults', () => {
    const parsed = parse({ palette: 'contraste' })
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ palette: 'contraste', base: 'sobre', custom: { light: {}, dark: {} } })
  })

  it('accepts a custom palette and lowercases its colours', () => {
    const parsed = parse({ palette: 'custom', base: 'pastel', custom: { light: { revenue: '#ABCDEF' }, dark: { balance: '#000000' } } })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.custom).toEqual({ light: { revenue: '#abcdef' }, dark: { balance: '#000000' } })
  })

  it.each([
    ['a colour name', 'red'],
    ['a short hex', '#abc'],
    ['hex without #', 'abcdef'],
    ['8 digit hex with alpha', '#abcdef80'],
    ['rgb()', 'rgb(0, 0, 0)'],
    ['a CSS injection', '#000000;background:url(https://evil.example)'],
    ['a var()', 'var(--chart-1)'],
    ['a number', 123456],
    ['null', null],
  ])('refuses %s as a colour', (_label, color) => {
    const parsed = parse({ palette: 'custom', custom: { light: { revenue: color }, dark: {} } })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toMatch(/#rrggbb/)
  })

  it('refuses unknown presets, palettes and starting palettes', () => {
    expect(parse({ palette: 'neon' }).success).toBe(false)
    expect(parse({ palette: 'custom', base: 'custom' }).success).toBe(false)
    expect(parse({ palette: 'custom', base: 'neon' }).success).toBe(false)
    expect(parse({}).success).toBe(false)
    expect(parse(null).success).toBe(false)
  })

  it('refuses unknown series, themes and fields', () => {
    expect(parse({ palette: 'custom', custom: { light: { profit: '#000000' }, dark: {} } }).success).toBe(false)
    expect(parse({ palette: 'custom', custom: { light: {}, dark: {}, sepia: {} } }).success).toBe(false)
    expect(parse({ palette: 'sobre', userId: 'someone-else' }).success).toBe(false)
  })

  it('refuses oversized payloads: many keys or long values never pass', () => {
    const manyKeys = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`s${i}`, '#000000']))
    expect(parse({ palette: 'custom', custom: { light: manyKeys, dark: {} } }).success).toBe(false)
    expect(parse({ palette: 'custom', custom: { light: { revenue: `#${'0'.repeat(100_000)}` }, dark: {} } }).success).toBe(false)
    expect(parse({ palette: 'sobre', padding: 'x'.repeat(100_000) }).success).toBe(false)
  })

  it('bounds a full palette to a few hundred bytes', () => {
    const full = Object.fromEntries(CHART_SERIES.map((s) => [s, '#123456']))
    const body = { palette: 'custom', base: 'sobre', custom: { light: full, dark: full } }
    expect(parse(body).success).toBe(true)
    expect(JSON.stringify(body).length).toBeLessThan(1024)
  })
})

describe('stored preferences', () => {
  it('round trip through the stored JSON', () => {
    const prefs = toPreferences(AppearanceBody.parse({ palette: 'custom', base: 'daltonisme', custom: { light: { debit: '#112233' } } }))
    expect(parseStoredAppearance(toStoredAppearance(prefs))).toEqual(prefs)
  })

  it('drop custom colours when a preset is chosen', () => {
    const prefs = toPreferences(AppearanceBody.parse({ palette: 'pastel', custom: { light: { debit: '#112233' } } }))
    expect(prefs).toEqual({ palette: 'pastel', base: 'pastel', custom: { light: {}, dark: {} } })
  })

  it('read as the defaults when missing, from another version or invalid', () => {
    expect(parseStoredAppearance(null)).toEqual(DEFAULT_APPEARANCE)
    expect(parseStoredAppearance({ version: 2, palette: 'pastel' })).toEqual(DEFAULT_APPEARANCE)
    expect(parseStoredAppearance({ version: 1, palette: 'custom', custom: { light: { revenue: 'red' } } })).toEqual(DEFAULT_APPEARANCE)
  })
})
