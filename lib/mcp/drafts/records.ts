/**
 * Draft-level tools (kledg:write) that complete what a user can prepare in
 * Kledg without validating, posting, deleting or sending anything:
 * customers and suppliers, a copy of an entry as a draft, edits of draft
 * invoices, provisions, grants and draft expense reports, the 411 to 416
 * reclassification and the CFE entry as drafts, the data of the local taxes
 * and of the corporate tax, the record of a filed return, depreciation
 * records, opening balances as a draft.
 *
 * Each tool calls the service of the matching API route with that route's
 * body schema (lib/mcp/euros.ts turns the euros the assistant sends into
 * the cents of the body) and checks the route's rights through
 * registerDraftTool, per action when the tool groups several routes.
 */

import { z } from 'zod'
import { ForbiddenError, ValidationError } from '@/lib/accounting/errors'
import { assistantInput, assistantShape, forAssistant, routeBody } from '@/lib/mcp/euros'
import { centsFromEuros, eurosInput, kledgPageUrl } from '@/lib/mcp/tool-meta'
import { CreateTiersBodySchema, UpdateTiersBodySchema, createTiers, updateTiers } from '@/lib/tiers/manage-tiers.service'
import { attachAuxiliaryAccounts } from '@/lib/tiers/attach-auxiliary-accounts.service'
import { duplicateEntry } from '@/lib/accounting/services'
import { UpdateInvoiceBodySchema, UpdateLineAccountsBodySchema, updateInvoice, updateInvoiceLineAccounts } from '@/lib/invoices/manage-invoices.service'
import { ProvisionBodySchema, updateProvision } from '@/lib/provisions/manage-provisions.service'
import { GrantBodySchema, updateInvestmentGrant } from '@/lib/investment-grants/manage-investment-grants.service'
import { UpdateExpenseReportBodySchema, updateExpenseReport } from '@/lib/expense-reports/manage-expense-reports.service'
import { expenseActorOf } from '@/lib/expense-reports/actor'
import { ReclassifyBodySchema, reclassifyDoubtfulReceivable } from '@/lib/provisions/doubtful-receivables.service'
import { SaveLocalTaxesBodySchema, saveLocalTaxes } from '@/lib/local-taxes/save-local-taxes.service'
import { CfeEntryBodySchema, prepareCfeEntry } from '@/lib/local-taxes/prepare-cfe-entry.service'
import {
  CorporateTaxFilingBodySchema,
  CorporateTaxFilingQuerySchema,
  CorporateTaxInputsBodySchema,
  deleteCorporateTaxFiling,
  recordCorporateTaxFiling,
  saveCorporateTaxInputs,
} from '@/lib/corporate-tax/record-corporate-tax.service'
import { VatFilingBodySchema, VatFilingQuerySchema, deleteVatFiling, recordVatFiling } from '@/lib/vat-returns/record-vat-filing.service'
import { LinkDepreciationEntrySchema, SaveDepreciationRecordSchema } from '@/lib/fixed-assets/schemas'
import { linkDepreciationRecord, saveDepreciationRecord } from '@/lib/fixed-assets/manage-depreciation-records.service'
import { postOpeningBalances } from '@/lib/accounting/opening-balance/post-opening-balances.service'
import { ConfirmAllBodySchema, confirmHighConfidenceExpenses } from '@/lib/simple/confirm-expense.service'
import { draftTool, type RegisterDraftTool } from './define'

const id = (what: string) => z.string().min(1, `${what} est requis`).max(64)

const NEVER_POSTS = 'validates or posts an entry, deletes anything or sends anything.'

