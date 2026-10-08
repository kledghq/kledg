/**
 * Draft-level tools of the annexe (docs/annexe-et-2054.md):
 * - manage_accounting_methods: the register of the methods the company
 *   retains (PCG art. 121-5, 831-1 3°), create, update or delete;
 * - manage_accounting_changes: changes of method, regulation or estimate and
 *   corrections of errors (PCG art. 122-1 to 122-6), and their catch-up
 *   entry prepared as a DRAFT (prepare_entry);
 * - update_annexe_notes: what the user answers for the annexe (commitments,
 *   events after the closing, officers, maturities, headcount...).
 * Thin wrappers over lib/annexe, with the rights of the matching routes.
 * Validating the drafts and generating the annexe stay with a person.
 */

import { z } from 'zod'
import { ValidationError } from '@/lib/accounting/errors'
import { parseInput } from '@/lib/api/zod-fields'
import { getAnnexe } from '@/lib/annexe/get-annexe.service'
import { saveAnnexeNotes } from '@/lib/annexe/save-annexe-notes.service'
import { AnnexeDetailsSchema, COMMITMENT_KINDS, type AnnexeDetails } from '@/lib/annexe/schemas'
import {
  ChangeBodySchema,
  MethodBodySchema,
  createAccountingChange,
  createAccountingMethod,
  deleteAccountingChange,
  deleteAccountingMethod,
  prepareAccountingChangeEntry,
  updateAccountingChange,
  updateAccountingMethod,
} from '@/lib/annexe/methods/manage-accounting-methods.service'
import { CHANGE_KINDS, CHANGE_TREATMENTS, METHOD_TOPICS } from '@/lib/annexe/methods/rules'
import { centsFromEuros, eurosInput, kledgPageUrl } from '@/lib/mcp/tool-meta'
import { fromCents } from '@/lib/utils/money'
import { draftTool, type RegisterDraftTool } from './define'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ')
const id = (what: string) => z.string().min(1, `${what} est requis`).max(64)
const NEVER = 'validates or posts an entry (catch-up entries are drafts), generates the annexe or changes a closed fiscal year.'

const manageMethodsTool = draftTool({
  name: 'manage_accounting_methods',
  title: 'Registre des méthodes comptables',
  summary:
    'Register of the accounting methods the company retains where the PCG leaves a choice, listed in the annexe (PCG art. 831-1, 3°): action create records one (topic among inventory_valuation, depreciation, revenue_recognition, long_term_contracts, development_costs, set_up_costs, acquisition_costs, borrowing_costs, pension_commitments, grants, foreign_currency, other; the method in a few words; how it applies; adoption day; whether it is a reference method of PCG art. 121-5, irreversible once adopted); action update replaces methodId; action delete removes it (its changes stay, unlinked). A change of method is recorded with manage_accounting_changes.',
  never: NEVER,
  amounts: 'none',
  units: 'Dates as yyyy-mm-dd.',
  input: {
    action: z.enum(['create', 'update', 'delete']),
    methodId: z.string().max(64).optional().describe('update and delete: the method, from get_annexe.'),
    topic: z.enum(METHOD_TOPICS).optional(),
    label: z.string().max(200).optional().describe('The method retained ("Premier entré, premier sorti").'),
    description: z.string().max(4000).optional().describe('How it applies, as written in the annexe.'),
    adoptedOn: day.nullable().optional(),
    referenceMethod: z.boolean().optional(),
  },
  permission: [],
  actions: { create: { entries: ['create'] }, update: { entries: ['update'] }, delete: { entries: ['delete'] } },
  destructive: true,
  idempotent: false,
  async execute(args) {
    const reviewUrl = kledgPageUrl(args.companyId, 'accounting-methods')
    if (args.action === 'delete') {
      if (!args.methodId) throw new ValidationError('methodId est requis pour supprimer une méthode.')
      await deleteAccountingMethod(args.companyId, args.methodId)
      return { changes: { deleted: args.methodId }, reviewUrl, message: 'Méthode retirée du registre.' }
    }
    const body = parseInput(MethodBodySchema, { topic: args.topic, label: args.label, description: args.description, adoptedOn: args.adoptedOn, referenceMethod: args.referenceMethod })
    if (args.action === 'update') {
      if (!args.methodId) throw new ValidationError('methodId est requis pour modifier une méthode.')
      const method = await updateAccountingMethod(args.companyId, args.methodId, body)
      return { changes: { updated: method }, reviewUrl, message: 'Méthode modifiée : elle figure dans les règles et méthodes de l’annexe.' }
    }
    const method = await createAccountingMethod(args.companyId, body)
    return { changes: { created: method }, reviewUrl, message: 'Méthode enregistrée : elle figure dans les règles et méthodes de l’annexe.' }
  },
  audit: (args, result) => ({ action: args.action, methodId: args.methodId ?? (result.changes as { created?: { id: string } }).created?.id ?? null }),
})

