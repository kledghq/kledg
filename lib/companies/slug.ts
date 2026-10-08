/**
 * Company slugs: the readable segment of company URLs (/atelier-lumen/entries).
 * The route segment accepts a slug or a raw id; see resolveCompanyRef.
 */

import { randomInt } from 'crypto'
import { prisma } from '@/lib/prisma'
import { randomCompanySlugSuffix } from '@/lib/instance'
import { companyIdentifierTaken } from './identifiers'
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

/** Letters and digits of random slug suffixes. */
const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
export const RANDOM_SUFFIX_LENGTH = 6

/** `base` followed by a random suffix of 6 letters and digits ("atelier-lumen-k3x9q2"), within the length limit. */
export function withRandomSuffix(base: string): string {
  let suffix = '-'
  for (let i = 0; i < RANDOM_SUFFIX_LENGTH; i++) suffix += SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)]
  const head = base.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/g, '')
  return `${head || 'societe'}${suffix}`
}

/**
 * A free slug with a random suffix: the answer never depends on the slugs
 * other companies hold (a collision, about one in two billion, draws again).
 */
async function randomSlug(base: string, excludeCompanyId?: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = withRandomSuffix(base)
    if (!(await companyIdentifierTaken('slug', candidate, excludeCompanyId))) return candidate
  }
  throw new ConflictError("Impossible de générer un identifiant unique pour cette société")
}

/**
 * A free slug derived from the company name (excluding `excludeCompanyId`
 * when renaming): numbered on collision, or with a random suffix when the
 * instance policy asks for one (randomCompanySlugSuffix).
 */
export async function generateCompanySlug(name: string, excludeCompanyId?: string): Promise<string> {
  if (randomCompanySlugSuffix()) return randomSlug(slugify(name), excludeCompanyId)
  return uniqueSlug(slugify(name), (slug) => companyIdentifierTaken('slug', slug, excludeCompanyId))
}

/**
 * Validates a slug chosen by the user and returns the slug to store: the
 * slug itself when free, a 409 when another company holds it. When the
 * instance policy asks for random suffixes, the chosen slug gets one and is
 * never refused for being taken, so the answer tells nothing about the
 * companies the user cannot see.
 */
export async function companySlugFromChoice(slug: string, companyId: string): Promise<string> {
  const error = slugError(slug)
  if (error) throw new ValidationError(error)
  if (randomCompanySlugSuffix()) return randomSlug(slug, companyId)
  if (await companyIdentifierTaken('slug', slug, companyId)) {
    throw new ConflictError('Cet identifiant est déjà utilisé par une autre société.')
  }
  return slug
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