const manageTiersTool = draftTool({
  name: 'manage_tiers',
  title: 'Créer ou modifier un client ou un fournisseur',
  summary:
    'Customers and suppliers (tiers, docs/factures-et-tiers.md): action create records one (kind CUSTOMER or SUPPLIER, name, identifiers, auxiliary account, default accounts and VAT rate, payment terms, address); action update changes the fields given of tiersId (its auxiliary number stays once it has invoices); action attach_auxiliary creates the tiers of the auxiliary account numbers already used on 40 and 41 lines, without changing any line (idempotent). Delete one with delete_tiers (full control).',
  never: NEVER_POSTS,
  amounts: 'none',
  units: 'VAT rates in percent, payment terms in days.',
  input: {
    action: z.enum(['create', 'update', 'attach_auxiliary']),
    tiersId: z.string().max(64).optional().describe('update: the tiers, from list_tiers.'),
    tiers: assistantInput(CreateTiersBodySchema.partial()).optional().describe('create and update: the fields (kind and name required to create).'),
  },
  permission: [],
  actions: { create: { entries: ['create'] }, update: { entries: ['update'] }, attach_auxiliary: { entries: ['create'] } },
  destructive: true,
  idempotent: false,
  async execute(args) {
    if (args.action === 'attach_auxiliary') {
      const result = await attachAuxiliaryAccounts(args.companyId)
      return { changes: forAssistant(result), reviewUrl: kledgPageUrl(args.companyId, 'tiers'), message: 'Comptes auxiliaires rattachés à leurs tiers.' }
    }
    if (args.action === 'create') {
      const tiers = await createTiers(args.companyId, routeBody(CreateTiersBodySchema, args.tiers ?? {}), { source: 'mcp' })
      return { tiersId: tiers.id, changes: forAssistant(tiers), reviewUrl: kledgPageUrl(args.companyId, 'tiers'), message: `Tiers « ${tiers.name} » créé.` }
    }
    if (!args.tiersId) throw new ValidationError('tiersId est requis pour modifier un tiers.')
    const tiers = await updateTiers(args.companyId, args.tiersId, routeBody(UpdateTiersBodySchema, args.tiers ?? {}), { source: 'mcp' })
    return { tiersId: tiers.id, changes: forAssistant(tiers), reviewUrl: kledgPageUrl(args.companyId, 'tiers'), message: `Tiers « ${tiers.name} » modifié.` }
  },
  audit: (args, result) => ({ action: args.action, tiersId: 'tiersId' in result ? result.tiersId : null }),
})

const duplicateEntryTool = draftTool({
  name: 'duplicate_entry',
  title: 'Dupliquer une écriture en brouillon',
  summary:
    'Copies an entry (same journal, date, description, reference and lines) as a new DRAFT, to adjust it with update_draft_entry (full control) or in Kledg. A copy into a closed fiscal year is refused.',
  never: 'validates the copy or changes the original entry.',
  amounts: 'euros',
  input: { entryId: id("L'écriture").describe('Entry to copy, from list_entries.') },
  permission: { entries: ['create'] },
  destructive: false,
  idempotent: false,
  async execute(args) {
    const entry = await duplicateEntry(args.companyId, args.entryId)
    return {
      entryId: entry.id,
      changes: { entryCreated: entry.id, status: entry.status, copyOf: args.entryId },
      reviewUrl: kledgPageUrl(args.companyId, 'entries'),
      message: 'Copie créée en brouillon : elle doit être validée dans Kledg.',
    }
  },
  audit: (args, result) => ({ sourceEntryId: args.entryId, entryId: result.entryId }),
})

const updateDraftInvoiceTool = draftTool({
  name: 'update_draft_invoice',
  title: 'Modifier une facture en brouillon',
  summary:
    'Edits an invoice that is still a draft (not posted): with invoice, the fields of a draft entered in Kledg (tiers, number, dates, lines; totals computed by Kledg); with lineAccounts, only the account and nature of lines (imported invoices keep their amounts). Refused (409) once the invoice is posted.',
  never: 'posts, validates or deletes the invoice or its entry.',
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd, VAT rates in percent.',
  input: {
    invoiceId: id('La facture').describe('Invoice id, from list_invoices.'),
    invoice: assistantInput(UpdateInvoiceBodySchema).optional(),
    lineAccounts: assistantInput(UpdateLineAccountsBodySchema.shape.lines).optional().describe('Lines of the invoice (ids from get_invoice) with their new account or nature.'),
  },
  permission: { entries: ['update'] },
  destructive: true,
  idempotent: true,
  async execute(args) {
    const invoice = args.lineAccounts
      ? await updateInvoiceLineAccounts(args.companyId, args.invoiceId, routeBody(UpdateLineAccountsBodySchema, { lines: args.lineAccounts }))
      : await updateInvoice(args.companyId, args.invoiceId, routeBody(UpdateInvoiceBodySchema, args.invoice ?? {}))
    return { changes: forAssistant(invoice), reviewUrl: kledgPageUrl(args.companyId, 'invoices'), message: 'Facture modifiée, toujours en brouillon.' }
  },
  audit: (args) => ({ invoiceId: args.invoiceId }),
})