const manageChangesTool = draftTool({
  name: 'manage_accounting_changes',
  title: 'Changements de méthode et corrections d’erreurs',
  summary:
    "Changes of a fiscal year mentioned in the annexe (PCG art. 831-2): kind REGULATION_CHANGE (art. 122-1), METHOD_CHANGE (art. 122-2: a choice between admitted methods for a better information, justified), ESTIMATE_CHANGE (art. 122-5, always PROSPECTIVE) or ERROR_CORRECTION (art. 122-6). Treatment: EQUITY (impact at the opening, after tax, in report à nouveau 110 or 119, art. 122-3; for an error, only when it corrects an entry booked directly in equity), RESULT (exceptional result 778 or 678: method changes booked in the result because of tax rules, and corrections of errors by default), PROSPECTIVE (no catch-up entry). Actions: create, update (changeId; a draft entry that no longer matches is deleted, a validated one refuses), delete (with its draft entry), prepare_entry (prepares the catch-up entry as a DRAFT in the OD journal: debit or credit the adjusted balance sheet account, 444 for the tax effect in equity, and 110/119 or 778/678; idempotent).",
  never: NEVER,
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd; impact signed, positive when it increases equity or the result.',
  input: {
    action: z.enum(['create', 'update', 'delete', 'prepare_entry']),
    changeId: z.string().max(64).optional().describe('update, delete, prepare_entry: the change, from get_annexe.'),
    fiscalYearId: z.string().max(64).optional().describe('create and update: the fiscal year the change is recognised in.'),
    kind: z.enum(CHANGE_KINDS).optional(),
    treatment: z.enum(CHANGE_TREATMENTS).optional().describe('Default: EQUITY for a change of method or regulation, PROSPECTIVE for an estimate, RESULT for an error.'),
    methodId: z.string().max(64).nullable().optional().describe('The method of the register it concerns.'),
    label: z.string().max(200).optional(),
    description: z.string().max(4000).optional().describe('Nature of the change or of the error and its justification.'),
    impact: eurosInput.optional().describe('Impact before tax, in euros, signed.'),
    taxEffect: eurosInput.min(0).optional().describe('Tax on the impact, in euros, positive.'),
    accountCode: z.string().max(10).nullable().optional().describe('Balance sheet account adjusted (31 stocks, 15 provisions...), counterpart of the entry.'),
    entryDate: day.nullable().optional().describe('Day of the catch-up entry; default the opening (EQUITY) or the closing (RESULT).'),
  },
  permission: [],
  actions: { create: { entries: ['create'] }, update: { entries: ['update'] }, delete: { entries: ['delete'] }, prepare_entry: { entries: ['create'] } },
  destructive: true,
  idempotent: false,
  async execute(args) {
    const reviewUrl = kledgPageUrl(args.companyId, 'accounting-methods')
    if (args.action === 'delete' || args.action === 'prepare_entry' || args.action === 'update') {
      if (!args.changeId) throw new ValidationError('changeId est requis pour cette action.')
    }
    if (args.action === 'delete') {
      await deleteAccountingChange(args.companyId, args.changeId as string)
      return { changes: { deleted: args.changeId }, reviewUrl, message: 'Changement supprimé, avec son écriture en brouillon.' }
    }
    if (args.action === 'prepare_entry') {
      const prepared = await prepareAccountingChangeEntry(args.companyId, args.changeId as string)
      return {
        changes: { outcome: prepared.outcome, entry: prepared.change.entry },
        reviewUrl: kledgPageUrl(args.companyId, 'entries'),
        message: prepared.outcome === 'created' ? 'Écriture de rattrapage préparée en brouillon : faites-la valider dans Kledg.' : "L'écriture de ce changement est déjà validée.",
      }
    }
    const body = parseInput(ChangeBodySchema, {
      fiscalYearId: args.fiscalYearId,
      kind: args.kind,
      treatment: args.treatment,
      methodId: args.methodId,
      label: args.label,
      description: args.description,
      impactCents: args.impact === undefined ? undefined : centsFromEuros(args.impact, 'Impact'),
      taxEffectCents: args.taxEffect === undefined ? undefined : centsFromEuros(args.taxEffect, "Effet d'impôt"),
      accountCode: args.accountCode,
      entryDate: args.entryDate,
    })
    const change = args.action === 'update' ? await updateAccountingChange(args.companyId, args.changeId as string, body) : await createAccountingChange(args.companyId, body)
    return {
      changes: { [args.action === 'update' ? 'updated' : 'created']: { id: change.id, kind: change.kind, treatment: change.treatment, impactAfterTax: fromCents(change.netImpactCents), entryExpected: change.entryExpected } },
      reviewUrl,
      message: change.entryExpected ? 'Changement enregistré : préparez son écriture (prepare_entry), puis faites-la valider.' : 'Changement enregistré : il figure dans l’annexe.',
    }
  },
  audit: (args, result) => ({ action: args.action, changeId: args.changeId ?? (result.changes as { created?: { id: string } }).created?.id ?? null }),
})

