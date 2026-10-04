/**
 * Validation schemas for company information forms
 * 
 * This module contains Zod schemas for validating company and shareholder data.
 */

import * as z from 'zod'
import { addressSchema } from '@/lib/utils/address'
import { LEGAL_TYPES } from '@/lib/companies/legal-forms'

/**
 * Client-side copy of the slug rules of lib/companies/slug.ts (slugError),
 * which can't be imported here (it uses the database). The API validates again.
 */
const SLUG_MAX_LENGTH = 60
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
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CUID_PATTERN = /^c[a-z0-9]{20,}$/

/** Returns a French error message, or null when the slug is acceptable. */
export function companySlugError(slug: string): string | null {
  if (slug.length < 2) return "L'identifiant doit contenir au moins 2 caractères."
  if (slug.length > SLUG_MAX_LENGTH) return `L'identifiant doit contenir au plus ${SLUG_MAX_LENGTH} caractères.`
  if (!SLUG_PATTERN.test(slug)) {
    return "L'identifiant ne peut contenir que des lettres minuscules sans accents, des chiffres et des tirets (pas en début ni en fin)."
  }
  if (RESERVED_SLUGS.has(slug)) return 'Cet identifiant est réservé.'
  if (CUID_PATTERN.test(slug)) return 'Cet identifiant ressemble à un identifiant technique, choisissez-en un autre.'
  return null
}

/**
 * Company information schema
 */
export const companySchema = z.object({
  name: z.string().min(1, 'Le nom est requis'),
  slug: z.string().superRefine((value, ctx) => {
    const error = companySlugError(value)
    if (error) ctx.addIssue({ code: 'custom', message: error })
  }),
  siren: z.string().min(9, 'Le SIREN doit contenir 9 chiffres').max(9, 'Le SIREN doit contenir 9 chiffres').regex(/^\d{9}$/, 'Le SIREN doit contenir exactement 9 chiffres'),
  phone: z.string().optional(),
  email: z.string().email('Email invalide').optional().or(z.literal('')),
  logo: z.string().optional(),
  foundationDate: z.string().optional(),
  closingDay: z.number().min(1).max(31).optional(),
  closingMonth: z.number().min(1).max(12).optional(),
  vatRegime: z.string().optional(),
  isVatExempt: z.boolean().optional(),
  vatExemptReason: z.string().optional(),
  corporateTaxRegime: z.string().optional(),
  legalType: z.enum(LEGAL_TYPES).optional(),
  totalShares: z.number().int().positive().optional(),
  shareNominalValue: z.number().positive().optional(),
  sector: z.enum(['tech', 'retail', 'services', 'manufacturing', 'real-estate', 'finance', 'healthcare', 'consulting', 'construction', 'hospitality', 'transport', 'education', 'agriculture', 'energy', 'media', 'craft', 'wholesale', 'automotive', 'fashion', 'publishing', 'other']).optional(),
  isHolding: z.boolean().optional(),
  defaultBankAccountCode: z.string().optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Couleur invalide (format hex: #RRGGBB)')
    .optional()
    .or(z.literal('')),
  // shareCapital est calculé automatiquement (totalShares × shareNominalValue), pas besoin dans le schéma
})

/**
 * Shareholder schema
 */
export const shareholderSchema = z.object({
  type: z.enum(['PHYSICAL', 'LEGAL']),
  name: z.string().optional(), // Optionnel si companyShareholderId est fourni
  siret: z.string().optional(),
  sharePercentage: z.number().min(0).max(100, 'Le pourcentage doit être entre 0 et 100'),
  numberOfShares: z.number().int().positive().optional(),
  capitalAmount: z.number().optional(),
  companyShareholderId: z.string().optional(), // ID de la société actionnaire si type=LEGAL
  notes: z.string().optional(),
  personId: z.string().optional(), // ID de la personne existante si type=PHYSICAL (required for PHYSICAL)
  createPerson: z.boolean().optional(), // Créer une personne si type=PHYSICAL
}).refine((data) => {
  // For PHYSICAL, personId is required
  if (data.type === 'PHYSICAL') {
    return !!data.personId
  }
  // For LEGAL without companyShareholderId, name is required
  if (data.type === 'LEGAL' && !data.companyShareholderId) {
    return !!data.name
  }
  return true
}, {
  message: 'Pour une personne physique, vous devez sélectionner une personne. Pour une personne morale, le nom est requis si ce n\'est pas une société.',
})

/**
 * Type inference for company form data
 */
export type CompanyFormData = z.infer<typeof companySchema>

/**
 * Type inference for shareholder form data
 */
export type ShareholderFormData = z.infer<typeof shareholderSchema>
