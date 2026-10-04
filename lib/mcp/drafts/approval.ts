/**
 * Draft-level tool of the approval of the accounts
 * (docs/approbation-des-comptes.md): update_year_end_formalities fills what
 * the user tells Kledg about the approval of a fiscal year (dates, size
 * category, decision mode, meeting, votes, allocation choices, filing
 * options), merged into what is already saved, validated by the same
 * schema as the page (ApprovalDetailsSchema) and saved by the same service
 * as PUT /api/companies/[id]/fiscal-years/[fiscalYearId]/approval, with its
 * right (closing:execute).
 *
 * It never generates a document (minutes, report, filing pack), never
 * books the allocation of the result (allocate_result, full control) and
 * never files anything: the user reviews the pack and generates the
 * documents in Kledg.
 */

import { z } from 'zod'
import { parseInput } from '@/lib/api/zod-fields'
import { getApproval } from '@/lib/approval/get-approval.service'
import { saveApproval } from '@/lib/approval/save-approval.service'
import { ApprovalDetailsSchema, CONFIDENTIALITY_OPTIONS, DECISION_MODES, RESOLUTION_IDS, type ApprovalDetails } from '@/lib/approval/schemas'
import { centsFromEuros, eurosInput, kledgPageUrl } from '@/lib/mcp/tool-meta'
import { draftTool, type RegisterDraftTool } from './define'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ')
const text = (max: number) => z.string().max(max).nullable().optional()
const votes = z.number().int().min(0).max(1e12)

const input = {
  fiscalYearId: z.string().min(1, "L'exercice est requis").max(64).describe('Fiscal year whose accounts are approved, from list_fiscal_years.'),
  decisionMode: z.enum(DECISION_MODES).nullable().optional().describe('meeting (assemblée), written (consultation écrite) or sole (associé unique).'),
  rcsCity: text(80).describe('City of the RCS the company is registered with.'),
  meeting: z
    .object({
      date: day.nullable().optional(),
      time: text(20),
      place: text(200),
      convocationDate: day.nullable().optional(),
      secondCall: z.boolean().optional(),
    })
    .optional()
    .describe('Meeting or decision: only the fields given change.'),
  chair: z.object({ name: text(120), title: text(120) }).optional(),
  secretary: text(120),
  hasAuditor: z.boolean().nullable().optional(),
  auditorName: text(120),
  regulatedAgreements: z.enum(['none', 'some']).nullable().optional().describe('Conventions réglementées of the year.'),
  size: z
    .object({
      category: z.enum(['micro', 'small', 'medium', 'large']).nullable().optional(),
      employees: z.number().int().min(0).max(10_000_000).nullable().optional(),
    })
    .optional()
    .describe('Size category (C. com. L123-16) and headcount.'),
  groupMember: z.boolean().nullable().optional().describe('Belongs to a group that consolidates its accounts (C. com. L233-16).'),
  votes: z
    .partialRecord(z.enum(RESOLUTION_IDS), z.object({ unanimous: z.boolean().default(false), for: votes.default(0), against: votes.default(0), abstain: votes.default(0) }))
    .optional()
    .describe('Votes per resolution (approval, agreements, allocation, powers); a resolution given replaces its votes.'),
  allocation: z
    .object({ dividends: eurosInput.min(0).optional(), otherReserves: eurosInput.min(0).optional() })
    .optional()
    .describe('Allocation proposed to the decision, in euros (Kledg computes the legal reserve and the retained earnings).'),
  priorDividends: z
    .array(z.object({ year: z.number().int().min(1900).max(2200), amount: eurosInput.min(0) }))
    .max(3)
    .nullable()
    .optional()
    .describe('Dividends of the three previous fiscal years (CGI art. 243 bis), in euros.'),
  nonDeductibleExpenses: eurosInput.min(0).nullable().optional().describe('Expenses not deductible (CGI art. 39, 4), in euros.'),
  confidentiality: z.enum(CONFIDENTIALITY_OPTIONS).optional(),
  filedOnline: z.boolean().nullable().optional(),
  approvedOn: day.nullable().optional().describe('Day the accounts were approved, after the closing.'),
  filedOn: day.nullable().optional().describe('Day the accounts were filed with the greffe.'),
  signatureCity: text(80),
}

type Input = z.infer<z.ZodObject<typeof input>>