const answer = z.object({ none: z.boolean().optional(), text: z.string().max(6000).nullable().optional() }).nullable().optional()
const notesInput = {
  fiscalYearId: id("L'exercice").describe('Fiscal year of the annexe, from list_fiscal_years.'),
  derogations: answer.describe('Derogations to the general rules or the length of the year (none: Néant).'),
  postClosingEvents: answer.describe('Events after the closing (none: Néant).'),
  otherInformation: z.string().max(6000).nullable().optional(),
  commitments: z
    .object({
      none: z.boolean().optional(),
      items: z.array(z.object({ kind: z.enum(COMMITMENT_KINDS), description: z.string().max(1000), amount: eurosInput.min(0).nullable().optional(), residual: eurosInput.min(0).nullable().optional() })).max(50).optional(),
    })
    .nullable()
    .optional()
    .describe('Commitments off the balance sheet, replacing the saved list; amounts in euros (leasing: rents still to pay and residual price).'),
  directorAdvances: z.object({ none: z.boolean().optional(), amount: eurosInput.min(0).nullable().optional(), conditions: z.string().max(2000).nullable().optional() }).nullable().optional(),
  directorRemuneration: z.object({ omitted: z.boolean().optional(), amount: eurosInput.min(0).nullable().optional() }).nullable().optional().describe('Global amount; omitted when it would identify one officer (PCG art. 835-2).'),
  employees: z.number().int().min(0).max(10_000_000).nullable().optional(),
  taxCredits: z.object({ none: z.boolean().optional(), items: z.array(z.object({ label: z.string().max(200), amount: eurosInput.min(0) })).max(20).optional() }).nullable().optional(),
  receivablesOverOneYear: eurosInput.min(0).nullable().optional().describe('Part of the receivables due in more than one year, in euros.'),
  debtsOverOneYear: eurosInput.min(0).nullable().optional().describe('Part of the debts due in more than one year, in euros (give both debt fields).'),
  debtsOverFiveYears: eurosInput.min(0).nullable().optional(),
  relatedParties: answer.describe('Transactions with related parties not at normal market conditions (none: Néant).'),
  consolidatingEntity: z.object({ name: z.string().max(200), seat: z.string().max(300), siren: z.string().nullable().optional(), copiesAt: z.string().max(300).nullable().optional() }).nullable().optional(),
}

type NotesArgs = z.infer<z.ZodObject<typeof notesInput>>
const money = (value: number | null | undefined, field: string) => (value === null || value === undefined ? null : centsFromEuros(value, field))