const updateProvisionTool = draftTool({
  name: 'update_provision',
  title: 'Modifier une provision',
  summary:
    'Replaces a provision or an impairment recorded in Kledg (same fields as create_provision, carried balance in euros); its account and history are fixed once a movement is validated (409).',
  never: NEVER_POSTS,
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd.',
  input: { provisionId: id('La provision').describe('Provision id, from get_year_end_inventory.'), provision: assistantInput(ProvisionBodySchema) },
  permission: { entries: ['update'] },
  destructive: true,
  idempotent: true,
  async execute(args) {
    const provision = await updateProvision(args.companyId, args.provisionId, routeBody(ProvisionBodySchema, args.provision))
    return { changes: forAssistant(provision), reviewUrl: kledgPageUrl(args.companyId, 'provisions'), message: 'Provision modifiée.' }
  },
  audit: (args) => ({ provisionId: args.provisionId }),
})

const updateGrantTool = draftTool({
  name: 'update_investment_grant',
  title: 'Modifier une subvention d’investissement',
  summary:
    'Replaces an investment grant recorded in Kledg (same fields as create_investment_grant, amount in euros); its terms are fixed once a transfer is validated (409).',
  never: NEVER_POSTS,
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd, durations in years.',
  input: { grantId: id('La subvention').describe('Grant id, from get_year_end_inventory.'), grant: assistantInput(GrantBodySchema) },
  permission: { entries: ['update'] },
  destructive: true,
  idempotent: true,
  async execute(args) {
    const grant = await updateInvestmentGrant(args.companyId, args.grantId, routeBody(GrantBodySchema, args.grant))
    return { changes: forAssistant(grant), reviewUrl: kledgPageUrl(args.companyId, 'investment-grants'), message: 'Subvention modifiée.' }
  },
  audit: (args) => ({ grantId: args.grantId }),
})

const updateExpenseReportTool = draftTool({
  name: 'update_draft_expense_report',
  title: 'Modifier une note de frais',
  summary:
    'Replaces the period, label and lines of an expense report (lines in the route shape: kind EXPENSE or MILEAGE, date, label, amountInclTax and vat in euros, vatRate in percent, receipt, vehicle and distance for mileage): a brouillon by its author or a validator, a soumise by a validator; refused (409) once validated. Kledg recomputes the amounts and the recoverable VAT. For a company taxed at the impôt sur le revenu, a MEALS line takes mealTaker (EXPLOITANT or EMPLOYEE) when get_expense_report shows meal.status ask: posting is refused until it is given.',
  never: 'submits, validates, posts or deletes the report.',
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd, VAT rates in percent, distances in km.',
  input: { reportId: id('La note de frais').describe('Expense report id, from list_expense_reports.'), report: assistantInput(UpdateExpenseReportBodySchema) },
  permission: { expenses: ['submit'] },
  destructive: true,
  idempotent: true,
  async execute(args, ctx) {
    const actor = await expenseActorOf(ctx.access.user, args.companyId)
    const report = await updateExpenseReport(args.companyId, args.reportId, routeBody(UpdateExpenseReportBodySchema, args.report), actor)
    return { changes: forAssistant(report), reviewUrl: kledgPageUrl(args.companyId, `expense-reports/${args.reportId}`), message: 'Note de frais modifiée.' }
  },
  audit: (args) => ({ reportId: args.reportId }),
})

const reclassifyTool = draftTool({
  name: 'reclassify_doubtful_receivable',
  title: 'Reclasser une créance douteuse',
  summary:
    'Prepares, as a DRAFT entry, the reclassification of what a customer owes from 411 to 416 (doubtful receivable) at the closing of a fiscal year; the customer (tiersCode, its auxiliary account) comes from list_doubtful_receivables.',
  never: 'validates the entry or books the impairment (create_provision and prepare_year_end_entries do).',
  amounts: 'euros',
  input: { fiscalYearId: id("L'exercice"), tiersCode: z.string().min(1).max(40) },
  permission: { entries: ['create'] },
  destructive: false,
  idempotent: false,
  async execute(args) {
    const result = await reclassifyDoubtfulReceivable(args.companyId, routeBody(ReclassifyBodySchema, { companyId: args.companyId, fiscalYearId: args.fiscalYearId, tiersCode: args.tiersCode }))
    return { entryId: result.entryId, changes: forAssistant(result), reviewUrl: kledgPageUrl(args.companyId, 'entries'), message: 'Reclassement préparé en brouillon : il doit être validé dans Kledg.' }
  },
  audit: (args, result) => ({ entryId: result.entryId, tiersCode: args.tiersCode }),
})

