import { describe, expect, it } from 'vitest'
import {
  companyHomePath,
  DEFAULT_DISPLAY_MODE,
  DISPLAY_MODE_DESCRIPTIONS,
  DISPLAY_MODE_LABELS,
  DISPLAY_MODES,
  DisplayModeBody,
  parseDisplayMode,
  vocabularyOf,
} from '../display-mode'

describe('display mode', () => {
  it('defaults to expert, so users who never chose see no change', () => {
    expect(DEFAULT_DISPLAY_MODE).toBe('expert')
  })

  it('reads stored values strictly', () => {
    expect(parseDisplayMode('simple')).toBe('simple')
    expect(parseDisplayMode('standard')).toBe('standard')
    expect(parseDisplayMode('expert')).toBe('expert')
    expect(parseDisplayMode('Standard')).toBeNull()
    expect(parseDisplayMode('SIMPLE')).toBeNull()
    expect(parseDisplayMode(null)).toBeNull()
    expect(parseDisplayMode(undefined)).toBeNull()
  })

  it('accepts the three modes only, and nothing else in the body', () => {
    expect(DisplayModeBody.parse({ mode: 'simple' })).toEqual({ mode: 'simple' })
    expect(DisplayModeBody.parse({ mode: 'standard' })).toEqual({ mode: 'standard' })
    expect(DisplayModeBody.parse({ mode: 'expert' })).toEqual({ mode: 'expert' })
    const unknown = DisplayModeBody.safeParse({ mode: 'debutant' })
    expect(unknown.success).toBe(false)
    expect(unknown.error?.issues[0].message).toBe("Mode d'affichage inconnu : simple, standard ou expert")
    expect(DisplayModeBody.safeParse({ mode: 'simple', userId: 'u-other' }).success).toBe(false)
  })

  it('opens a company on the home of the mode', () => {
    expect(companyHomePath('atelier-lumen', 'simple')).toBe('/atelier-lumen/simple')
    expect(companyHomePath('atelier-lumen', 'expert')).toBe('/atelier-lumen')
    // Standard opens the dashboard, like expert: never the simple home
    expect(companyHomePath('atelier-lumen', 'standard')).toBe('/atelier-lumen')
  })

  it('orders the modes from the simplest, each with its label and one-line description', () => {
    expect(DISPLAY_MODES).toEqual(['simple', 'standard', 'expert'])
    expect(DISPLAY_MODE_LABELS).toEqual({ simple: 'Simple', standard: 'Standard', expert: 'Expert' })
    expect(DISPLAY_MODE_DESCRIPTIONS).toEqual({ simple: 'Sans jargon comptable', standard: 'Les pages du quotidien', expert: 'Toutes les pages' })
  })

  it('gives Standard the expert pages and words: only its sidebar differs', () => {
    expect(vocabularyOf('simple')).toBe('simple')
    expect(vocabularyOf('standard')).toBe('expert')
    expect(vocabularyOf('expert')).toBe('expert')
  })
})