/** What is saved, the fields given replacing theirs. */
function mergedNotes(current: AnnexeDetails, args: NotesArgs): { details: Record<string, unknown>; fields: string[] } {
  const details: Record<string, unknown> = { ...current }
  const fields: string[] = []
  const set = (key: string, value: unknown) => {
    details[key] = value
    fields.push(key)
  }
  for (const key of ['derogations', 'postClosingEvents', 'relatedParties'] as const) {
    if (args[key] !== undefined) set(key, args[key] === null ? null : { none: args[key]?.none ?? false, text: args[key]?.text ?? null })
  }
  if (args.otherInformation !== undefined) set('otherInformation', args.otherInformation)
  if (args.employees !== undefined) set('employees', args.employees)
  if (args.commitments !== undefined)
    set(
      'commitments',
      args.commitments === null
        ? null
        : { none: args.commitments.none ?? false, items: (args.commitments.items ?? []).map((c) => ({ kind: c.kind, description: c.description, amountCents: money(c.amount, 'Montant'), residualCents: money(c.residual, 'Prix résiduel') })) },
    )
  if (args.directorAdvances !== undefined)
    set('directorAdvances', args.directorAdvances === null ? null : { none: args.directorAdvances.none ?? false, amountCents: money(args.directorAdvances.amount, 'Avances'), conditions: args.directorAdvances.conditions ?? null })
  if (args.directorRemuneration !== undefined)
    set('directorRemuneration', args.directorRemuneration === null ? null : { omitted: args.directorRemuneration.omitted ?? false, amountCents: money(args.directorRemuneration.amount, 'Rémunérations') })
  if (args.taxCredits !== undefined)
    set('taxCredits', args.taxCredits === null ? null : { none: args.taxCredits.none ?? false, items: (args.taxCredits.items ?? []).map((t) => ({ label: t.label, amountCents: money(t.amount, t.label) })) })
  if (args.receivablesOverOneYear !== undefined) set('receivableMaturities', args.receivablesOverOneYear === null ? null : { overOneYearCents: money(args.receivablesOverOneYear, 'Créances à plus d’un an') })
  if (args.debtsOverOneYear !== undefined || args.debtsOverFiveYears !== undefined) {
    const over = args.debtsOverOneYear ?? (current.debtMaturities ? fromCents(current.debtMaturities.overOneYearCents) : null)
    const five = args.debtsOverFiveYears ?? (current.debtMaturities ? fromCents(current.debtMaturities.overFiveYearsCents) : 0)
    set('debtMaturities', over === null ? null : { overOneYearCents: money(over, 'Dettes à plus d’un an'), overFiveYearsCents: money(five, 'Dettes à plus de cinq ans') ?? 0 })
  }
  if (args.consolidatingEntity !== undefined) set('consolidatingEntity', args.consolidatingEntity)
  return { details, fields }
}

const updateNotesTool = draftTool({
  name: 'update_annexe_notes',
  title: 'Renseigner l’annexe',
  summary:
    "Fills what only the user knows for the annexe of a fiscal year: derogations, events after the closing, other information, commitments off the balance sheet (guarantees, securities, leasing, pensions, related entities), advances and remuneration of the officers, average headcount, tax credits, the part of receivables and debts due in more than one (and five) years, transactions with related parties, the consolidating entity. Only the fields given change; none: true records « Néant ». Saved by the same service as PUT /api/annexe, with its right (closing:execute). Answers the fields changed and what the annexe still misses (as get_annexe).",
  never: 'invents a figure the books hold (they are read, not entered), generates the annexe or files it.',
  amounts: 'euros',
  input: notesInput,
  permission: { closing: ['execute'] },
  destructive: true,
  idempotent: true,
  async execute({ companyId, ...args }, ctx) {
    const current = await getAnnexe(companyId, args.fiscalYearId, null)
    const { details, fields } = mergedNotes(current.details, args)
    await saveAnnexeNotes(companyId, args.fiscalYearId, parseInput(AnnexeDetailsSchema, details), ctx.access.user.id)
    const after = await getAnnexe(companyId, args.fiscalYearId, null)
    return {
      changes: { fields },
      missing: after.annexe.missing,
      warnings: after.annexe.warnings,
      reviewUrl: kledgPageUrl(companyId, 'reports/annexe'),
      message: 'Informations enregistrées : vérifiez l’annexe dans Kledg, qui la génère.',
    }
  },
  audit: (args, result) => ({ fiscalYearId: args.fiscalYearId, fields: result.changes.fields }),
})

export function registerAnnexeDraftTools(register: RegisterDraftTool) {
  register(manageMethodsTool)
  register(manageChangesTool)
  register(updateNotesTool)
}