const saveLocalTaxesTool = draftTool({
  name: 'save_local_taxes',
  title: 'Saisir l’avis de CFE et les ajustements de CVAE',
  summary:
    'Records the data of the local taxes of a calendar year (docs/impots-locaux.md): the CFE avis (total, acompte, date of the avis, note; null removes it) and the adjustments of the CVAE added value. Only the parts given change. Read the result with get_local_taxes.',
  never: 'pays, files or books anything (prepare_cfe_entry prepares the entry as a draft).',
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd.',
  input: assistantShape(SaveLocalTaxesBodySchema),
  permission: { entries: ['create'] },
  destructive: true,
  idempotent: true,
  async execute(args, ctx) {
    const { companyId, ...body } = args
    const saved = await saveLocalTaxes(companyId, routeBody(SaveLocalTaxesBodySchema, body), { userId: ctx.access.user.id })
    return { changes: saved, reviewUrl: kledgPageUrl(companyId, 'impots-locaux'), message: 'Impôts locaux enregistrés.' }
  },
  audit: (args) => ({ year: args.year }),
})

const prepareCfeTool = draftTool({
  name: 'prepare_cfe_entry',
  title: 'Préparer l’écriture de CFE',
  summary:
    'Prepares the CFE entry of a year as a DRAFT: the payment of the acompte or of the solde (63511 / 512) or the charge (63511 / 447 with counterpart payable). A matching draft is kept, a stale one replaced, a validated entry left alone.',
  never: 'validates the entry, pays or files anything.',
  amounts: 'euros',
  input: CfeEntryBodySchema.shape,
  permission: { entries: ['create'] },
  destructive: true,
  idempotent: true,
  async execute(args) {
    const { companyId, ...body } = args
    const result = await prepareCfeEntry(companyId, routeBody(CfeEntryBodySchema, body), { source: 'mcp' })
    return { changes: forAssistant(result), reviewUrl: kledgPageUrl(companyId, 'impots-locaux'), message: result.message }
  },
  audit: (args, result) => ({ year: args.year, kind: args.kind, entryId: (result.changes as { entryId?: string | null }).entryId ?? null }),
})

const corporateTaxInputsTool = draftTool({
  name: 'save_corporate_tax_inputs',
  title: 'Saisir les données de l’impôt sur les sociétés',
  summary:
    'Records what the books cannot tell for the corporate tax of a fiscal year (docs/impot-societes.md): capital fully paid up and held at 75 % by natural persons (reduced rate), deficits carried forward at the start (euros; null derives them), manual lines of the tax result, acomptes paid. Only the fields given change. Read the result with get_corporate_tax.',
  never: 'files, pays or books anything (prepare_corporate_tax_entry prepares the entries as drafts).',
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd.',
  input: assistantShape(CorporateTaxInputsBodySchema),
  permission: { entries: ['create'] },
  destructive: true,
  idempotent: true,
  async execute(args, ctx) {
    const { companyId, ...body } = args
    const saved = await saveCorporateTaxInputs(companyId, routeBody(CorporateTaxInputsBodySchema, body), { userId: ctx.access.user.id })
    return { changes: forAssistant(saved), reviewUrl: kledgPageUrl(companyId, 'impot-societes'), message: 'Données de l’impôt sur les sociétés enregistrées.' }
  },
  audit: (args) => ({ fiscalYearId: args.fiscalYearId }),
})

