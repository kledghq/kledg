import { describe, expect, it, vi } from 'vitest'

const rows = vi.hoisted(() => [
  { id: 'cmabc0000000000000000000a', slug: 'atelier-lumen' },
  { id: 'cmabc0000000000000000000b', slug: 'atelier-lumen-2' },
])

vi.mock('@/lib/prisma', () => ({
  prisma: {
    company: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; slug?: string } }) => {
        const row = rows.find((r) => (where.id ? r.id === where.id : r.slug === where.slug))
        return row ? { id: row.id } : null
      }),
    },
  },
}))

// Slug uniqueness is instance wide, checked by a database function (row level security, docs/rls.md).
vi.mock('../identifiers', () => ({
  companyIdentifierTaken: vi.fn(async (field: string, value: string, exceptCompanyId?: string | null) =>
    rows.some((r) => field === 'slug' && r.slug === value && r.id !== exceptCompanyId),
  ),
}))

// The instance policy's slug style (lib/instance/policy.ts): numbered in Kledg, random suffix when a test turns it on.
const policy = vi.hoisted(() => ({ random: false }))
vi.mock('@/lib/instance', () => ({ randomCompanySlugSuffix: () => policy.random }))

import { companySlugFromChoice, generateCompanySlug, resolveCompanyRef, slugError, slugify, uniqueSlug, withRandomSuffix } from '../slug'

describe('slugify', () => {
  it('lowercases, removes accents and joins words with hyphens', () => {
    expect(slugify('Atelier Lumière & Fils')).toBe('atelier-lumiere-fils')
    expect(slugify("  L'Œuvre   Société  ")).toBe('l-oeuvre-societe')
    expect(slugify('SARL DUPONT-ÉLÉGANCE 2026')).toBe('sarl-dupont-elegance-2026')
  })

  it('never returns an empty, reserved or id-like slug', () => {
    expect(slugify('!!!')).toBe('societe')
    expect(slugify('Settings')).toBe('settings-societe')
    expect(slugify('API')).toBe('api-societe')
    expect(slugError(slugify('cmabc0000000000000000000a'))).toBeNull()
  })

  it('caps the length without a trailing hyphen', () => {
    const slug = slugify('a'.repeat(59) + ' b')
    expect(slug.length).toBeLessThanOrEqual(60)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('slugError', () => {
  it('accepts lowercase words separated by hyphens', () => {
    expect(slugError('atelier-lumen')).toBeNull()
    expect(slugError('sci-2')).toBeNull()
  })

  it('rejects invalid slugs with a French message', () => {
    expect(slugError('a')).toMatch(/au moins 2/)
    expect(slugError('Atelier')).toMatch(/minuscules/)
    expect(slugError('atelier--lumen')).toMatch(/minuscules/)
    expect(slugError('-atelier')).toMatch(/minuscules/)
    expect(slugError('atelier_lumen')).toMatch(/minuscules/)
    expect(slugError('ateliér')).toMatch(/minuscules/)
    expect(slugError('login')).toMatch(/réservé/)
    expect(slugError('cmabc0000000000000000000a')).toMatch(/technique/)
    expect(slugError('a'.repeat(61))).toMatch(/au plus/)
  })
})

describe('uniqueSlug', () => {
  it('appends -2, -3... until the slug is free', async () => {
    const taken = new Set(['acme', 'acme-2'])
    expect(await uniqueSlug('acme', async (s) => taken.has(s))).toBe('acme-3')
    expect(await uniqueSlug('free', async (s) => taken.has(s))).toBe('free')
  })

  it('keeps the suffix within the maximum length', async () => {
    const base = 'x'.repeat(60)
    const slug = await uniqueSlug(base, async (s) => s === base)
    expect(slug).toBe(`${'x'.repeat(58)}-2`)
  })
})

describe('generateCompanySlug', () => {
  it('derives a free slug from the name', async () => {
    expect(await generateCompanySlug('Atelier Lumen')).toBe('atelier-lumen-3')
    expect(await generateCompanySlug('Nouvelle Société')).toBe('nouvelle-societe')
  })

  it('keeps the current slug of the company being renamed', async () => {
    expect(await generateCompanySlug('Atelier Lumen', 'cmabc0000000000000000000a')).toBe('atelier-lumen')
  })
})

describe('companySlugFromChoice', () => {
  it('keeps a free slug and refuses one held by another company (409)', async () => {
    expect(await companySlugFromChoice('bureau-neuf', 'cmabc0000000000000000000a')).toBe('bureau-neuf')
    await expect(companySlugFromChoice('atelier-lumen-2', 'cmabc0000000000000000000a')).rejects.toThrow(/déjà utilisé/)
    await expect(companySlugFromChoice('Pas Valide', 'cmabc0000000000000000000a')).rejects.toThrow(/minuscules/)
  })
})

describe('random slug suffix (instance policy, KLEDG-R3-CLOUD-01)', () => {
  const SUFFIXED = /^atelier-lumen-[a-z0-9]{6}$/

  it('suffixes generated slugs whether the name is free or not', async () => {
    policy.random = true
    try {
      expect(await generateCompanySlug('Atelier Lumen')).toMatch(SUFFIXED)
      expect(await generateCompanySlug('Nouvelle Société')).toMatch(/^nouvelle-societe-[a-z0-9]{6}$/)
    } finally {
      policy.random = false
    }
  })

  it('answers a chosen slug the same way whether another company holds it or not', async () => {
    policy.random = true
    try {
      // atelier-lumen is held by another company, atelier-lumen-x is free: no 409 either way.
      expect(await companySlugFromChoice('atelier-lumen', 'cmabc0000000000000000000b')).toMatch(SUFFIXED)
      expect(await companySlugFromChoice('atelier-lumen-x', 'cmabc0000000000000000000b')).toMatch(/^atelier-lumen-x-[a-z0-9]{6}$/)
      await expect(companySlugFromChoice('Pas Valide', 'cmabc0000000000000000000b')).rejects.toThrow(/minuscules/)
    } finally {
      policy.random = false
    }
  })

  it('keeps suffixed slugs valid and within the maximum length', () => {
    for (const base of ['x'.repeat(60), 'acme', '']) {
      const slug = withRandomSuffix(base)
      expect(slug.length).toBeLessThanOrEqual(60)
      expect(slugError(slug)).toBeNull()
    }
  })
})

describe('resolveCompanyRef', () => {
  it('resolves an id or a slug to the company id', async () => {
    expect(await resolveCompanyRef('cmabc0000000000000000000a')).toBe('cmabc0000000000000000000a')
    expect(await resolveCompanyRef('atelier-lumen-2')).toBe('cmabc0000000000000000000b')
  })

  it('returns null for unknown or empty references', async () => {
    expect(await resolveCompanyRef('nope')).toBeNull()
    expect(await resolveCompanyRef('')).toBeNull()
    expect(await resolveCompanyRef(null)).toBeNull()
  })
})
