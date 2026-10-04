import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { THEME_COLORS } from '@/lib/pwa/paths'
import { ThemeColorSync } from '@/components/pwa/theme-color-sync'

const theme = vi.hoisted(() => ({ current: 'system' as string | undefined }))
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: theme.current }) }))
vi.mock('next/navigation', () => ({ usePathname: () => '/companies' }))

function addMeta(media: string) {
  const meta = document.createElement('meta')
  meta.name = 'theme-color'
  meta.setAttribute('media', media)
  meta.content = media.includes('dark') ? THEME_COLORS.dark : THEME_COLORS.light
  document.head.appendChild(meta)
  return meta
}

describe('ThemeColorSync', () => {
  let light: HTMLMetaElement
  let dark: HTMLMetaElement

  beforeEach(() => {
    light = addMeta('(prefers-color-scheme: light)')
    dark = addMeta('(prefers-color-scheme: dark)')
  })

  afterEach(() => {
    cleanup()
    light.remove()
    dark.remove()
  })

  it('paints the browser bar dark when Sombre is picked on a light system', () => {
    theme.current = 'dark'
    render(<ThemeColorSync />)
    expect(light.content).toBe(THEME_COLORS.dark)
    expect(dark.content).toBe(THEME_COLORS.dark)
  })

  it('follows the toggle back to Clair, then to Système', () => {
    theme.current = 'dark'
    const { rerender } = render(<ThemeColorSync />)
    theme.current = 'light'
    rerender(<ThemeColorSync />)
    expect(light.content).toBe(THEME_COLORS.light)
    expect(dark.content).toBe(THEME_COLORS.light)
    theme.current = 'system'
    rerender(<ThemeColorSync />)
    expect(light.content).toBe(THEME_COLORS.light)
    expect(dark.content).toBe(THEME_COLORS.dark)
  })
})
