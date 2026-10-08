/**
 * Full control tools of the year end: depreciation entries ("Générer les
 * dotations"), closing (clôture), allocation of the result (affectation du
 * résultat) and the FEC. Thin wrappers over
 * lib/fixed-assets/depreciation-entries.ts, lib/accounting/fiscal-year-closure,
 * lib/accounting/result-allocation/allocate-result.service.ts and lib/fec.
 */

import { z } from 'zod'
import { ConflictError, ValidationError } from '@/lib/accounting/errors'
import { parseCents } from '@/lib/utils/money'
import { closeFiscalYear, simulateFiscalYearClosure } from '@/lib/accounting/fiscal-year-closure'
import { allocateResult, previewResultAllocation } from '@/lib/accounting/result-allocation/allocate-result.service'
import type { AllocationPlan } from '@/lib/accounting/result-allocation/compute'
import { findUnpostedDepreciation, generateDepreciationEntries } from '@/lib/fixed-assets/depreciation-entries'
import { exportFec } from '@/lib/fec/export'
import { validateFec } from '@/lib/fec/validator'
import { FEC_FILE_NAME } from '@/lib/fec/format'
import { day } from '@/lib/mcp/tool-result'
import { MAX_MCP_FILE_BYTES, fileTooLargeMessage } from '@/lib/mcp/file-result'
import { enforceRateLimit } from '@/lib/rate-limit'
import { fullControlTool, type RegisterTool } from './define'
import { ACTS_AS_USER, TWO_STEP } from './descriptions'
import { euros, isoDate, ownedFiscalYear } from './resolve'

const fiscalYearId = z.string().min(1).describe('Fiscal year id, from list_fiscal_years.')

const generateDepreciation = fullControlTool({
  name: 'generate_depreciation',
  title: 'Générer les dotations',
  description: `Books the missing depreciation entries of a fiscal year (Générer les dotations): one VALIDATED entry per fixed asset in the OD journal on the last day of the year, debit 6811 / credit 28 (PCG art. 214-13, prorata temporis). Allowances already booked are skipped, so running it twice books nothing twice. Refused on a closed year. ${ACTS_AS_USER} ${TWO_STEP} The dry run lists each allowance and the total.`,
  input: { fiscalYearId },
  permission: { entries: ['create', 'validate'] },
  amounts: 'euros',
  never: 'books an allowance twice or writes in a closed fiscal year.',
  idempotent: true,
  confirmation: true,
  async preview({ companyId, fiscalYearId }) {
    const fiscalYear = await ownedFiscalYear(companyId, fiscalYearId)
    const items = await findUnpostedDepreciation(companyId, fiscalYear.id)
    return {
      fiscalYear: fiscalYear.year,
      entryDate: day(fiscalYear.endDate),
      count: items.length,
      total: items.reduce((s, i) => s + i.amountCents, 0) / 100,
      allowances: items.map((i) => ({
        fixedAssetId: i.fixedAssetId,
        label: i.label,
        amount: i.amountCents / 100,
        debit: i.expenseAccount.code,
        credit: i.depreciationAccount.code,
      })),
      warnings: fiscalYear.isClosed ? [`L'exercice ${fiscalYear.year} est clôturé : la génération sera refusée.`] : [],
    }
  },
  async execute({ companyId, fiscalYearId }) {
    const fiscalYear = await ownedFiscalYear(companyId, fiscalYearId)
    const result = await generateDepreciationEntries(companyId, fiscalYear.id)
    return {
      count: result.count,
      total: result.totalCents / 100,
      entries: result.entries.map((e) => ({ fixedAssetId: e.fixedAssetId, entryId: e.entryId, amount: e.amountCents / 100 })),
    }
  },
  audit: ({ fiscalYearId }, result) => ({ fiscalYearId, entryIds: result.entries.map((e) => e.entryId), count: result.count }),
})

