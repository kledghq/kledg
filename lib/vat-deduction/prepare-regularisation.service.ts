/**
 * The regularisation of the coefficient de déduction of a calendar year as
 * a DRAFT entry, never validated (CGI ann. II art. 206, V, 2 and 207;
 * BOI-TVA-DED-20-10-40; docs/organisme-de-formation.md):
 * - complement of deduction (definitive coefficient above the provisional
 *   one): debit 44566 "TVA sur autres biens et services", credit 758
 *   "Indemnités et autres produits"; the VAT return reads it on CA3 line 21
 *   (CA12 line 25);
 * - reversement (definitive below provisional): debit 658 "Pénalités et
 *   autres charges", credit 44566; CA3 line 15 (CA12 line 18).
 * The counterpart accounts are a default: the accountant may move the
 * amount to the charges or fixed assets concerned before validating.
 * Dated 31 March of the following year, journal OD, reference
 * "COEF-TVA-2026": it goes into the return filed in April, before the
 * 25 April limit. The fiscal year containing the day must exist and be
 * open.
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
import { loadVatDeduction } from './load-vat-deduction.service'
import { regularisationReference } from './rules'

export const VatRegularisationBodySchema = z.object({
  year: z.number({ error: 'L’année est requise' }).int('Année invalide').min(2000, 'Année invalide').max(2100, 'Année invalide'),
})
export type VatRegularisationBody = z.infer<typeof VatRegularisationBodySchema>

export interface VatRegularisationResult {
  status: 'created' | 'replaced' | 'unchanged' | 'validated' | 'nothing'
  reference: string
  entryId: string | null
  entryNumber: string | null
  lines: SettlementLine[]
  message: string
}

const ACCOUNTS = {
  vat: { code: '44566', label: 'TVA sur autres biens et services' },
  income: { code: '758', label: 'Indemnités et autres produits' },
  charge: { code: '658', label: 'Pénalités et autres charges' },
} as const

export async function prepareVatRegularisation(companyId: string, input: VatRegularisationBody, options: { now?: Date; source?: 'web' | 'mcp' } = {}): Promise<VatRegularisationResult> {
  const body = VatRegularisationBodySchema.parse(input)
  const view = await loadVatDeduction(companyId, { year: body.year }, { now: options.now })
  const reference = regularisationReference(body.year)
  const nothing = (message: string): VatRegularisationResult => ({ status: 'nothing', reference, entryId: null, entryNumber: null, lines: [], message })
  if (view.mode !== 'coefficient') return nothing('La société ne déduit pas sa TVA par coefficient : il n’y a pas de régularisation.')
  if (!view.yearClosed) throw new ConflictError(`L’année ${body.year} n’est pas terminée : le coefficient définitif se calcule sur le chiffre d’affaires de toute l’année.`)
  const amount = view.regularisation.amountCents
  if (amount === null) throw new ConflictError('Saisissez la TVA supportée dans l’année pour calculer la régularisation.')
  if (amount === 0) return nothing('Le coefficient définitif est égal au coefficient provisoire : aucune régularisation.')

  const date = view.regularisation.entryDate
  const at = new Date(`${date}T00:00:00.000Z`)
  const fiscalYear = await prisma.fiscalYear.findFirst({ where: { companyId, startDate: { lte: at }, endDate: { gte: at } }, select: { id: true } })
  if (!fiscalYear) throw new NotFoundError(`Aucun exercice ne contient le ${date.split('-').reverse().join('/')} : créez-le pour préparer l’écriture.`)

  const complement = amount > 0
  const cents = Math.abs(amount)
  const description = `Régularisation du coefficient de déduction de TVA ${body.year} (${view.provisional.deductionPercent} % provisoire, ${view.definitiveDeductionPercent} % définitif)`
  const plan: Planned = {
    fiscalYearId: fiscalYear.id,
    journal: { code: 'OD', label: 'Opérations diverses' },
    date,
    description: description.slice(0, 250),
    reference,
    lines: complement
      ? [
          { ...ACCOUNTS.vat, debitCents: cents, creditCents: 0 },
          { ...ACCOUNTS.income, debitCents: 0, creditCents: cents },
        ]
      : [
          { ...ACCOUNTS.charge, debitCents: cents, creditCents: 0 },
          { ...ACCOUNTS.vat, debitCents: 0, creditCents: cents },
        ],
  }
  plan.lines = await resolveCodes(companyId, plan.fiscalYearId, plan.lines, null)
  const result = await writeDraft(companyId, plan, 'vat-coefficient-regularisation')

  if (result.status === 'created' || result.status === 'replaced') {
    await writeAuditLog('info', `VAT coefficient regularisation draft prepared (${reference})`, {
      action: 'PREPARE_VAT_REGULARISATION',
      companyId,
      metadata: { year: body.year, amountCents: amount, reference, entryId: result.entryId, status: result.status, source: options.source ?? 'web' },
    })
  }
  const euros = formatCentsFr(cents)
  const line = view.regularisation.line ? `ligne ${view.regularisation.line.code} de la ${view.regularisation.form}` : 'la déclaration'
  const messages: Record<typeof result.status, string> = {
    created: `Régularisation préparée en brouillon (${result.entryNumber}, ${complement ? 'complément de déduction' : 'TVA à reverser'} de ${euros}, ${line}) : vérifiez-la, puis validez-la.`,
    replaced: `Le brouillon ne correspondait plus aux coefficients : il est remplacé (${result.entryNumber}, ${euros}).`,
    unchanged: `Le brouillon ${result.entryNumber} correspond déjà aux coefficients.`,
    validated: `L’écriture ${result.entryNumber} est déjà validée : pour la corriger, contre-passez-la puis préparez-la à nouveau.`,
  }
  return { ...result, lines: plan.lines, message: messages[result.status] }
}
