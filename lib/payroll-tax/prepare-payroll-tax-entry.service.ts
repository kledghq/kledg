/**
 * The taxe sur les salaires of a year as a DRAFT entry, never validated:
 * debit 6311 "Taxe sur les salaires", credit 447 "Autres impôts, taxes et
 * versements assimilés" (PCG, list of accounts), journal OD, dated
 * 31 December of the year, reference "TS-2026", in the fiscal year that
 * contains the day (it must exist and be open). The payments of the relevés
 * and of the 2502 then settle 447 through the bank reconciliation.
 *
 * Idempotent through the draft writer of the corporate tax module (advisory
 * lock per company and reference, lock of the fiscal year): a matching
 * draft is kept, a stale one replaced, a validated entry never touched, a
 * zero amount creates nothing.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError } from '@/lib/accounting/errors'
import { writeAuditLog } from '@/lib/audit'
import { resolveCodes, writeDraft, type Planned } from '@/lib/corporate-tax/prepare-corporate-tax-entries.service'
import type { SettlementLine } from '@/lib/vat-returns/settlement'
import { formatCentsFr } from '@/lib/utils/money'
import { loadPayrollTax } from './load-payroll-tax.service'
import { payrollTaxReference } from './rules'

export const PayrollTaxEntryBodySchema = z.object({
  year: z.number({ error: 'L’année est requise' }).int('Année invalide').min(2000, 'Année invalide').max(2100, 'Année invalide'),
})
export type PayrollTaxEntryBody = z.infer<typeof PayrollTaxEntryBodySchema>

export interface PayrollTaxEntryResult {
  status: 'created' | 'replaced' | 'unchanged' | 'validated' | 'nothing'
  reference: string
  entryId: string | null
  entryNumber: string | null
  lines: SettlementLine[]
  message: string
}

const ACCOUNTS = {
  charge: { code: '6311', label: 'Taxe sur les salaires' },
  payable: { code: '447', label: 'Autres impôts, taxes et versements assimilés' },
} as const

export async function preparePayrollTaxEntry(companyId: string, input: PayrollTaxEntryBody, options: { now?: Date; source?: 'web' | 'mcp' } = {}): Promise<PayrollTaxEntryResult> {
  const body = PayrollTaxEntryBodySchema.parse(input)
  const view = await loadPayrollTax(companyId, { year: body.year }, { now: options.now })
  const reference = payrollTaxReference(body.year)
  const nothing = (message: string): PayrollTaxEntryResult => ({ status: 'nothing', reference, entryId: null, entryNumber: null, lines: [], message })
  if (view.liability !== 'liable') return nothing(`La société n’est pas redevable de la taxe sur les salaires en ${body.year} : il n’y a rien à comptabiliser.`)
  if (!view.computation) throw new ConflictError(`Le barème ${body.year} n’est pas dans Kledg : la taxe ne peut pas être calculée.`)
  const amount = view.computation.dueCents
  if (amount <= 0) return nothing(`Aucune taxe sur les salaires due pour ${body.year} (franchise, décote ou abattement) : il n’y a rien à comptabiliser.`)

  const date = `${body.year}-12-31`
  const at = new Date(`${date}T00:00:00.000Z`)
  const fiscalYear = await prisma.fiscalYear.findFirst({ where: { companyId, startDate: { lte: at }, endDate: { gte: at } }, select: { id: true } })
  if (!fiscalYear) throw new NotFoundError(`Aucun exercice ne contient le 31/12/${body.year} : créez-le pour préparer l’écriture.`)

  const plan: Planned = {
    fiscalYearId: fiscalYear.id,
    journal: { code: 'OD', label: 'Opérations diverses' },
    date,
    description: `Taxe sur les salaires ${body.year}`,
    reference,
    lines: [
      { ...ACCOUNTS.charge, debitCents: amount, creditCents: 0 },
      { ...ACCOUNTS.payable, debitCents: 0, creditCents: amount },
    ],
  }
  plan.lines = await resolveCodes(companyId, plan.fiscalYearId, plan.lines, null)
  const result = await writeDraft(companyId, plan, 'payroll-tax-entry')
  if (result.status === 'created' || result.status === 'replaced') {
    await writeAuditLog('info', `Payroll tax draft prepared (${reference})`, {
      action: 'PREPARE_PAYROLL_TAX_ENTRY',
      companyId,
      metadata: { year: body.year, amountCents: amount, reference, entryId: result.entryId, status: result.status, source: options.source ?? 'web' },
    })
  }
  const euros = formatCentsFr(amount)
  const messages: Record<typeof result.status, string> = {
    created: `Écriture préparée en brouillon (${result.entryNumber}, ${euros}) : vérifiez-la, puis validez-la.`,
    replaced: `Le brouillon ne correspondait plus au calcul : il est remplacé (${result.entryNumber}, ${euros}).`,
    unchanged: `Le brouillon ${result.entryNumber} correspond déjà au calcul.`,
    validated: `L’écriture ${result.entryNumber} est déjà validée : pour la corriger, contre-passez-la puis préparez-la à nouveau.`,
  }
  return { ...result, lines: plan.lines, message: messages[result.status] }
}
