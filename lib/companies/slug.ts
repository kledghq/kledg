/**
 * Company slugs: the readable segment of company URLs (/atelier-lumen/entries).
 * The route segment accepts a slug or a raw id; see resolveCompanyRef.
 */

import { prisma } from '@/lib/prisma'
import { ValidationError, ConflictError } from '@/lib/accounting/errors'

export const SLUG_MAX_LENGTH = 60

/** Top-level paths a slug must not shadow (app routes outside the company area). */
const RESERVED_SLUGS = new Set([
  'api',
  'auth',
  'companies',
  'consent',
  'forgot-password',
  'login',
  'reset-password',
  'settings',
  'setup',
  'signup',
  'update-password',
  'new',
  'well-known',
  '_next',
])

/** Lowercase ASCII words separated by single hyphens. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Looks like a Prisma cuid: never accepted as a slug so ids and slugs can't collide. */
const CUID_PATTERN = /^c[a-z0-9]{20,}$/

/** "Atelier Lumière & Fils" -> "atelier-lumiere-fils". Empty names give "societe". */
export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[œŒ]/g, 'oe')
    .replace(/[æÆ]/g, 'ae')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '')
  if (!base || RESERVED_SLUGS.has(base) || CUID_PATTERN.test(base)) {
    return base ? `${base}-societe`.slice(0, SLUG_MAX_LENGTH) : 'societe'
  }
  return base
}

/** Returns a French error message, or null when the slug is acceptable. */
export function slugError(slug: string): string | null {
  if (slug.length < 2) return "L'identifiant doit contenir au moins 2 caractères."
  if (slug.length > SLUG_MAX_LENGTH) return `L'identifiant doit contenir au plus ${SLUG_MAX_LENGTH} caractères.`
  if (!SLUG_PATTERN.test(slug)) {
    return "L'identifiant ne peut contenir que des lettres minuscules sans accents, des chiffres et des tirets (pas en début ni en fin)."
  }
  if (RESERVED_SLUGS.has(slug)) return 'Cet identifiant est réservé.'
  if (CUID_PATTERN.test(slug)) return "Cet identifiant ressemble à un identifiant technique, choisissez-en un autre."
  return null
}

/** Appends -2, -3... to `base` until `isTaken` says the candidate is free. */
export async function uniqueSlug(base: string, isTaken: (slug: string) => Promise<boolean>): Promise<string> {
  if (!(await isTaken(base))) return base
  for (let n = 2; n < 10_000; n++) {
    const suffix = `-${n}`
    const candidate = `${base.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/g, '')}${suffix}`
    if (!(await isTaken(candidate))) return candidate
  }
  throw new ConflictError("Impossible de générer un identifiant unique pour cette société")
}

/** A free slug derived from the company name (excluding `excludeCompanyId` when renaming). */
export async function generateCompanySlug(name: string, excludeCompanyId?: string): Promise<string> {
  return uniqueSlug(slugify(name), async (slug) => {
    const existing = await prisma.company.findUnique({ where: { slug }, select: { id: true } })
    return Boolean(existing && existing.id !== excludeCompanyId)
  })
}

/** Validates a slug chosen by the user and checks it is free. */
export async function assertCompanySlugAvailable(slug: string, companyId: string): Promise<void> {
  const error = slugError(slug)
  if (error) throw new ValidationError(error)
  const existing = await prisma.company.findUnique({ where: { slug }, select: { id: true } })
  if (existing && existing.id !== companyId) {
    throw new ConflictError('Cet identifiant est déjà utilisé par une autre société.')
  }
}

/**
 * Resolves a company reference from a URL or a request (slug or id) to the
 * company id, or null when no company matches.
 */
export async function resolveCompanyRef(ref: string | null | undefined): Promise<string | null> {
  if (!ref || ref.length > 200) return null
  const byId = await prisma.company.findUnique({ where: { id: ref }, select: { id: true } })
  if (byId) return byId.id
  const bySlug = await prisma.company.findUnique({ where: { slug: ref }, select: { id: true } })
  return bySlug?.id ?? null
}