const closeFiscalYearTool = fullControlTool({
  name: 'close_fiscal_year',
  title: "Clôturer l'exercice",
  description: `Closes a fiscal year (clôture), irreversibly and in one transaction: closing entry bringing the result to 120 / 129, next fiscal year and its chart, opening entry (à-nouveaux), then the year is locked for good (PCG art. 1031-4). Refused while drafts remain, before the end date, or when an earlier year is open. ${ACTS_AS_USER} ${TWO_STEP} The dry run is the closing simulation: result, entries, next year and the blocking errors.`,
  input: { fiscalYearId },
  permission: { closing: ['execute'] },
  amounts: 'euros',
  never: 'closes a year with drafts, before its end date or after an open earlier year; and never reopens a year.',
  confirmation: true,
  destructive: true,
  async preview({ companyId, fiscalYearId }) {
    const fiscalYear = await ownedFiscalYear(companyId, fiscalYearId)
    const simulation = await simulateFiscalYearClosure(companyId, fiscalYear.id)
    return {
      fiscalYear: fiscalYear.year,
      canClose: simulation.success,
      errors: simulation.errors ?? [],
      warnings: simulation.warnings ?? simulation.simulation?.warnings ?? [],
      simulation: simulation.simulation ?? null,
    }
  },
  async execute({ companyId, fiscalYearId }, { access }) {
    const fiscalYear = await ownedFiscalYear(companyId, fiscalYearId)
    const result = await closeFiscalYear(companyId, fiscalYear.id, { userId: access.user.id })
    if (!result.success) {
      const message = (result.errors ?? []).join(' ') || "Impossible de clôturer l'exercice"
      throw result.alreadyClosed ? new ConflictError('Cet exercice est déjà clôturé') : new ValidationError(message)
    }
    return {
      closed: true,
      fiscalYear: fiscalYear.year,
      result: result.result,
      nextFiscalYearId: result.nextFiscalYearId,
      closingEntryId: result.closingEntryId ?? null,
      openingEntryId: result.openingEntryId ?? null,
      warnings: result.warnings ?? [],
    }
  },
  audit: ({ fiscalYearId }, result) => ({
    fiscalYearId,
    nextFiscalYearId: result.nextFiscalYearId,
    closingEntryId: result.closingEntryId,
    openingEntryId: result.openingEntryId,
  }),
})

function euroPlan(plan: AllocationPlan) {
  return {
    result: plan.resultCents / 100,
    legalReserveRequired: plan.legalReserveRequired,
    legalReserve: plan.legalReserveCents / 100,
    distributable: plan.distributableCents / 100,
    dividends: plan.dividendsCents / 100,
    otherReserves: plan.otherReservesCents / 100,
    priorLossesCleared: plan.priorLossesClearedCents / 100,
    retainedEarnings: plan.retainedEarningsCents / 100,
    lines: plan.lines.map((l) => ({ account: l.code, debit: l.debitCents / 100, credit: l.creditCents / 100 })),
    errors: plan.errors,
  }
}

function cents(value: string | number | undefined, field: string): number {
  if (value === undefined) return 0
  const parsed = parseCents(value)
  if (parsed === null || parsed < 0) throw new ValidationError(`${field} : montant invalide`)
  return parsed
}

const allocateInput = {
  fiscalYearId: fiscalYearId.describe(
    'The OPEN fiscal year in which the allocation is booked (the year after the one whose result is allocated), from list_fiscal_years.',
  ),
  date: isoDate.describe("Date of the shareholders' meeting (assemblée) that voted the allocation, in that fiscal year."),
  dividends: euros.optional().describe('Dividends voted, in euros (default 0).'),
  otherReserves: euros.optional().describe('Amount put to other reserves (autres réserves), in euros (default 0).'),
}

