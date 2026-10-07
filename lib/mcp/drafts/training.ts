/**
 * Draft-level tools of training organisations and of the taxes of an
 * exempt activity (docs/organisme-de-formation.md), each through the
 * service of its route with the route's right (entries:create):
 * - save_vat_deduction_settings: PUT /api/companies/[id]/vat-deduction;
 * - prepare_vat_coefficient_regularisation: POST .../vat-deduction/regularisation (DRAFT entry);
 * - save_training_report: PUT /api/companies/[id]/training-report;
 * - save_training_origins: PUT /api/companies/[id]/training-report/origins;
 * - save_payroll_tax: PUT /api/companies/[id]/payroll-tax;
 * - prepare_payroll_tax_entry: POST .../payroll-tax/entries (DRAFT entry).
 * None validates an entry, files a return or a BPF, or pays.
 */

import { z } from 'zod'
import { assistantShape, forAssistant, routeBody } from '@/lib/mcp/euros'
import { kledgPageUrl } from '@/lib/mcp/tool-meta'
import { SaveVatDeductionBodySchema, saveVatDeduction } from '@/lib/vat-deduction/save-vat-deduction.service'
import { VatRegularisationBodySchema, prepareVatRegularisation } from '@/lib/vat-deduction/prepare-regularisation.service'
import { VAT_DEDUCTION_WRITE } from '@/lib/vat-deduction/permissions'
import { SaveTrainingOriginsBodySchema, SaveTrainingReportBodySchema, saveTrainingOrigins, saveTrainingReport } from '@/lib/training-report/save-training-report.service'
import { TRAINING_ORIGINS } from '@/lib/training-report/origins'
import { TRAINING_REPORT_WRITE } from '@/lib/training-report/permissions'
import { SavePayrollTaxBodySchema, savePayrollTax } from '@/lib/payroll-tax/save-payroll-tax.service'
import { PayrollTaxEntryBodySchema, preparePayrollTaxEntry } from '@/lib/payroll-tax/prepare-payroll-tax-entry.service'
import { PAYROLL_TAX_WRITE } from '@/lib/payroll-tax/permissions'
import { draftTool, type RegisterDraftTool } from './define'

const ORIGIN_LIST = TRAINING_ORIGINS.map((o) => `${o.code} (${o.line ? `ligne ${o.line}` : 'hors formation'})`).join(', ')

const saveVatDeductionTool = draftTool({
  name: 'save_vat_deduction_settings',
  title: 'Régler le coefficient de déduction de TVA',
  summary:
    'Records what the books cannot tell about the coefficient de déduction (CGI ann. II art. 205 to 207): partialVatDeduction (the company makes taxed and exempt operations), for a year the estimated coefficient de taxation of a first year, the coefficient d’assujettissement, the VAT borne in the year (euros, null derives it), a note, and the VAT treatment of revenue accounts or roots (taxable, exempt, excluded; null returns to the automatic reading). Only the fields given change. Read the result with get_vat_deduction_coefficient. Postings made earlier do not change.',
  never: 'posts or changes an entry, or files a return.',
  amounts: 'euros',
  input: assistantShape(SaveVatDeductionBodySchema),
  permission: VAT_DEDUCTION_WRITE,
  destructive: true,
  idempotent: true,
  async execute(args, ctx) {
    const { companyId, ...body } = args
    const saved = await saveVatDeduction(companyId, routeBody(SaveVatDeductionBodySchema, body), { userId: ctx.access.user.id })
    return { changes: saved, reviewUrl: kledgPageUrl(companyId, 'coefficient-tva'), message: 'Réglages du coefficient de déduction enregistrés.' }
  },
  audit: (args) => ({ year: args.year ?? null }),
})

const prepareRegularisationTool = draftTool({
  name: 'prepare_vat_coefficient_regularisation',
  title: 'Préparer la régularisation du coefficient de déduction',
  summary:
    'Prepares, as a DRAFT entry in the OD journal dated 31 March of the following year, the regularisation of the coefficient de déduction of a finished calendar year: complement of deduction (44566 / 758, CA3 line 21) or VAT to pay back (658 / 44566, CA3 line 15), VAT borne x (definitive - provisional). Reference COEF-TVA-<year>. Idempotent: unchanged, replaced, validated (nothing changed) or nothing.',
  never: 'validates the entry, files the return or pays.',
  amounts: 'euros',
  input: VatRegularisationBodySchema.shape,
  permission: VAT_DEDUCTION_WRITE,
  destructive: true,
  idempotent: true,
  async execute(args) {
    const { companyId, ...body } = args
    const result = await prepareVatRegularisation(companyId, routeBody(VatRegularisationBodySchema, body), { source: 'mcp' })
    return { changes: forAssistant(result), reviewUrl: kledgPageUrl(companyId, result.entryId ? `entries/${result.entryId}` : 'coefficient-tva'), message: result.message }
  },
  audit: (args, result) => ({ year: args.year, entryId: (result.changes as { entryId?: string | null }).entryId ?? null }),
})

