import { describe, expect, it } from 'vitest'
import { companyHomePath, DEFAULT_DISPLAY_MODE, DisplayModeBody, parseDisplayMode } from '../display-mode'

describe('display mode', () => {
  it('defaults to expert, so users who never chose see no change', () => {
    expect(DEFAULT_DISPLAY_MODE).toBe('expert')
  })

  it('reads stored values strictly', () => {
    expect(parseDisplayMode('simple')).toBe('simple')
    expect(parseDisplayMode('expert')).toBe('expert')
    expect(parseDisplayMode('SIMPLE')).toBeNull()
    expect(parseDisplayMode(null)).toBeNull()
    expect(parseDisplayMode(undefined)).toBeNull()
  })

  it('accepts the two modes only, and nothing else in the body', () => {
    expect(DisplayModeBody.parse({ mode: 'simple' })).toEqual({ mode: 'simple' })
    const unknown = DisplayModeBody.safeParse({ mode: 'debutant' })
    expect(unknown.success).toBe(false)
    expect(unknown.error?.issues[0].message).toBe("Mode d'affichage inconnu : simple ou expert")
    expect(DisplayModeBody.safeParse({ mode: 'simple', userId: 'u-other' }).success).toBe(false)
  })

  it('opens a company on the home of the mode', () => {
    expect(companyHomePath('atelier-lumen', 'simple')).toBe('/atelier-lumen/simple')
    expect(companyHomePath('atelier-lumen', 'expert')).toBe('/atelier-lumen')
  })
})
