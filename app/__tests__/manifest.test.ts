/**
 * The web app manifest (app/manifest.ts) and the icons it points to.
 * Installability needs a name, a start URL, standalone display and PNG
 * icons of 192 and 512 pixels (Chromium's install criteria).
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import manifest from '@/app/manifest'
import { THEME_COLORS } from '@/lib/pwa/paths'

const ROOT = path.resolve(__dirname, '../..')

/** Width and height from the IHDR chunk of a PNG file. */
function pngSize(file: string): { width: number; height: number } {
  const buffer = readFileSync(file)
  expect(buffer.subarray(1, 4).toString('ascii')).toBe('PNG')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

describe('web app manifest', () => {
  const m = manifest()

  it('describes Kledg in French', () => {
    expect(m.name).toBe('Kledg')
    expect(m.short_name).toBe('Kledg')
    expect(m.lang).toBe('fr')
    expect(m.description).toMatch(/^Comptabilité/)
    expect(m.categories).toEqual(['finance', 'business'])
  })

  it('opens standalone on the root, scoped to the whole app', () => {
    expect(m.id).toBe('/')
    expect(m.start_url).toBe('/')
    expect(m.scope).toBe('/')
    expect(m.display).toBe('standalone')
    expect(m.orientation).toBe('any')
  })

  it('uses the monochrome background of the app', () => {
    expect(m.background_color).toBe(THEME_COLORS.light)
    expect(m.theme_color).toBe(THEME_COLORS.light)
    expect(THEME_COLORS).toEqual({ light: '#ffffff', dark: '#0a0a0a' })
  })

  it('points to committed PNG icons of the declared sizes, with a maskable one', () => {
    const icons = m.icons ?? []
    expect(icons.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual(['192x192 any', '512x512 any', '512x512 maskable'])
    for (const icon of icons) {
      const file = path.join(ROOT, 'public', icon.src)
      expect(existsSync(file), icon.src).toBe(true)
      expect(icon.type).toBe('image/png')
      const [width, height] = (icon.sizes ?? '').split('x').map(Number)
      expect(pngSize(file)).toEqual({ width, height })
    }
  })

  it('has a 180px Apple touch icon (app/apple-icon.png, linked by Next.js)', () => {
    expect(pngSize(path.join(ROOT, 'app/apple-icon.png'))).toEqual({ width: 180, height: 180 })
  })
})