const saveTrainingReportTool = draftTool({
  name: 'save_training_report',
  title: 'Saisir le bilan pédagogique et financier',
  summary:
    'Records the frames of the bilan pédagogique et financier of a fiscal year the books cannot give (cerfa 10443*17): distanceLearning (frame B), charges overrides in euros (frame D; null keeps the books), trainers internal and external (frame E, count and hours), trainees by type (F-1), subcontracted (F-2), objectives (F-3), up to five specialities with their three digit NSF code and otherSpecialities (F-4), entrusted (G), note. The data replaces the stored frames as a whole: read them first with get_training_report.',
  never: 'files the BPF on Mon Activité Formation or changes the books.',
  amounts: 'euros',
  input: assistantShape(SaveTrainingReportBodySchema),
  permission: TRAINING_REPORT_WRITE,
  destructive: true,
  idempotent: true,
  async execute(args, ctx) {
    const { companyId, ...body } = args
    const saved = await saveTrainingReport(companyId, routeBody(SaveTrainingReportBodySchema, body), { userId: ctx.access.user.id })
    return { changes: saved, reviewUrl: kledgPageUrl(companyId, `bilan-pedagogique-financier?exercice=${saved.fiscalYearId}`), message: 'Bilan pédagogique et financier enregistré.' }
  },
  audit: (args) => ({ fiscalYearId: args.fiscalYearId }),
})

const saveTrainingOriginsTool = draftTool({
  name: 'save_training_origins',
  title: 'Affecter les recettes aux lignes du BPF',
  summary: `Assigns the origin (frame C line of the bilan pédagogique et financier) of revenue accounts or roots (accounts: accountCode, trainingOrigin) and of customers (customers: tiersId from get_training_report, trainingOrigin); a customer wins over its account; null returns to "to assign". Origins: ${ORIGIN_LIST}.`,
  never: 'changes an entry or files anything.',
  amounts: 'none',
  input: { accounts: z.array(z.object({ accountCode: z.string(), trainingOrigin: z.string().nullable() })).max(200).optional(), customers: z.array(z.object({ tiersId: z.string(), trainingOrigin: z.string().nullable() })).max(500).optional() },
  permission: TRAINING_REPORT_WRITE,
  destructive: true,
  idempotent: true,
  async execute(args) {
    const { companyId, ...body } = args
    const saved = await saveTrainingOrigins(companyId, routeBody(SaveTrainingOriginsBodySchema, body))
    return { changes: saved, reviewUrl: kledgPageUrl(companyId, 'bilan-pedagogique-financier'), message: 'Origines des recettes enregistrées.' }
  },
  audit: (args) => ({ accounts: args.accounts?.length ?? 0, customers: args.customers?.length ?? 0 }),
})

const savePayrollTaxTool = draftTool({
  name: 'save_payroll_tax',
  title: 'Saisir les rémunérations de la taxe sur les salaires',
  summary:
    'Records the taxe sur les salaires data of a calendar year the books cannot give: the annual base of each employee (euros; the remunerations retained for the CSG on activity income, without the 1,75 % abatement), association (abattement of CGI art. 1679 A), the share of the receipts without a right to deduct entered in percent, two decimals at most (ratioPercent, 10.4: liable above 10 %, CGI art. 231, 1; null: from the books of the year before), the tax of the year before when Kledg does not hold it, a note. Replaces the year as a whole; the computation is then written for the deadline calendar. Read it with get_payroll_tax.',
  never: 'files a relevé or a declaration, pays, or posts an entry (prepare_payroll_tax_entry prepares it as a draft).',
  amounts: 'euros',
  input: assistantShape(SavePayrollTaxBodySchema),
  permission: PAYROLL_TAX_WRITE,
  destructive: true,
  idempotent: true,
  async execute(args, ctx) {
    const { companyId, ...body } = args
    const saved = await savePayrollTax(companyId, routeBody(SavePayrollTaxBodySchema, body), { userId: ctx.access.user.id })
    return { changes: forAssistant(saved), reviewUrl: kledgPageUrl(companyId, `taxe-sur-les-salaires?annee=${saved.year}`), message: 'Taxe sur les salaires enregistrée.' }
  },
  audit: (args) => ({ year: args.year }),
})

const preparePayrollTaxTool = draftTool({
  name: 'prepare_payroll_tax_entry',
  title: 'Préparer l’écriture de taxe sur les salaires',
  summary:
    'Prepares the taxe sur les salaires of a year as a DRAFT entry in the OD journal dated 31 December: debit 6311, credit 447. Reference TS-<year>. Idempotent: unchanged, replaced, validated (nothing changed) or nothing when no tax is due.',
  never: 'validates the entry, files or pays anything.',
  amounts: 'euros',
  input: PayrollTaxEntryBodySchema.shape,
  permission: PAYROLL_TAX_WRITE,
  destructive: true,
  idempotent: true,
  async execute(args) {
    const { companyId, ...body } = args
    const result = await preparePayrollTaxEntry(companyId, routeBody(PayrollTaxEntryBodySchema, body), { source: 'mcp' })
    return { changes: forAssistant(result), reviewUrl: kledgPageUrl(companyId, result.entryId ? `entries/${result.entryId}` : 'taxe-sur-les-salaires'), message: result.message }
  },
  audit: (args, result) => ({ year: args.year, entryId: (result.changes as { entryId?: string | null }).entryId ?? null }),
})

export function registerTrainingDraftTools(register: RegisterDraftTool): void {
  register(saveVatDeductionTool)
  register(prepareRegularisationTool)
  register(saveTrainingReportTool)
  register(saveTrainingOriginsTool)
  register(savePayrollTaxTool)
  register(preparePayrollTaxTool)
}
