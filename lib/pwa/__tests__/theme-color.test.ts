import { describe, expect, it } from 'vitest'
import { THEME_COLORS } from '@/lib/pwa/paths'
import { themeColorFor } from '@/lib/pwa/theme-color'

const LIGHT_MEDIA = '(prefers-color-scheme: light)'
const DARK_MEDIA = '(prefers-color-scheme: dark)'

describe('themeColorFor', () => {
  it('follows the theme picked in the app on every tag, whatever the system scheme', () => {
    expect(themeColorFor('dark', LIGHT_MEDIA)).toBe(THEME_COLORS.dark)
    expect(themeColorFor('dark', DARK_MEDIA)).toBe(THEME_COLORS.dark)
    expect(themeColorFor('light', LIGHT_MEDIA)).toBe(THEME_COLORS.light)
    expect(themeColorFor('light', DARK_MEDIA)).toBe(THEME_COLORS.light)
  })

  it('with Système or an unknown theme, keeps the color of each media query', () => {
    for (const theme of ['system', undefined]) {
      expect(themeColorFor(theme, LIGHT_MEDIA)).toBe(THEME_COLORS.light)
      expect(themeColorFor(theme, DARK_MEDIA)).toBe(THEME_COLORS.dark)
      expect(themeColorFor(theme, '(prefers-color-scheme:dark)')).toBe(THEME_COLORS.dark)
    }
  })

  it('a tag without media query gets the light color unless the app is dark', () => {
    expect(themeColorFor('system', null)).toBe(THEME_COLORS.light)
    expect(themeColorFor('dark', null)).toBe(THEME_COLORS.dark)
  })
})