const allocateResultTool = fullControlTool({
  name: 'allocate_result',
  title: 'Affecter le résultat',
  description: `Books the allocation of the previous year's result (affectation du résultat) voted by the shareholders: legal reserve when required (Code de commerce art. L. 232-10), dividends, other reserves, retained earnings (report à nouveau), as one validated OD entry. Refused when the result is already allocated. ${ACTS_AS_USER} ${TWO_STEP} The dry run shows the balances, the allocation plan and its entry lines.`,
  input: allocateInput,
  permission: { closing: ['execute'] },
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd.',
  never: 'allocates a result twice.',
  confirmation: true,
  destructive: true,
  async preview({ companyId, fiscalYearId, dividends, otherReserves }) {
    const preview = await previewResultAllocation(companyId, fiscalYearId, {
      dividendsCents: cents(dividends, 'Dividendes'),
      otherReservesCents: cents(otherReserves, 'Autres réserves'),
    })
    return {
      fiscalYear: preview.fiscalYear.year,
      allocatedYear: preview.fiscalYear.year - 1,
      balances: {
        result: preview.balances.resultCents / 100,
        legalReserve: preview.balances.legalReserveCents / 100,
        capital: preview.balances.capitalCents / 100,
        retainedEarnings: preview.balances.retainedEarningsCents / 100,
        priorLosses: preview.balances.priorLossesCents / 100,
      },
      plan: euroPlan(preview.plan),
    }
  },
  async execute({ companyId, fiscalYearId, date, dividends, otherReserves }, { access }) {
    const fiscalYear = await ownedFiscalYear(companyId, fiscalYearId)
    const result = await allocateResult(companyId, fiscalYear.id, {
      date,
      dividendsCents: cents(dividends, 'Dividendes'),
      otherReservesCents: cents(otherReserves, 'Autres réserves'),
      userId: access.user.id,
    })
    return { entryId: result.entryId, entryNumber: result.entryNumber, plan: euroPlan(result.plan) }
  },
  audit: ({ fiscalYearId }, result) => ({ fiscalYearId, entryId: result.entryId, entryNumber: result.entryNumber }),
})

const exportFecTool = fullControlTool({
  name: 'export_fec',
  title: 'Exporter le FEC',
  description: `Exports the FEC (fichier des écritures comptables, LPF art. A47 A-1) of a fiscal year: the file name (SirenFECAAAAMMJJ.txt), its content (tab separated, validated entries only) and the compliance report of the file (errors and warnings). A FEC above ${MAX_MCP_FILE_BYTES / 1024 / 1024} MB is refused, like export_report: the user downloads it from Kledg. Within the export limit of the user. ${ACTS_AS_USER}`,
  input: { fiscalYearId },
  permission: { reports: ['export'] },
  amounts: 'euros',
  never: 'includes draft entries or changes anything (read only).',
  idempotent: true,
  confirmation: false,
  readOnly: true,
  async execute({ companyId, fiscalYearId }, ctx) {
    // Same limits as export_report and the FEC route (app/api/fec/route.ts): the export rate limit and the size of a file sent to an assistant.
    await enforceRateLimit('export', ctx.access.user.id)
    const fiscalYear = await ownedFiscalYear(companyId, fiscalYearId)
    const fec = await exportFec(companyId, fiscalYear.id)
    const size = Buffer.byteLength(fec.content, 'utf8')
    if (size > MAX_MCP_FILE_BYTES) throw new ValidationError(fileTooLargeMessage(size))
    const report = validateFec(fec.content, { fileName: fec.fileName, closingDate: FEC_FILE_NAME.exec(fec.fileName)?.[2] })
    return { fileName: fec.fileName, entries: fec.entries, lines: fec.lines, report, content: fec.content }
  },
  audit: ({ fiscalYearId }, result) => ({ fiscalYearId, fileName: result.fileName, entries: result.entries }),
})

export function registerYearEndTools(register: RegisterTool) {
  register(generateDepreciation)
  register(closeFiscalYearTool)
  register(allocateResultTool)
  register(exportFecTool)
}