const recordFilingTool = draftTool({
  name: 'record_tax_filing',
  title: 'Enregistrer le dépôt d’une déclaration',
  summary:
    'Records that the user filed a return on impots.gouv.fr, or removes that record (action remove): tax vat for a VAT return (period aaaa-mm, aaaa-Tn or aaaa; filing date, amount paid and credit carried forward), tax corporate_tax for the corporate tax return of a fiscal year (filing date, result before deficits, deficits imputed, tax, reduced rate). The deadlines then show it filed. Other deadlines are marked with mark_declaration.',
  never: 'files or pays anything on impots.gouv.fr, and never books an entry.',
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd.',
  input: {
    tax: z.enum(['vat', 'corporate_tax']),
    action: z.enum(['record', 'remove']).default('record'),
    vat: assistantInput(VatFilingBodySchema).optional().describe('tax vat, action record: the filing (period, filedOn, amountDue, credit).'),
    corporateTax: assistantInput(CorporateTaxFilingBodySchema).optional().describe('tax corporate_tax, action record: the filing.'),
    period: z.string().max(20).optional().describe('tax vat, action remove: the period.'),
    fiscalYearId: z.string().max(100).optional().describe('tax corporate_tax, action remove: the fiscal year.'),
  },
  permission: { entries: ['create'] },
  destructive: true,
  idempotent: true,
  async execute(args, ctx) {
    const options = { userId: ctx.access.user.id }
    const page = args.tax === 'vat' ? 'declarations-tva' : 'impot-societes'
    let changes: unknown
    if (args.tax === 'vat') {
      changes =
        args.action === 'remove'
          ? await deleteVatFiling(args.companyId, routeBody(VatFilingQuerySchema, { period: args.period }).period)
          : await recordVatFiling(args.companyId, routeBody(VatFilingBodySchema, args.vat ?? {}), options)
    } else {
      changes =
        args.action === 'remove'
          ? await deleteCorporateTaxFiling(args.companyId, routeBody(CorporateTaxFilingQuerySchema, { fiscalYearId: args.fiscalYearId }).fiscalYearId)
          : await recordCorporateTaxFiling(args.companyId, routeBody(CorporateTaxFilingBodySchema, args.corporateTax ?? {}), options)
    }
    return {
      changes: forAssistant(changes),
      reviewUrl: kledgPageUrl(args.companyId, page),
      message: args.action === 'remove' ? 'Enregistrement du dépôt retiré.' : 'Dépôt enregistré : rien n’a été déposé ni payé par Kledg.',
    }
  },
  audit: (args) => ({
    tax: args.tax,
    action: args.action,
    period: args.period ?? (args.vat as { period?: string } | undefined)?.period ?? null,
    fiscalYearId: args.fiscalYearId ?? (args.corporateTax as { fiscalYearId?: string } | undefined)?.fiscalYearId ?? null,
  }),
})

const depreciationRecordTool = draftTool({
  name: 'save_depreciation_record',
  title: 'Enregistrer un amortissement d’une période',
  summary:
    'Depreciation records of a fixed asset (a record, not an accounting entry): action save records or replaces the depreciation of one period (periodType year or month with monthIndex, amount in euros, the plan’s amount when absent; replacing needs entries:update); action link links the record recordId to an entry of its fiscal year (entryId, from list_fixed_assets view link_candidates) or unlinks it (entryId null). Booking a record as an entry is manage_depreciation_record (full control).',
  never: 'books or validates a depreciation entry, and never deletes a record.',
  amounts: 'euros',
  input: {
    action: z.enum(['save', 'link']),
    fixedAssetId: id("L'immobilisation").describe('Fixed asset id, from list_fixed_assets.'),
    record: SaveDepreciationRecordSchema.optional().describe('action save: fiscalYearId, periodType, monthIndex, amount (euros), note.'),
    recordId: z.string().max(64).optional().describe('action link: the record, from list_fixed_assets view asset.'),
    entryId: z.string().max(64).nullable().optional().describe('action link: the entry to link, null to unlink.'),
  },
  permission: [],
  actions: { save: { entries: ['create'] }, link: { entries: ['update'] } },
  destructive: true,
  idempotent: true,
  async execute(args, ctx) {
    if (args.action === 'link') {
      if (!args.recordId) throw new ValidationError('recordId est requis pour lier un amortissement.')
      const body = routeBody(LinkDepreciationEntrySchema, { accountingEntryId: args.entryId ?? null })
      const record = await linkDepreciationRecord(args.companyId, args.fixedAssetId, args.recordId, body.accountingEntryId ?? null)
      return { changes: forAssistant(record), reviewUrl: kledgPageUrl(args.companyId, 'fixed-assets'), message: args.entryId ? 'Amortissement lié à l’écriture.' : 'Lien retiré.' }
    }
    // Replacing a record needs entries:update, like the route.
    let refusal: unknown = null
    await ctx.authorize({ entries: ['update'] }).catch((error: unknown) => {
      if (error instanceof ForbiddenError) refusal = error
      else throw error
    })
    const record = await saveDepreciationRecord(args.companyId, args.fixedAssetId, routeBody(SaveDepreciationRecordSchema, args.record ?? {}), {
      authorizeReplace: () => {
        if (refusal) throw refusal
      },
    })
    return { changes: forAssistant(record), reviewUrl: kledgPageUrl(args.companyId, 'fixed-assets'), message: 'Amortissement de la période enregistré (pas encore comptabilisé).' }
  },
  audit: (args) => ({ action: args.action, fixedAssetId: args.fixedAssetId, recordId: args.recordId ?? null }),
})

