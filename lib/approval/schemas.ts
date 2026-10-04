/**
 * What the user tells Kledg about the approval of a fiscal year's accounts,
 * beyond what the books and the company record hold: the meeting, the
 * officers, attendance and votes, the choices on the result, the size
 * category, the management report texts and the filing. Stored as JSON
 * (accounts_approvals.details) and validated by this schema on every write.
 *
 * Pure (zod only): the form in the browser validates with the same schema.
 * Every field is optional: what a document needs and is missing is listed
 * (requirements.ts), never filled with a default value.
 */

import { z } from 'zod'

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Date invalide')
const optionalDay = z.union([z.literal('').transform(() => null), day]).nullable().optional()
const text = (max: number) =>
  z
    .string()
    .max(max, `${max} caractères au maximum`)
    .nullable()
    .optional()
    .transform((value) => (value?.trim() ? value.trim() : null))
const cents = z.number().int('Montant en centimes entier').min(0, 'Montant positif attendu').max(1e15)
const votes = z.number().int('Nombre de voix entier').min(0, 'Nombre de voix positif').max(1e12)

export const RESOLUTION_IDS = ['approval', 'agreements', 'allocation', 'powers'] as const
export type ResolutionId = (typeof RESOLUTION_IDS)[number]

export const DECISION_MODES = ['meeting', 'written', 'sole'] as const
export const ATTENDANCE_STATUSES = ['present', 'represented', 'remote', 'absent'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]
export const CONFIDENTIALITY_OPTIONS = ['none', 'full', 'income_statement', 'simplified'] as const
export type ConfidentialityOption = (typeof CONFIDENTIALITY_OPTIONS)[number]

const Person = z.object({ name: text(120), title: text(120) })

const Vote = z.object({
  /** Every holder present or represented voted for. */
  unanimous: z.boolean().default(false),
  for: votes.default(0),
  against: votes.default(0),
  abstain: votes.default(0),
})
export type VoteInput = z.infer<typeof Vote>

export const ApprovalDetailsSchema = z.object({
  decisionMode: z.enum(DECISION_MODES).nullable().optional(),
  /** City of the RCS (registre du commerce et des sociétés) the company is registered with, required on its documents. */
  rcsCity: text(80),
  meeting: z
    .object({
      date: optionalDay,
      time: text(20),
      place: text(200),
      convocationDate: optionalDay,
      /** Second consultation (SARL) or second call (SA): other majority or quorum. */
      secondCall: z.boolean().default(false),
    })
    .prefault({}),
  chair: Person.optional(),
  secretary: text(120),
  officers: z.array(Person).max(10, '10 dirigeants au maximum').default([]),
  /** Presence of each holder (shareholder id of the company). */
  attendance: z
    .array(
      z.object({
        shareholderId: z.string().max(64),
        status: z.enum(ATTENDANCE_STATUSES),
        proxy: text(120),
      }),
    )
    .max(500)
    .default([]),
  /** SAS and SCI: rule of the statuts. */
  statutoryRule: z
    .object({
      kind: z.enum(['unanimity', 'majority']),
      /** Votes counted: cast (for and against), present or represented, or all the votes of the company. */
      base: z.enum(['cast', 'present', 'all']).default('cast'),
      /** Adopted with strictly more than this share of the base, in percent (50: simple majority). */
      percent: z.number().min(0).max(100).default(50),
      /** Minimum share of the votes present or represented, in percent; null: none. */
      quorumPercent: z.number().min(0).max(100).nullable().default(null),
      /** Article of the statuts, quoted in the minutes. */
      article: text(40),
    })
    .nullable()
    .optional(),
  votes: z.partialRecord(z.enum(RESOLUTION_IDS), Vote).default({}),
  allocation: z.object({ dividendsCents: cents.default(0), otherReservesCents: cents.default(0) }).prefault({}),
  /** Dividends of the three previous fiscal years (CGI art. 243 bis); null until answered. */
  priorDividends: z
    .array(z.object({ year: z.number().int().min(1900).max(2200), amountCents: cents }))
    .max(3)
    .nullable()
    .optional(),
  /** Expenses not deductible from taxable profit (CGI art. 39, 4) the decision approves; null until answered. */
  nonDeductibleExpensesCents: cents.nullable().optional(),
  regulatedAgreements: z.enum(['none', 'some']).nullable().optional(),
  hasAuditor: z.boolean().nullable().optional(),
  auditorName: text(120),
  size: z
    .object({
      category: z.enum(['micro', 'small', 'medium', 'large']).nullable().default(null),
      employees: z.number().int().min(0).max(10_000_000).nullable().default(null),
    })
    .prefault({}),
  /** Belongs to a group that consolidates its accounts (C. com. L233-16). */
  groupMember: z.boolean().nullable().optional(),
  /** Credit institution, insurer, listed company or body raising funds from the public (L123-16-2). */
  excludedEntity: z.boolean().default(false),
  managementReport: z
    .object({
      /** Produce the report even when the company is exempt. */
      produce: z.boolean().default(false),
      activity: text(6000),
      outlook: text(4000),
      postClosingEvents: text(4000),
      research: text(4000),
    })
    .prefault({}),
  confidentiality: z.enum(CONFIDENTIALITY_OPTIONS).default('none'),
  filedOnline: z.boolean().nullable().optional(),
  /** Day the accounts were approved (the decision, or the filing worth approval). */
  approvedOn: optionalDay,
  /** Day the accounts were filed with the greffe. */
  filedOn: optionalDay,
  /** City written next to the signatures. */
  signatureCity: text(80),
})

export type ApprovalDetails = z.infer<typeof ApprovalDetailsSchema>
export type ApprovalDetailsInput = z.input<typeof ApprovalDetailsSchema>

/** The empty answer, before the user filled anything. */
export function emptyDetails(): ApprovalDetails {
  return ApprovalDetailsSchema.parse({})
}

/** Document formats: PDF to sign, Markdown to edit. */
export const DOCUMENT_FORMATS = ['pdf', 'md'] as const
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number]
