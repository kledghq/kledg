/**
 * Full control tools on invoices, tiers, budgets, year-end items, expense
 * reports and their settings, management fee conventions, lettering and
 * fixed assets: what the pages do beyond drafts (posting, settling,
 * deleting, the expense report workflow, imports from Qonto). Each action
 * checks the right of its route (per action when a tool groups several
 * routes) and calls the route's service.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/accounting/errors'
import { getActiveFiscalYear } from '@/lib/accounting/fiscal-year-utils'
import { assistantInput, forAssistant, routeBody } from '@/lib/mcp/euros'
import { getInvoice, deleteInvoice } from '@/lib/invoices/manage-invoices.service'
import { postInvoice, unpostInvoice } from '@/lib/invoices/post-invoice.service'
import { resumeQontoInvoice } from '@/lib/invoices/create-in-qonto.service'
import { listPaymentCandidates, recordInvoicePayment, removeInvoicePayment, settleInvoice } from '@/lib/invoices/invoice-payments.service'
import { ImportQontoBodySchema, importQontoInvoices } from '@/lib/invoices/import-qonto-invoices.service'
import { deleteTiers, getTiers } from '@/lib/tiers/manage-tiers.service'
import { deleteBudget, deleteBudgetLine, getBudget } from '@/lib/budgets/manage-budgets.service'
import { AssessmentQuerySchema, deleteAssessment, deleteProvision, getProvision } from '@/lib/provisions/manage-provisions.service'
import { deleteInvestmentGrant, getInvestmentGrant } from '@/lib/investment-grants/manage-investment-grants.service'
import { WorkflowBodySchema, deleteExpenseReport, getExpenseReport, runExpenseWorkflow } from '@/lib/expense-reports/manage-expense-reports.service'
import { postExpenseReport, unpostExpenseReport } from '@/lib/expense-reports/post-expense-report.service'
import { ReimburseBodySchema, listReimbursementCandidates, reimburseExpenseReport } from '@/lib/expense-reports/expense-reimbursement.service'
import { expenseActorOf } from '@/lib/expense-reports/actor'
import { CreateClaimantBodySchema, UpdateClaimantBodySchema, createClaimant, deleteClaimant, listClaimantOptions, updateClaimant } from '@/lib/expense-reports/manage-expense-claimants.service'
import { CategoryRuleBodySchema, UpdateCategoryRuleBodySchema, createCategoryRule, deleteCategoryRule, updateCategoryRule } from '@/lib/expense-reports/manage-category-rules.service'
import { ConventionBodySchema, createConvention, deleteConvention, getConvention, updateConvention } from '@/lib/management-fees/manage-conventions.service'
import { autoLetterAccount, getLetteringSuggestions } from '@/lib/lettering/lettering.service'
import { UpdateFixedAssetSchema } from '@/lib/fixed-assets/schemas'
import { updateFixedAsset } from '@/lib/fixed-assets/update-fixed-asset.service'
import { deleteFixedAsset } from '@/lib/fixed-assets/delete-fixed-asset.service'
import { getFixedAsset } from '@/lib/fixed-assets/read-fixed-assets.service'
import { deleteDepreciationRecord, postDepreciationRecord } from '@/lib/fixed-assets/manage-depreciation-records.service'
import { fullControlTool, type RegisterTool } from './define'
import { expenseReportState, invoiceState } from './fingerprint'
import { ACTS_AS_USER, TWO_STEP } from './descriptions'
import { accountIdsByCode, ownedFiscalYear } from './resolve'

const need = (value: string | undefined | null, field: string): string => {
  if (!value) throw new ValidationError(`${field} est requis pour cette action.`)
  return value
}

// Invoices

const manageInvoiceTool = fullControlTool({
  name: 'manage_invoice',
  title: 'Comptabiliser, régler ou supprimer une facture',
  description: `Acts on an invoice, like its page: post creates its entry as a draft (AC or VE journal) in the fiscal year of its date; unpost deletes that draft entry (the invoice is a draft again; refused once validated or paid); delete deletes a draft invoice; record_payment records a bank payment (entryLineId: a line of a validated, reconciled entry, from payment_candidates) and letters the invoice once its payments cover it; remove_payment removes a payment (paymentId, from get_invoice); settle letters an invoice whose recorded payments cover it; payment_candidates lists the bank lines that may pay it (read only); resume_qonto resumes the creation in Qonto of an invoice whose answer from Qonto was lost (qontoPending in get_invoice): Kledg looks for it at Qonto first and never creates it twice. A sales invoice numbered by Kledg's series gets its number when posted and keeps it; it cannot be deleted then (a credit note cancels it). Create one with create_draft_invoice, edit a draft with update_draft_invoice. ${ACTS_AS_USER} Every action but payment_candidates is high impact: ${TWO_STEP}`,
  input: {
    action: z.enum(['post', 'unpost', 'delete', 'record_payment', 'remove_payment', 'settle', 'payment_candidates', 'resume_qonto']),
    invoiceId: z.string().min(1).max(64).describe('Invoice id, from list_invoices.'),
    entryLineId: z.string().max(64).optional().describe('record_payment: the bank line.'),
    paymentId: z.string().max(64).optional().describe('remove_payment: the payment.'),
  },
  permission: { entries: ['read'] },
  actions: {
    post: { entries: ['create'] },
    unpost: { entries: ['delete'] },
    delete: { entries: ['delete'] },
    record_payment: { entries: ['update'] },
    remove_payment: { entries: ['update'] },
    settle: { entries: ['update'] },
    resume_qonto: { entries: ['create'] },
  },
  amounts: 'euros',
  never: 'validates an entry or changes a validated entry.',
  confirmation: true,
  highImpactActions: ['post', 'unpost', 'delete', 'record_payment', 'remove_payment', 'settle', 'resume_qonto'],
  destructive: true,
  // resume_qonto calls Qonto
  openWorld: true,
  // The approval covers the invoice as the user saw it: an edit (update_draft_invoice) before the execution refuses it.
  targetState: ({ companyId, invoiceId }) => invoiceState(companyId, invoiceId),
  async preview({ companyId, action, invoiceId, entryLineId, paymentId }) {
    const invoice = forAssistant(await getInvoice(companyId, invoiceId)) as Record<string, unknown>
    return { action, invoice: { id: invoice.id, number: invoice.number, direction: invoice.direction, status: invoice.status, totalInclTax: invoice.totalInclTax, remaining: invoice.remaining }, entryLineId: entryLineId ?? null, paymentId: paymentId ?? null }
  },
  async execute({ companyId, action, invoiceId, entryLineId, paymentId }) {
    switch (action) {
      case 'payment_candidates':
        return { action, candidates: forAssistant(await listPaymentCandidates(companyId, invoiceId)) }
      case 'post':
        return { action, ...(forAssistant(await postInvoice(companyId, invoiceId, { source: 'mcp' })) as object) }
      case 'unpost':
        return { action, ...(await unpostInvoice(companyId, invoiceId)) }
      case 'delete':
        return { action, deleted: (await deleteInvoice(companyId, invoiceId)).id }
      case 'record_payment': {
        const { entryLineId: lineId } = routeBody(z.object({ entryLineId: z.string().min(1, 'entryLineId est requis') }), { entryLineId })
        return { action, ...(forAssistant(await recordInvoicePayment(companyId, invoiceId, lineId, { source: 'mcp' })) as object) }
      }
      case 'remove_payment':
        return { action, removed: (await removeInvoicePayment(companyId, invoiceId, need(paymentId, 'paymentId'))).id }
      case 'settle':
        return { action, ...(forAssistant(await settleInvoice(companyId, invoiceId)) as object) }
      case 'resume_qonto':
        return { action, invoice: forAssistant(await resumeQontoInvoice(companyId, invoiceId)) }
    }
  },
  audit: ({ action, invoiceId, entryLineId, paymentId }) => ({ action, invoiceId, entryLineId: entryLineId ?? null, paymentId: paymentId ?? null }),
})

const importQontoInvoicesTool = fullControlTool({
  name: 'import_qonto_invoices',
  title: 'Importer les factures Qonto',
  description: `Imports the Qonto clients, client invoices and supplier invoices of the company (read from Qonto with the stored credentials, idempotent by Qonto id: an invoice already imported is not created again), as drafts to post. Optionally only since a day. Within the per-company limit of bank calls. ${ACTS_AS_USER} ${TWO_STEP}`,
  input: { since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format attendu : AAAA-MM-JJ').optional() },
  permission: { entries: ['create'], banking: ['read'] },
  amounts: 'euros',
  never: 'posts or validates the imported invoices, or changes anything in Qonto.',
  openWorld: true,
  confirmation: true,
  idempotent: true,
  preview: async ({ since }) => ({ source: 'Qonto', since: since ?? null, note: 'Les factures déjà importées ne sont pas recréées.' }),
  execute: async ({ companyId, since }) => forAssistant(await importQontoInvoices(companyId, routeBody(ImportQontoBodySchema, { since }) ?? {})) as Record<string, unknown>,
  audit: ({ since }) => ({ since: since ?? null }),
})

const deleteTiersTool = fullControlTool({
  name: 'delete_tiers',
  title: 'Supprimer un client ou un fournisseur',
  description: `Deletes a customer or supplier (tiers); refused (409) while it has invoices. ${ACTS_AS_USER} ${TWO_STEP}`,
  input: { tiersId: z.string().min(1).max(64).describe('Tiers id, from list_tiers.') },
  permission: { entries: ['delete'] },
  amounts: 'none',
  never: 'deletes a tiers that has invoices, or an entry line.',
  confirmation: true,
  destructive: true,
  preview: async ({ companyId, tiersId }) => ({ tiers: forAssistant(await getTiers(companyId, tiersId)) }),
  execute: async ({ companyId, tiersId }) => ({ deleted: (await deleteTiers(companyId, tiersId)).id }),
  audit: ({ tiersId }) => ({ tiersId }),
})

const deleteBudgetItemsTool = fullControlTool({
  name: 'delete_budget_items',
  title: 'Supprimer un budget ou une ligne',
  description: `Deletes the budget of an open fiscal year (kind budget, budgetId from list_budgets) or one of its lines (kind line, lineId from get_budget); refused once the fiscal year is closed. ${ACTS_AS_USER} ${TWO_STEP}`,
  input: {
    kind: z.enum(['budget', 'line']),
    budgetId: z.string().max(64).optional(),
    lineId: z.string().max(64).optional(),
  },
  permission: { budgets: ['manage'] },
  amounts: 'euros',
  never: 'changes the books.',
  confirmation: true,
  destructive: true,
  async preview({ companyId, kind, budgetId, lineId }) {
    if (kind === 'budget') return { kind, budget: forAssistant(await getBudget(companyId, need(budgetId, 'budgetId'))) }
    const line = await prisma.budgetLine.findFirst({ where: { id: need(lineId, 'lineId'), budget: { companyId } }, select: { id: true, accountPrefix: true, label: true } })
    if (!line) throw new ValidationError('Ligne de budget introuvable')
    return { kind, line }
  },
  async execute({ companyId, kind, budgetId, lineId }) {
    if (kind === 'budget') await deleteBudget(companyId, need(budgetId, 'budgetId'))
    else await deleteBudgetLine(companyId, need(lineId, 'lineId'))
    return { kind, deleted: kind === 'budget' ? budgetId : lineId }
  },
  audit: ({ kind, budgetId, lineId }) => ({ kind, budgetId: budgetId ?? null, lineId: lineId ?? null }),
})

const deleteYearEndItemsTool = fullControlTool({
  name: 'delete_year_end_items',
  title: 'Supprimer une provision, une évaluation ou une subvention',
  description: `Deletes a year-end item recorded in Kledg: delete_provision (with its assessments and draft entries; refused once a movement is validated), delete_assessment (the assessment of a provision at the closing of fiscalYearId, and its draft entry), delete_grant (an investment grant with its draft transfers; refused once a transfer is validated). Ids come from get_year_end_inventory. ${ACTS_AS_USER} ${TWO_STEP}`,
  input: {
    action: z.enum(['delete_provision', 'delete_assessment', 'delete_grant']),
    provisionId: z.string().max(64).optional(),
    grantId: z.string().max(64).optional(),
    fiscalYearId: z.string().max(64).optional().describe('delete_assessment: the fiscal year of the assessment.'),
  },
  permission: { entries: ['read'] },
  actions: { delete_provision: { entries: ['delete'] }, delete_assessment: { entries: ['create'] }, delete_grant: { entries: ['delete'] } },
  amounts: 'euros',
  never: 'deletes or changes a validated entry.',
  confirmation: true,
  destructive: true,
  async preview({ companyId, action, provisionId, grantId, fiscalYearId }) {
    if (action === 'delete_grant') return { action, grant: forAssistant(await getInvestmentGrant(companyId, need(grantId, 'grantId'))) }
    return { action, provision: forAssistant(await getProvision(companyId, need(provisionId, 'provisionId'))), fiscalYearId: fiscalYearId ?? null }
  },
  async execute({ companyId, action, provisionId, grantId, fiscalYearId }) {
    if (action === 'delete_grant') await deleteInvestmentGrant(companyId, need(grantId, 'grantId'))
    else if (action === 'delete_provision') await deleteProvision(companyId, need(provisionId, 'provisionId'))
    else await deleteAssessment(companyId, need(provisionId, 'provisionId'), routeBody(AssessmentQuerySchema, { fiscalYearId }).fiscalYearId)
    return { action, deleted: true }
  },
  audit: ({ action, provisionId, grantId, fiscalYearId }) => ({ action, provisionId: provisionId ?? null, grantId: grantId ?? null, fiscalYearId: fiscalYearId ?? null }),
})

// Expense reports

const EXPENSE_ACTIONS = ['submit', 'return', 'validate', 'reopen', 'post', 'unpost', 'reimburse', 'delete', 'reimbursement_candidates'] as const

const manageExpenseReportTool = fullControlTool({
  name: 'manage_expense_report',
  title: 'Faire avancer une note de frais',
  description: `Moves an expense report through its workflow, like its page: submit (its author or a validator), return to its author with a note, validate, reopen (validators); post creates the draft entry of a validated report (NDF or OD journal); unpost deletes that draft entry (refused once validated); reimburse letters the report with its reimbursement (entryLineIds of a reconciled bank payment, from reimbursement_candidates) and marks it remboursée; delete deletes a report that is not posted (its author while it is a brouillon); reimbursement_candidates lists the bank payments that may reimburse it (read only). Report ids come from list_expense_reports. ${ACTS_AS_USER} Every action but reimbursement_candidates is high impact: ${TWO_STEP}`,
  input: {
    action: z.enum(EXPENSE_ACTIONS),
    reportId: z.string().min(1).max(64),
    note: z.string().max(1000).optional().describe('return: why it is returned; other workflow actions: an optional note.'),
    entryLineIds: z.array(z.string().min(1).max(64)).min(1).max(20).optional().describe('reimburse: the bank lines.'),
  },
  permission: { entries: ['read'] },
  actions: {
    submit: { expenses: ['submit'] },
    return: [{ expenses: ['submit'] }, { expenses: ['validate'] }],
    validate: [{ expenses: ['submit'] }, { expenses: ['validate'] }],
    reopen: [{ expenses: ['submit'] }, { expenses: ['validate'] }],
    post: { entries: ['create'] },
    unpost: { entries: ['delete'] },
    reimburse: { entries: ['update'] },
    delete: { expenses: ['submit'] },
    reimbursement_candidates: { expenses: ['validate'], entries: ['read'] },
  },
  amounts: 'euros',
  never: 'validates an accounting entry or pays anyone.',
  confirmation: true,
  highImpactActions: ['submit', 'return', 'validate', 'reopen', 'post', 'unpost', 'reimburse', 'delete'],
  destructive: true,
  targetState: ({ companyId, reportId }) => expenseReportState(companyId, reportId),
  async preview({ companyId, action, reportId }, ctx) {
    const report = forAssistant(await getExpenseReport(companyId, reportId, await expenseActorOf(ctx.access.user, companyId))) as Record<string, unknown>
    return { action, report: { id: report.id, number: report.number, status: report.status, claimant: report.claimant, totalInclTax: report.totalInclTax, periodStart: report.periodStart, periodEnd: report.periodEnd } }
  },
  async execute({ companyId, action, reportId, note, entryLineIds }, ctx) {
    const actor = await expenseActorOf(ctx.access.user, companyId)
    switch (action) {
      case 'reimbursement_candidates':
        return { action, candidates: forAssistant(await listReimbursementCandidates(companyId, reportId)) }
      case 'post':
        return { action, ...(forAssistant(await postExpenseReport(companyId, reportId, { source: 'mcp' })) as object) }
      case 'unpost':
        return { action, ...(await unpostExpenseReport(companyId, reportId)) }
      case 'reimburse':
        return { action, lettering: forAssistant(await reimburseExpenseReport(companyId, reportId, routeBody(ReimburseBodySchema, { entryLineIds }).entryLineIds, { source: 'mcp' })) }
      case 'delete':
        return { action, deleted: (await deleteExpenseReport(companyId, reportId, actor)).id }
      default: {
        const body = routeBody(WorkflowBodySchema, { action, note })
        const report = forAssistant(await runExpenseWorkflow(companyId, reportId, body, actor, { source: 'mcp' })) as Record<string, unknown>
        return { action, report: { id: report.id, number: report.number, status: report.status } }
      }
    }
  },
  audit: ({ action, reportId }) => ({ action, reportId }),
})

const manageExpenseSettingsTool = fullControlTool({
  name: 'manage_expense_settings',
  title: 'Bénéficiaires et règles des notes de frais',
  description: `Settings of the expense reports (validators): claimants (create with kind, name, linked person or user and accounts; update; delete one without reports; claimant_options lists the users and persons that may be linked) and the keyword rules giving the category of expense lines (create, update, delete; list them with list_expense_category_rules). Claimant ids: list_expense_claimants. ${ACTS_AS_USER} Deletions are high impact: ${TWO_STEP}`,
  input: {
    action: z.enum(['create_claimant', 'update_claimant', 'delete_claimant', 'claimant_options', 'create_rule', 'update_rule', 'delete_rule']),
    claimantId: z.string().max(64).optional(),
    claimant: assistantInput(CreateClaimantBodySchema.partial()).optional().describe('create_claimant (kind and name required) and update_claimant: the fields.'),
    ruleId: z.string().max(64).optional(),
    rule: assistantInput(CategoryRuleBodySchema.partial()).optional().describe('create_rule (keyword and category required) and update_rule: the fields.'),
  },
  permission: { expenses: ['validate'] },
  amounts: 'none',
  never: 'changes an expense report or an entry.',
  confirmation: true,
  highImpactActions: ['delete_claimant', 'delete_rule'],
  destructive: true,
  preview: async ({ action, claimantId, ruleId }) => ({ action, claimantId: claimantId ?? null, ruleId: ruleId ?? null }),
  async execute({ companyId, action, claimantId, claimant, ruleId, rule }) {
    switch (action) {
      case 'claimant_options':
        return { action, ...(forAssistant(await listClaimantOptions(companyId)) as object) }
      case 'create_claimant':
        return { action, claimant: forAssistant(await createClaimant(companyId, routeBody(CreateClaimantBodySchema, claimant ?? {}))) }
      case 'update_claimant':
        return { action, claimant: forAssistant(await updateClaimant(companyId, need(claimantId, 'claimantId'), routeBody(UpdateClaimantBodySchema, claimant ?? {}))) }
      case 'delete_claimant':
        return { action, deleted: (await deleteClaimant(companyId, need(claimantId, 'claimantId'))).id }
      case 'create_rule':
        return { action, rule: await createCategoryRule(companyId, routeBody(CategoryRuleBodySchema, rule ?? {})) }
      case 'update_rule':
        return { action, rule: await updateCategoryRule(companyId, need(ruleId, 'ruleId'), routeBody(UpdateCategoryRuleBodySchema, rule ?? {})) }
      case 'delete_rule':
        return { action, deleted: (await deleteCategoryRule(companyId, need(ruleId, 'ruleId'))).id }
    }
  },
  audit: ({ action, claimantId, ruleId }) => ({ action, claimantId: claimantId ?? null, ruleId: ruleId ?? null }),
})

// Management fees

const manageConventionTool = fullControlTool({
  name: 'manage_management_fee_convention',
  title: 'Gérer une convention de frais de gestion',
  description: `Management fee conventions of a holding with its subsidiaries (docs/frais-de-gestion.md): create one (label, pricing COST_PLUS with markup in percent or FIXED with an amount in euros, refacturable cost accounts, allocation key, VAT rate, accounts, invoice prefix, dates, subsidiaries with their share; each subsidiary records the holding as a shareholder and must be within your reach); update replaces it (past billings keep their amounts); delete one never invoiced. Generating the invoices stays in Kledg (decision of the maintainer). ${ACTS_AS_USER} ${TWO_STEP}`,
  input: {
    action: z.enum(['create', 'update', 'delete']),
    conventionId: z.string().max(64).optional().describe('update and delete: from list_management_fee_conventions.'),
    convention: assistantInput(ConventionBodySchema).optional().describe('create and update: the whole convention.'),
  },
  permission: { entries: ['create'] },
  amounts: 'euros',
  units: 'Rates and shares in percent, dates as yyyy-mm-dd.',
  never: 'generates or posts an invoice.',
  confirmation: true,
  destructive: true,
  async preview({ companyId, action, conventionId, convention }, ctx) {
    const current = conventionId ? forAssistant(await getConvention(companyId, conventionId, ctx.group)) : null
    return { action, current, requested: convention ?? null }
  },
  async execute({ companyId, action, conventionId, convention }, ctx) {
    if (action === 'delete') return { action, deleted: (await deleteConvention(companyId, need(conventionId, 'conventionId'))).id }
    const body = routeBody(ConventionBodySchema, convention ?? {})
    const saved = action === 'create' ? await createConvention(companyId, body, ctx.group) : await updateConvention(companyId, need(conventionId, 'conventionId'), body, ctx.group)
    return { action, convention: forAssistant(saved) }
  },
  audit: ({ action, conventionId }, result) => ({ action, conventionId: conventionId ?? ((result as { convention?: { id?: string } }).convention?.id ?? null) }),
})

// Lettering

async function accountIdOf(companyId: string, accountCode: string, fiscalYearId?: string) {
  const fiscalYear = fiscalYearId ? await ownedFiscalYear(companyId, fiscalYearId) : await getActiveFiscalYear(companyId)
  if (!fiscalYear) throw new ValidationError('Aucun exercice ouvert.')
  return (await accountIdsByCode(companyId, fiscalYear.id, [accountCode])).get(accountCode)!
}

const autoLetterTool = fullControlTool({
  name: 'auto_letter_account',
  title: 'Lettrage automatique d’un compte',
  description: `Applies every automatic lettering proposal of a third-party account (auto-lettrage), each with its own code, like the button of the Lettrage page; the dry run lists the proposals (list_unlettered_lines shows them too). ${ACTS_AS_USER} ${TWO_STEP}`,
  input: {
    accountCode: z.string().min(1).max(20).describe('Third-party account number, e.g. 411 or 4010001.'),
    fiscalYearId: z.string().max(64).optional().describe('Defaults to the current fiscal year.'),
  },
  permission: { entries: ['update'] },
  amounts: 'euros',
  never: 'letters lines of a closed fiscal year or changes the amounts of an entry.',
  confirmation: true,
  destructive: false,
  async preview({ companyId, accountCode, fiscalYearId }) {
    return { accountCode, suggestions: forAssistant(await getLetteringSuggestions(companyId, await accountIdOf(companyId, accountCode, fiscalYearId))) }
  },
  async execute({ companyId, accountCode, fiscalYearId }) {
    return forAssistant(await autoLetterAccount(companyId, await accountIdOf(companyId, accountCode, fiscalYearId), { source: 'mcp' })) as Record<string, unknown>
  },
  audit: ({ accountCode }, result) => ({ accountCode, groups: Array.isArray((result as { groups?: unknown[] }).groups) ? (result as { groups: unknown[] }).groups.length : null }),
})

// Fixed assets

const manageFixedAssetTool = fullControlTool({
  name: 'manage_fixed_asset',
  title: 'Modifier ou supprimer une immobilisation',
  description: `Action update changes the fields given of a fixed asset (label, dates, values, depreciation method, duration or rate, coefficient, disposal date, accounts by number in the current fiscal year, paid, active); action delete deletes it with its depreciation records and its draft depreciation entries, refused while validated depreciation entries exist (reverse them, or record a disposal instead). Create one with create_fixed_asset. ${ACTS_AS_USER} Action delete is high impact: ${TWO_STEP}`,
  input: {
    action: z.enum(['update', 'delete']),
    fixedAssetId: z.string().min(1).max(64).describe('From list_fixed_assets.'),
    fields: assistantInput(UpdateFixedAssetSchema.omit({ assetAccountId: true, depreciationAccountId: true, expenseAccountId: true })).optional(),
    assetAccountCode: z.string().max(20).optional(),
    depreciationAccountCode: z.string().max(20).optional(),
    expenseAccountCode: z.string().max(20).optional(),
  },
  permission: { ledger: ['manage'] },
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd, rates in percent, durations in years.',
  never: 'deletes or changes a validated depreciation entry.',
  confirmation: true,
  highImpactActions: ['delete'],
  destructive: true,
  preview: async ({ companyId, action, fixedAssetId }) => ({ action, fixedAsset: forAssistant(await getFixedAsset(companyId, fixedAssetId)) }),
  async execute({ companyId, action, fixedAssetId, fields, assetAccountCode, depreciationAccountCode, expenseAccountCode }) {
    if (action === 'delete') return { action, deletedDraftEntries: await deleteFixedAsset(companyId, fixedAssetId) }
    const codes = [assetAccountCode, depreciationAccountCode, expenseAccountCode].filter((c): c is string => Boolean(c))
    const fiscalYear = codes.length ? await getActiveFiscalYear(companyId) : null
    if (codes.length && !fiscalYear) throw new ValidationError('Aucun exercice ouvert pour retrouver les comptes.')
    const byCode = fiscalYear ? await accountIdsByCode(companyId, fiscalYear.id, codes) : new Map<string, string>()
    const body = routeBody(UpdateFixedAssetSchema, {
      ...((fields as object | undefined) ?? {}),
      ...(assetAccountCode && { assetAccountId: byCode.get(assetAccountCode) }),
      ...(depreciationAccountCode && { depreciationAccountId: byCode.get(depreciationAccountCode) }),
      ...(expenseAccountCode && { expenseAccountId: byCode.get(expenseAccountCode) }),
    })
    return { action, fixedAsset: forAssistant(await updateFixedAsset(companyId, fixedAssetId, body)) }
  },
  audit: ({ action, fixedAssetId }) => ({ action, fixedAssetId }),
})

const manageDepreciationRecordTool = fullControlTool({
  name: 'manage_depreciation_record',
  title: 'Comptabiliser ou supprimer un amortissement',
  description: `Action post books a depreciation record of a fixed asset as a VALIDATED OD entry (68 debit, 28 credit) and links it (409 when already booked or the fiscal year is closed); action delete deletes a record (a record, not an accounting entry). Records come from list_fixed_assets view asset; record them with save_depreciation_record. Every depreciation of a fiscal year is booked at once by generate_depreciation. ${ACTS_AS_USER} ${TWO_STEP}`,
  input: {
    action: z.enum(['post', 'delete']),
    fixedAssetId: z.string().min(1).max(64),
    recordId: z.string().min(1).max(64),
  },
  permission: { entries: ['read'] },
  actions: { post: { entries: ['create', 'validate'] }, delete: { entries: ['delete'] } },
  amounts: 'euros',
  never: 'deletes a validated entry or books in a closed fiscal year.',
  confirmation: true,
  destructive: true,
  async preview({ companyId, action, fixedAssetId, recordId }) {
    const asset = forAssistant(await getFixedAsset(companyId, fixedAssetId)) as { label?: string; depreciationEntries?: Array<{ id: string }> }
    return { action, fixedAsset: asset.label ?? fixedAssetId, record: asset.depreciationEntries?.find((r) => r.id === recordId) ?? null }
  },
  async execute({ companyId, action, fixedAssetId, recordId }) {
    if (action === 'delete') {
      await deleteDepreciationRecord(companyId, fixedAssetId, recordId)
      return { action, deleted: recordId }
    }
    return { action, ...(forAssistant(await postDepreciationRecord(companyId, fixedAssetId, recordId)) as object) }
  },
  audit: ({ action, fixedAssetId, recordId }) => ({ action, fixedAssetId, recordId }),
})

export function registerRecordTools(register: RegisterTool) {
  register(manageInvoiceTool)
  register(importQontoInvoicesTool)
  register(deleteTiersTool)
  register(deleteBudgetItemsTool)
  register(deleteYearEndItemsTool)
  register(manageExpenseReportTool)
  register(manageExpenseSettingsTool)
  register(manageConventionTool)
  register(autoLetterTool)
  register(manageFixedAssetTool)
  register(manageDepreciationRecordTool)
}