const MAX_OPENING_EUROS = 1e11

const openingBalancesTool = draftTool({
  name: 'prepare_opening_balances',
  title: 'Saisir les soldes d’ouverture en brouillon',
  summary:
    'Books the opening balances (à-nouveaux) of the first fiscal year of the company as a DRAFT entry in the AN journal: one line per account number with its debit or credit balance, debits equal to credits. Validate it with validate_entries (full control) or in Kledg.',
  never: 'validates the entry or changes a closed fiscal year.',
  amounts: 'euros',
  input: {
    lines: z
      .array(
        z.object({
          accountCode: z.string().trim().min(1).max(20),
          debit: eurosInput.min(0).max(MAX_OPENING_EUROS).default(0),
          credit: eurosInput.min(0).max(MAX_OPENING_EUROS).default(0),
        }),
      )
      .min(2)
      .max(200),
  },
  permission: { entries: ['create'] },
  destructive: false,
  idempotent: false,
  async execute(args) {
    const lines = args.lines.map((line) => ({
      accountCode: line.accountCode,
      debitCents: centsFromEuros(line.debit, `Débit ${line.accountCode}`),
      creditCents: centsFromEuros(line.credit, `Crédit ${line.accountCode}`),
    }))
    const entry = await postOpeningBalances({ companyId: args.companyId, lines, validate: false })
    return {
      entryId: entry.id,
      changes: { entryCreated: entry.id, status: entry.status, lines: lines.length },
      reviewUrl: kledgPageUrl(args.companyId, 'entries'),
      message: 'Soldes d’ouverture enregistrés en brouillon : l’écriture doit être validée.',
    }
  },
  audit: (_args, result) => ({ entryId: result.entryId }),
})

const acceptAllSuggestionsTool = draftTool({
  name: 'accept_all_expense_suggestions',
  title: 'Classer les dépenses sûres',
  summary:
    'Confirms, like the "Tout confirmer" button of the simple mode, the transactions of list_expenses_to_review among transactionIds whose suggestion, recomputed by Kledg, is of high confidence with no question to answer: one DRAFT entry each, reconciled with its transaction; the others come back in skipped with the reason. Each transaction is confirmed on its own.',
  never: 'validates the entries (they stay drafts whatever the company setting), creates a transaction rule, or sends a receipt to the bank.',
  amounts: 'none',
  input: { transactionIds: ConfirmAllBodySchema.shape.transactionIds.describe('Transaction ids, from list_expenses_to_review.') },
  permission: [{ banking: ['reconcile'] }, { entries: ['create'] }],
  destructive: false,
  idempotent: true,
  async execute(args, ctx) {
    const body = routeBody(ConfirmAllBodySchema, { transactionIds: args.transactionIds })
    const result = await confirmHighConfidenceExpenses(args.companyId, body.transactionIds, { userId: ctx.access.user.id, canValidate: false, source: 'mcp' })
    return { changes: forAssistant(result), reviewUrl: kledgPageUrl(args.companyId, 'entries/simple-mode'), message: 'Dépenses sûres classées en brouillon et rapprochées.' }
  },
  audit: (args) => ({ transactionIds: args.transactionIds }),
})

export function registerRecordDraftTools(register: RegisterDraftTool) {
  register(acceptAllSuggestionsTool)
  register(manageTiersTool)
  register(duplicateEntryTool)
  register(updateDraftInvoiceTool)
  register(updateProvisionTool)
  register(updateGrantTool)
  register(updateExpenseReportTool)
  register(reclassifyTool)
  register(saveLocalTaxesTool)
  register(prepareCfeTool)
  register(corporateTaxInputsTool)
  register(recordFilingTool)
  register(depreciationRecordTool)
  register(openingBalancesTool)
}
