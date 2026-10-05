/**
 * Schema of the invoice numbering configuration (companies.invoiceNumbering),
 * shared by the API, the MCP tool and the settings form. Pure: zod only.
 */

import { z } from 'zod'
import { CREDIT_NOTE_SERIES, DEFAULT_NUMBERING, MAX_SEQUENCE, NUMBERING_MODES, RESETS, SEPARATORS, YEAR_FORMATS, numberingProblems, type InvoiceNumberingSettings } from './format'

const prefix = (label: string) => z.string({ error: `${label} invalide` }).trim().max(20, `${label} : 20 caractères au plus`)

export const InvoiceNumberingSettingsSchema = z
  .object({
    mode: z.enum(NUMBERING_MODES, { error: 'Choisissez une numérotation automatique ou saisie' }),
    prefix: prefix('Préfixe'),
    year: z.enum(YEAR_FORMATS, { error: 'Format de l’année invalide' }),
    month: z.boolean(),
    separator: z.enum(SEPARATORS, { error: 'Séparateur invalide' }),
    padding: z.number({ error: 'Nombre de chiffres invalide' }).int().min(1, 'La séquence compte de 1 à 9 chiffres.').max(9, 'La séquence compte de 1 à 9 chiffres.'),
    reset: z.enum(RESETS, { error: 'Remise à zéro invalide' }),
    creditNotes: z.enum(CREDIT_NOTE_SERIES, { error: 'Série des avoirs invalide' }),
    creditNotePrefix: prefix('Préfixe des avoirs'),
    qontoFirst: z.boolean().nullable(),
  })
  .superRefine((settings, ctx) => {
    for (const message of numberingProblems(settings)) ctx.addIssue({ code: 'custom', message })
  })

const nextNumber = z.number({ error: 'Prochain numéro invalide' }).int('Prochain numéro invalide').min(1, 'Le prochain numéro est au moins 1').max(MAX_SEQUENCE, 'Prochain numéro trop grand')

/** Body of PUT /api/companies/[id]/invoice-numbering: the configuration, and optionally where the series of the current period resumes. */
export const InvoiceNumberingBodySchema = z.object({
  settings: InvoiceNumberingSettingsSchema,
  /** Next sequence of the current period (a company coming from another tool): only upward, never onto a number already given. */
  nextNumbers: z.object({ invoice: nextNumber.optional(), creditNote: nextNumber.optional() }).optional(),
})
export type InvoiceNumberingBody = z.infer<typeof InvoiceNumberingBodySchema>

/** The stored configuration, the defaults for what is missing or unreadable. */
export function readNumberingSettings(stored: unknown): InvoiceNumberingSettings {
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_NUMBERING }
  const parsed = InvoiceNumberingSettingsSchema.safeParse({ ...DEFAULT_NUMBERING, ...(stored as Record<string, unknown>) })
  return parsed.success ? parsed.data : { ...DEFAULT_NUMBERING }
}