const SCALARS = ['decisionMode', 'rcsCity', 'secretary', 'hasAuditor', 'auditorName', 'regulatedAgreements', 'groupMember', 'confidentiality', 'filedOnline', 'approvedOn', 'filedOn', 'signatureCity'] as const

/** What is saved, with the fields given replacing theirs (objects merged one level down). */
function merged(current: ApprovalDetails, args: Input): { details: Record<string, unknown>; fields: string[] } {
  const details: Record<string, unknown> = { ...current }
  const fields: string[] = []
  for (const key of SCALARS) {
    if (args[key] !== undefined) {
      details[key] = args[key]
      fields.push(key)
    }
  }
  if (args.meeting) {
    details.meeting = { ...current.meeting, ...args.meeting }
    fields.push(...Object.keys(args.meeting).map((k) => `meeting.${k}`))
  }
  if (args.chair) {
    details.chair = { ...current.chair, ...args.chair }
    fields.push('chair')
  }
  if (args.size) {
    details.size = { ...current.size, ...args.size }
    fields.push(...Object.keys(args.size).map((k) => `size.${k}`))
  }
  if (args.votes) {
    details.votes = { ...current.votes, ...args.votes }
    fields.push(...Object.keys(args.votes).map((k) => `votes.${k}`))
  }
  if (args.allocation) {
    details.allocation = {
      ...current.allocation,
      ...(args.allocation.dividends !== undefined && { dividendsCents: centsFromEuros(args.allocation.dividends, 'Dividendes') }),
      ...(args.allocation.otherReserves !== undefined && { otherReservesCents: centsFromEuros(args.allocation.otherReserves, 'Autres réserves') }),
    }
    fields.push(...Object.keys(args.allocation).map((k) => `allocation.${k}`))
  }
  if (args.priorDividends !== undefined) {
    details.priorDividends = args.priorDividends?.map((d) => ({ year: d.year, amountCents: centsFromEuros(d.amount, `Dividendes ${d.year}`) })) ?? null
    fields.push('priorDividends')
  }
  if (args.nonDeductibleExpenses !== undefined) {
    details.nonDeductibleExpensesCents = args.nonDeductibleExpenses === null ? null : centsFromEuros(args.nonDeductibleExpenses, 'Dépenses non déductibles')
    fields.push('nonDeductibleExpenses')
  }
  return { details, fields }
}

const updateApprovalTool = draftTool({
  name: 'update_year_end_formalities',
  title: 'Renseigner l’approbation des comptes',
  summary:
    'Fills the data of the approval of the accounts of a fiscal year in Kledg: decision mode, meeting date, place and convocation, chair and secretary, auditor, regulated agreements, size category and headcount, group membership, votes per resolution, allocation proposed (dividends, other reserves), dividends of the three previous years, non-deductible expenses, confidentiality at filing, approval and filing days. Only the fields given change; the others keep what was saved. Kledg checks the dates against the closing (decision, approval and filing after it, convocation before the meeting, filing after the approval). Answers the fields changed and what each document still misses (as get_year_end_formalities).',
  never: 'generates or signs a document, files the accounts, approves anything for the shareholders or books the allocation of the result (allocate_result does, in full control).',
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd, votes as numbers of votes.',
  input,
  permission: { closing: ['execute'] },
  destructive: true,
  idempotent: true,
  async execute({ companyId, fiscalYearId, ...args }, ctx) {
    const current = await getApproval(companyId, fiscalYearId)
    const { details, fields } = merged(current.details, { fiscalYearId, ...args })
    await saveApproval(companyId, fiscalYearId, parseInput(ApprovalDetailsSchema, details), ctx.access.user.id)
    const after = await getApproval(companyId, fiscalYearId)
    return {
      changes: { fields },
      missing: after.pack.documents.filter((d) => d.missing.length > 0).map((d) => ({ document: d.title, required: d.required, missing: d.missing })),
      warnings: after.pack.warnings,
      reviewUrl: kledgPageUrl(companyId, 'approval'),
      message: 'Informations enregistrées : vérifiez le dossier d’approbation dans Kledg, qui génère les documents.',
    }
  },
  audit: (args, result) => ({ fiscalYearId: args.fiscalYearId, fields: result.changes.fields }),
})

export function registerApprovalDraftTools(register: RegisterDraftTool) {
  register(updateApprovalTool)
}
