/**
 * Chart colour preferences service (lib/appearance/appearance.service.ts),
 * with Prisma, the rate limit and the instance policy mocked: every query
 * keyed by the user's id, the defaults for a user who never saved colours or
 * whose stored row is no longer valid, the policy refusal, and the inline
 * style of <html> (none for Sobre, none when the database fails).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ refused: new Set<string>() }))

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn(async () => {}) }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
// The real policy (every hook and constant of the extension point), with the two refusals replaced.
vi.mock('@/lib/instance/policy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/instance/policy')>()),
  isActionAllowed: vi.fn(async (action: string) => !state.refused.has(action)),
  actionRefusalMessage: vi.fn(() => 'Refusé par la politique de cette instance.'),
}))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { enforceRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ForbiddenError } from '@/lib/accounting/errors'
import { DEFAULT_APPEARANCE } from '@/lib/appearance/palette'
import { chartStyleForUser, getAppearance, saveAppearance } from '@/lib/appearance/appearance.service'

const db = asPrismaMock(prisma)
const MARIE = { id: 'u-marie', email: 'marie@acme.fr', role: 'user' }

const stored = (palette: string, extra: Record<string, unknown> = {}) => ({
  appearance: { version: 1, palette, base: palette === 'custom' ? 'sobre' : palette, custom: { light: {}, dark: {} }, ...extra },
})

beforeEach(() => {
  vi.clearAllMocks()
  state.refused = new Set()
  db.userPreference.findUnique.mockResolvedValue(null)
  db.userPreference.upsert.mockResolvedValue({})
})

describe('getAppearance', () => {
  it('returns the defaults to a user who never saved colours, reading their own row only', async () => {
    expect(await getAppearance(MARIE)).toEqual({ appearance: DEFAULT_APPEARANCE, isDefault: true, canChange: true, refusal: null })
    expect(db.userPreference.findUnique).toHaveBeenCalledWith({ where: { userId: 'u-marie' }, select: { appearance: true } })
  })

  it('returns the stored palette, and the defaults for a row in an unknown format', async () => {
    db.userPreference.findUnique.mockResolvedValue(stored('pastel'))
    expect((await getAppearance(MARIE)).appearance).toEqual({ palette: 'pastel', base: 'pastel', custom: { light: {}, dark: {} } })

    db.userPreference.findUnique.mockResolvedValue({ appearance: { version: 99, palette: 'neon' } })
    expect(await getAppearance(MARIE)).toMatchObject({ appearance: DEFAULT_APPEARANCE, isDefault: false })
  })

  it('says when the instance does not let the user change colours', async () => {
    state.refused.add('change-appearance')
    expect(await getAppearance(MARIE)).toMatchObject({ canChange: false, refusal: 'Refusé par la politique de cette instance.' })
  })
})

describe('saveAppearance', () => {
  it('stores a custom palette with its format version, keyed by the user, after the rate limit', async () => {
    const view = await saveAppearance(MARIE, { palette: 'custom', base: 'contraste', custom: { light: { revenue: '#112233' }, dark: {} } })
    expect(view).toEqual({
      appearance: { palette: 'custom', base: 'contraste', custom: { light: { revenue: '#112233' }, dark: {} } },
      isDefault: false,
      canChange: true,
      refusal: null,
    })
    expect(enforceRateLimit).toHaveBeenCalledWith('account-appearance', 'u-marie')
    const appearance = { version: 1, palette: 'custom', base: 'contraste', custom: { light: { revenue: '#112233' }, dark: {} } }
    expect(db.userPreference.upsert).toHaveBeenCalledWith({
      where: { userId: 'u-marie' },
      create: { userId: 'u-marie', appearance },
      update: { appearance },
    })
  })

  it('drops custom colours sent with a preset', async () => {
    const view = await saveAppearance(MARIE, { palette: 'daltonisme', base: 'sobre', custom: { light: { revenue: '#112233' }, dark: {} } })
    expect(view.appearance).toEqual({ palette: 'daltonisme', base: 'daltonisme', custom: { light: {}, dark: {} } })
  })

  it('is refused (403) by an instance that restricts it, before the rate limit and any write', async () => {
    state.refused.add('change-appearance')
    const error = await saveAppearance(MARIE, { palette: 'pastel', base: 'sobre', custom: { light: {}, dark: {} } }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ForbiddenError)
    expect((error as Error).message).toBe('Refusé par la politique de cette instance.')
    expect(enforceRateLimit).not.toHaveBeenCalled()
    expect(db.userPreference.upsert).not.toHaveBeenCalled()
  })
})

describe('chartStyleForUser', () => {
  it('sets nothing without a user, for the defaults, or for Sobre', async () => {
    expect(await chartStyleForUser(null)).toBeUndefined()
    expect(await chartStyleForUser(undefined)).toBeUndefined()
    expect(db.userPreference.findUnique).not.toHaveBeenCalled()
    expect(await chartStyleForUser('u-marie')).toBeUndefined()
    db.userPreference.findUnique.mockResolvedValue(stored('sobre'))
    expect(await chartStyleForUser('u-marie')).toBeUndefined()
  })

  it('sets the light and dark variables of the colours a custom palette changes, in lowercase', async () => {
    db.userPreference.findUnique.mockResolvedValue(stored('custom', { custom: { light: { revenue: '#AABBCC' }, dark: { balance: '#0F0F0F' } } }))
    expect(await chartStyleForUser('u-marie')).toEqual({ '--chart-revenue-light': '#aabbcc', '--chart-balance-dark': '#0f0f0f' })
  })

  it('sets every series of a preset other than Sobre', async () => {
    db.userPreference.findUnique.mockResolvedValue(stored('contraste'))
    const style = (await chartStyleForUser('u-marie')) as Record<string, string>
    expect(Object.keys(style)).toHaveLength(14)
    expect(Object.values(style).every((color) => /^#[0-9a-f]{6}$/.test(color))).toBe(true)
  })

  it('keeps the default colours when the database fails, with a warning', async () => {
    db.userPreference.findUnique.mockRejectedValue(new Error('Connection terminated'))
    expect(await chartStyleForUser('u-marie')).toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith('Chart colours not loaded, defaults used:', 'Connection terminated')
  })
})
