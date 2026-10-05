/**
 * Read tools of training organisations and of the taxes that follow from
 * an exempt activity (docs/organisme-de-formation.md):
 * - get_vat_deduction_coefficient: the coefficient de déduction of a year,
 *   as GET /api/companies/[id]/vat-deduction;
 * - get_training_report: the bilan pédagogique et financier of a fiscal
 *   year, as GET /api/companies/[id]/training-report;
 * - get_payroll_tax: the taxe sur les salaires of a year, as
 *   GET /api/companies/[id]/payroll-tax.
 * Each checks the company guard with reports:read first. Kledg never files
 * nor pays: the user does on impots.gouv.fr and Mon Activité Formation.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { parseInput } from '@/lib/api/zod-fields'
import { READ_ONLY, describeTool, kledgPageUrl } from '@/lib/mcp/tool-meta'
import { fromCents } from '@/lib/utils/money'
import { loadVatDeduction } from '@/lib/vat-deduction/load-vat-deduction.service'
import { VAT_DEDUCTION_READ } from '@/lib/vat-deduction/permissions'
import { loadTrainingReport } from '@/lib/training-report/load-training-report.service'
import { TRAINING_REPORT_READ } from '@/lib/training-report/permissions'
import { loadPayrollTax } from '@/lib/payroll-tax/load-payroll-tax.service'
import { PAYROLL_TAX_READ } from '@/lib/payroll-tax/permissions'

const euros = (cents: number | null | undefined) => (cents === null || cents === undefined ? null : fromCents(cents))
const companyId = z.string().min(1, 'La société est requise').describe('Company id, from list_companies.')

const YearInput = z.object({ companyId, year: z.number().int().min(2000).max(2100).optional().describe('Calendar year; see each tool for the default.') })
const FiscalYearInput = z.object({ companyId, fiscalYearId: z.string().max(64).optional().describe('Fiscal year id, from list_fiscal_years; the last closed one by default.') })

export function registerTrainingReadTools(server: McpServer, guard: CompanyGuard) {
  server.registerTool(
    'get_vat_deduction_coefficient',
    {
      title: 'Coefficient de déduction de TVA',
      description: describeTool({
        summary:
          'The coefficient de déduction of a company with taxed and exempt operations (training exempt under CGI art. 261, 4, 4° a) for a calendar year (the year before until 24 April, else the current year): mode (full deduction, franchise, coefficient), revenue by class 7 account split into taxable (opens a right to deduct: collected VAT, exports marked taxable), exempt (sales invoice lines marked exempt), to classify (no VAT and no exemption, counted as exempt) and excluded (accounts 71 to 79 by default), the coefficient de taxation rounded up to the whole percent (CGI ann. II art. 206, V, 2), the provisional coefficient (from the year before, else the estimate, else the books to date), the definitive one, and the regularisation before 25 April of the following year (VAT borne x (definitive - provisional)) with its return line (CA3 21 or 15, CA12 25 or 18) and the state of its draft.',
        access: 'read',
        permission: VAT_DEDUCTION_READ,
        amounts: 'euros',
        units: 'Amounts in euros with cents; coefficients in whole percents.',
        never: 'changes a setting, posts an entry or files a return.',
      }),
      inputSchema: YearInput,
      annotations: READ_ONLY,
    },
    (raw: unknown) =>
      run(async () => {
        const args = parseInput(YearInput, raw)
        await guard.require(args.companyId, VAT_DEDUCTION_READ)
        const view = await loadVatDeduction(args.companyId, { year: args.year })
        const r = view.regularisation
        return json({
          year: view.year,
          mode: view.mode,
          partialVatDeduction: view.partialVatDeduction,
          trainingOrganisation: view.trainingOrganisation,
          yearClosed: view.yearClosed,
          revenue: {
            taxable: euros(view.revenue.taxableCents),
            exempt: euros(view.revenue.exemptCents),
            toClassify: euros(view.revenue.toClassifyCents),
            excluded: euros(view.revenue.excludedCents),
            accounts: view.revenue.accounts.map((a) => ({
              account: a.code,
              label: a.label,
              total: euros(a.totalCents),
              taxable: euros(a.taxableCents),
              exempt: euros(a.exemptCents),
              toClassify: euros(a.toClassifyCents),
              excluded: euros(a.excludedCents),
              source: a.source,
              setting: a.setting,
            })),
          },
          taxationPercent: view.taxationPercent,
          provisional: view.provisional,
          definitiveDeductionPercent: view.definitiveDeductionPercent,
          coefficientLine: view.coefficientLine,
          regularisation: {
            deducted: euros(r.deductedCents),
            incurred: euros(r.incurredCents),
            incurredSource: r.incurredSource,
            amount: euros(r.amountCents),
            form: r.form,
            line: r.line,
            deadline: r.deadline,
            entryDate: r.entryDate,
            draft: r.draft,
          },
          settings: { ...view.settings, incurredVat: euros(view.settings.incurredVatCents), incurredVatCents: undefined },
          hints: view.hints,
          sources: view.sources,
          reviewUrl: kledgPageUrl(args.companyId, `coefficient-tva?annee=${view.year}`),
        })
      }),
  )

  server.registerTool(
    'get_training_report',
    {
      title: 'Bilan pédagogique et financier',
      description: describeTool({
        summary:
          'The bilan pédagogique et financier (cerfa 10443*17) of a closed fiscal year of a training organisation (Code du travail L6352-11, R6352-22, sent before 30 April on Mon Activité Formation): frame C (origin of the products excluding tax, lines 1, a to h, 2, 3 to 11, total and share of turnover, rounded to the euro) from the revenue accounts (70, 74) and the origin assigned to each customer or account, the revenue left to assign, frame D (charges, of which trainers’ salaries 6411 and training purchases 604 and 6226) from the books unless entered, the frames entered by hand (B distance learning, E trainers, F-1 to F-4 trainees, objectives, specialities, G entrusted), the consistency checks of the notice, the deadline and the sources.',
        access: 'read',
        permission: TRAINING_REPORT_READ,
        amounts: 'euros',
        units: 'Frame C and D in whole euros; other amounts in euros with cents; hours rounded to the hour.',
        never: 'files the BPF or changes the books.',
      }),
      inputSchema: FiscalYearInput,
      annotations: READ_ONLY,
    },
    (raw: unknown) =>
      run(async () => {
        const args = parseInput(FiscalYearInput, raw)
        await guard.require(args.companyId, TRAINING_REPORT_READ)
        const view = await loadTrainingReport(args.companyId, { fiscalYearId: args.fiscalYearId })
        return json({
          trainingOrganisation: view.trainingOrganisation,
          establishments: view.establishments,
          fiscalYear: view.fiscalYear,
          deadline: view.deadline,
          frameC: view.frameC
            ? { lines: view.frameC.lines.map((l) => ({ line: l.line, code: l.code, label: l.label, euros: l.euros })), line2: view.frameC.opcoTotalEuros, total: view.frameC.totalEuros, sharePercent: view.frameC.sharePercent, outsideTraining: view.frameC.outsideEuros, unassigned: euros(view.frameC.unassignedCents) }
            : null,
          frameD: view.frameD,
          revenue: view.revenue.map((r) => ({ account: r.code, customer: r.tiers, amount: euros(r.cents), origin: r.origin, source: r.source })),
          customers: view.customers.map((c) => ({ id: c.id, name: c.name, auxiliaryAccount: c.auxiliaryAccountNumber, origin: c.trainingOrigin, revenue: euros(c.cents) })),
          accountOrigins: view.accountOrigins,
          frames: view.data,
          totals: view.totals,
          checks: view.checks,
          sources: view.sources,
          reviewUrl: kledgPageUrl(args.companyId, view.fiscalYear ? `bilan-pedagogique-financier?exercice=${view.fiscalYear.id}` : 'bilan-pedagogique-financier'),
        })
      }),
  )

  server.registerTool(
    'get_payroll_tax',
    {
      title: 'Taxe sur les salaires',
      description: describeTool({
        summary:
          'The taxe sur les salaires of a calendar year (current by default; CGI art. 231): liability (not subject to VAT on 90 % of the turnover of the year before; franchise en base not liable), rapport d’assujettissement from the revenue of the year before (truncated to the whole percent, smoothing table between 10 and 20 %) or entered, the computation of the 2502 from the annual base of each employee entered (bases by bracket A, A1, A2 rounded to the euro, 4,25 %, 4,25 % and 9,35 %, rapport, franchise of 1 200 €, décote up to 2 040 €, association abattement after them), the barème of 2025 and 2026 only, the salaries of the books (641, 644) as a check, the frequency of the relevés 2501 from the tax of the year before (monthly above 10 000 €, quarterly from 4 000 €), the schedule, the draft and the sources.',
        access: 'read',
        permission: PAYROLL_TAX_READ,
        amounts: 'euros',
        units: 'Amounts in euros; rates in percents.',
        never: 'files a relevé or a declaration, pays, or posts an entry.',
      }),
      inputSchema: YearInput,
      annotations: READ_ONLY,
    },
    (raw: unknown) =>
      run(async () => {
        const args = parseInput(YearInput, raw)
        await guard.require(args.companyId, PAYROLL_TAX_READ)
        const view = await loadPayrollTax(args.companyId, { year: args.year })
        const c = view.computation
        return json({
          year: view.year,
          covered: view.covered,
          liability: view.liability,
          reference: { year: view.reference.year, withoutDeduction: euros(view.reference.nonDeductibleCents), total: euros(view.reference.totalCents), toClassify: euros(view.reference.toClassifyCents) },
          ratio: view.ratio,
          employees: view.data.employees.map((e) => ({ id: e.id, label: e.label, base: euros(e.baseCents) })),
          association: view.data.association,
          computation: c
            ? {
                baseA: euros(c.baseCents),
                baseA1: euros(c.firstBracketCents),
                baseA2: euros(c.secondBracketCents),
                taxD0: euros(c.taxBaseCents),
                taxD1: euros(c.taxFirstCents),
                taxD2: euros(c.taxSecondCents),
                gross: euros(c.grossCents),
                ratioPercent: c.ratioPercent,
                afterRatio: euros(c.afterRatioCents),
                franchise: c.franchise,
                decote: euros(c.decoteCents),
                abatement: euros(c.abatementCents),
                due: euros(c.dueCents),
              }
            : null,
          booksSalaries: euros(view.booksSalariesCents),
          enteredBases: euros(view.enteredBasesCents),
          previousYearTax: { amount: euros(view.previous.taxCents), source: view.previous.source },
          frequency: view.frequency,
          schedule: view.schedule,
          draft: view.draft,
          hints: view.hints,
          sources: view.sources,
          reviewUrl: kledgPageUrl(args.companyId, `taxe-sur-les-salaires?annee=${view.year}`),
        })
      }),
  )
}
