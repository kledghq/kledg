/**
 * What the user tells Kledg for the annexe of a fiscal year, beyond what the
 * books, the register of methods and the approval hold: commitments off the
 * balance sheet, events after the closing, advances and remuneration of the
 * officers, maturities of receivables and debts, tax credits, headcount...
 * Stored as JSON (annexe_notes.details), validated by this schema on every
 * write. Pure (zod only): the form in the browser validates with it too.
 *
 * Every answer is null until the user gives it: a note that needs it lists
 * it as missing (build-annexe.ts), never fills it with a default. "none"
 * records an explicit "Néant".
 */

import { z } from 'zod'

const text = (max: number) =>
  z
    .string()
    .max(max, `${max} caractères au maximum`)
    .nullable()
    .optional()
    .transform((value) => (value?.trim() ? value.trim() : null))
const cents = z.number().int('Montant en centimes entier').min(0, 'Montant positif attendu').max(1e15, 'Montant trop élevé')

/** A free answer: "none" (Néant) or a text. */
const Answer = z
  .object({ none: z.boolean().default(false), text: text(6000) })
  .refine((a) => a.none || a.text !== null, { message: 'Écrivez le texte, ou cochez « Néant »' })
  .nullable()
  .default(null)

export const COMMITMENT_KINDS = ['guarantee_given', 'guarantee_received', 'security', 'leasing', 'pension', 'related_entities', 'other'] as const
export type CommitmentKind = (typeof COMMITMENT_KINDS)[number]
export const COMMITMENT_LABELS: Record<CommitmentKind, string> = {
  guarantee_given: 'Cautions, avals et garanties donnés',
  guarantee_received: 'Engagements reçus',
  security: 'Sûretés réelles consenties',
  leasing: 'Crédit-bail',
  pension: 'Engagements de retraite et avantages similaires',
  related_entities: 'Engagements envers des entités liées',
  other: 'Autres engagements et opérations non inscrites au bilan',
}

const Commitment = z.object({
  kind: z.enum(COMMITMENT_KINDS),
  description: z.string().trim().min(1, "Décrivez l'engagement").max(1000),
  /** Amount of the commitment (leasing: rents still to pay). */
  amountCents: cents.nullable().default(null),
  /** Leasing: residual purchase price (PCG art. 836-3). */
  residualCents: cents.nullable().default(null),
})

const Participation = z.object({
  name: z.string().trim().min(1, 'Nom de la société').max(200),
  siren: z.string().regex(/^\d{9}$/, 'SIREN à 9 chiffres').nullable().default(null),
  /** Share of the capital held, in percent. */
  sharePercent: z.number().min(0).max(100),
  capitalCents: cents.nullable().default(null),
  equityCents: z.number().int().min(-1e15).max(1e15).nullable().default(null),
  revenueCents: cents.nullable().default(null),
  resultCents: z.number().int().min(-1e15).max(1e15).nullable().default(null),
  dividendsCents: cents.nullable().default(null),
})

export const AnnexeDetailsSchema = z.object({
  /** Derogations to the general rules or to the length of the year (PCG art. 831-1, 2°). */
  derogations: Answer,
  /** Events after the closing without a direct link with a situation at the closing (PCG art. 831-1, 4°). */
  postClosingEvents: Answer,
  /** Any other significant information (PCG art. 831-1, 5°), optional. */
  otherInformation: text(6000),
  /** Commitments off the balance sheet (PCG art. 836-1 to 836-5, 811-7 for a micro-entreprise). */
  commitments: z
    .object({ none: z.boolean().default(false), items: z.array(Commitment).max(50, '50 engagements au maximum').default([]) })
    .refine((c) => c.none || c.items.length > 0, { message: 'Ajoutez les engagements, ou cochez « Néant »' })
    .nullable()
    .default(null),
  /** Advances and credits granted to the officers (PCG art. 835-1, 811-7). */
  directorAdvances: z
    .object({ none: z.boolean().default(false), amountCents: cents.nullable().default(null), conditions: text(2000) })
    .refine((d) => d.none || d.amountCents !== null, { message: 'Indiquez le montant, ou cochez « Néant »' })
    .nullable()
    .default(null),
  /** Remuneration of the officers, global amount (PCG art. 835-2); omitted when it would identify one person. */
  directorRemuneration: z
    .object({ omitted: z.boolean().default(false), amountCents: cents.nullable().default(null) })
    .refine((d) => d.omitted || d.amountCents !== null, { message: 'Indiquez le montant global, ou précisez qu’il identifierait un dirigeant' })
    .nullable()
    .default(null),
  /** Average headcount of the year (PCG art. 837-1, C. com. D123-200); null: the one of the approval. */
  employees: z.number().int().min(0).max(10_000_000).nullable().default(null),
  /** Tax credits of the year (PCG art. 833-2). */
  taxCredits: z
    .object({ none: z.boolean().default(false), items: z.array(z.object({ label: z.string().trim().min(1).max(200), amountCents: cents })).max(20).default([]) })
    .refine((c) => c.none || c.items.length > 0, { message: "Ajoutez les crédits d'impôt, ou cochez « Néant »" })
    .nullable()
    .default(null),
  /** Part of the receivables at the closing due in more than one year (PCG art. 832-9). */
  receivableMaturities: z.object({ overOneYearCents: cents }).nullable().default(null),
  /** Part of the debts at the closing due in more than one year, and in more than five years (PCG art. 832-15). */
  debtMaturities: z
    .object({ overOneYearCents: cents, overFiveYearsCents: cents })
    .refine((m) => m.overFiveYearsCents <= m.overOneYearCents, { message: 'La part à plus de cinq ans est comprise dans la part à plus d’un an' })
    .nullable()
    .default(null),
  /** Transactions with related parties not concluded at normal market conditions (PCG art. 834-2). */
  relatedParties: Answer,
  /** Entity consolidating the company's accounts (PCG art. 831-4). */
  consolidatingEntity: z
    .object({ name: z.string().trim().min(1).max(200), seat: z.string().trim().min(1).max(300), siren: z.string().regex(/^\d{9}$/, 'SIREN à 9 chiffres').nullable().default(null), copiesAt: text(300) })
    .nullable()
    .default(null),
  /** Companies held whose titres (261) Kledg cannot attribute to a company it holds (PCG art. 832-5). */
  externalParticipations: z.array(Participation).max(50).nullable().default(null),
})

export type AnnexeDetails = z.infer<typeof AnnexeDetailsSchema>
export type AnnexeDetailsInput = z.input<typeof AnnexeDetailsSchema>

export function emptyAnnexeDetails(): AnnexeDetails {
  return AnnexeDetailsSchema.parse({})
}

/** ?fiscalYearId= of GET /api/annexe. */
export const AnnexeQuerySchema = z.object({ fiscalYearId: z.string({ error: "L'exercice est requis" }).min(1, "L'exercice est requis").max(64) })

/** Body of PUT /api/annexe. */
export const AnnexeBodySchema = z.object({
  companyId: z.string(),
  fiscalYearId: z.string({ error: "L'exercice est requis" }).min(1, "L'exercice est requis").max(64),
  details: AnnexeDetailsSchema,
})

/** ?fiscalYearId=&format= of GET /api/annexe/export. */
export const AnnexeExportQuerySchema = AnnexeQuerySchema.extend({
  format: z.enum(['pdf', 'md'], { error: 'Format attendu : pdf ou md' }).optional().default('pdf'),
})
