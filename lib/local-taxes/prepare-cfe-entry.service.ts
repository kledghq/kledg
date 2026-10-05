/**
 * Draft entries of the CFE (docs/impots-locaux.md), never validated: the
 * user checks each draft and validates it like any entry (PCG art. 1031-3).
 *
 * - acompte of 15 June or balance of 15 December of a year, debit of 63511
 *   "Contribution économique territoriale" (PCG, list of accounts) and
 *   credit of the bank (512, the company's default bank account), journal
 *   BQ, on the day the tracker says it was paid, else on its due date;
 * - or, counterpart "payable", credit of 447 "Autres impôts, taxes et
 *   versements assimilés", journal OD: the charge when the avis arrives,
 *   the bank reconciliation then settles 447.
 * Reference "CFE-2026-AC" or "CFE-2026-SOLDE", in the fiscal year that
 * contains the day (it must exist and be open).
 *
 * Idempotent through the draft writer of the corporate tax module, under an
 * advisory lock per company and reference and the lock of the fiscal year:
 * a draft with the same lines is kept, a stale one is replaced, a validated
 * entry is never touched, a zero amount creates nothing.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError } from '@/lib/accounting/errors'
import { writeAuditLog } from '@/lib/audit'
import { resolveCodes, writeDraft, type Planned } from '@/lib/corporate-tax/prepare-corporate-tax-entries.service'
import type { SettlementLine } from '@/lib/vat-returns/settlement'
import { formatCentsFr } from '@/lib/utils/money'
import { CFE_CHARGE_ACCOUNT } from './cfe'
import { cfeReference, loadLocalTaxes } from './load-local-taxes.service'

export const CfeEntryBodySchema = z.object({
  year: z.number({ error: 'L’année est requise' }).int('Année invalide').min(2010, 'Année invalide').max(2100, 'Année invalide'),
  kind: z.enum(['acompte', 'solde'], { error: 'Indiquez l’écriture à préparer : acompte ou solde' }),
  counterpart: z.enum(['bank', 'payable'], { error: 'Contrepartie inconnue' }).optional().default('bank'),
})
export type CfeEntryBody = z.input<typeof CfeEntryBodySchema>

export interface CfeEntryResult {
  status: 'created' | 'replaced' | 'unchanged' | 'validated' | 'nothing'
  reference: string
  entryId: string | null
  entryNumber: string | null
  lines: SettlementLine[]
  message: string
}

const ACCOUNTS = {
  bank: { code: '512', label: 'Banques' },
  payable: { code: '447', label: 'Autres impôts, taxes et versements assimilés' },
} as const

export async function prepareCfeEntry(companyId: string, input: CfeEntryBody, options: { now?: Date; source?: 'web' | 'mcp' } = {}): Promise<CfeEntryResult> {
  const body = CfeEntryBodySchema.parse(input)
  const view = await loadLocalTaxes(companyId, { year: body.year }, { now: options.now })
  const reference = cfeReference(body.year, body.kind)
  const nothing = (message: string): CfeEntryResult => ({ status: 'nothing', reference, entryId: null, entryNumber: null, lines: [], message })
  if (view.cfe.situation === 'creation-year') return nothing('Pas de CFE l’année de la création de la société (CGI, art. 1478, II) : il n’y a rien à comptabiliser.')

  const amount = body.kind === 'acompte' ? view.cfe.schedule.acompteCents : view.cfe.schedule.balanceCents
  if (amount === null) throw new ConflictError(`Saisissez l’avis d’imposition de la CFE ${body.year} pour préparer l’écriture du solde.`)
  if (amount <= 0) return nothing(body.kind === 'acompte' ? `Aucun acompte de CFE pour ${body.year} : il n’y a rien à comptabiliser.` : `Aucun solde de CFE à payer pour ${body.year}.`)

  const deadline = view.deadlines.find((d) => d.ruleId === (body.kind === 'acompte' ? 'cfe-acompte' : 'cfe'))
  const date = deadline?.status.paidOn ?? deadline?.date ?? `${body.year}-${body.kind === 'acompte' ? '06' : '12'}-15`
  const at = new Date(`${date}T00:00:00.000Z`)
  const fiscalYear = await prisma.fiscalYear.findFirst({ where: { companyId, startDate: { lte: at }, endDate: { gte: at } }, select: { id: true } })
  if (!fiscalYear) throw new NotFoundError(`Aucun exercice ne contient le ${date.split('-').reverse().join('/')} : créez-le pour préparer l’écriture.`)

  const counterpart = ACCOUNTS[body.counterpart]
  const description = `${body.kind === 'acompte' ? 'Acompte' : 'Solde'} de la cotisation foncière des entreprises ${body.year}`
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { defaultBankAccountCode: true } })
  const plan: Planned = {
    fiscalYearId: fiscalYear.id,
    journal: body.counterpart === 'bank' ? { code: 'BQ', label: 'Banque' } : { code: 'OD', label: 'Opérations diverses' },
    date,
    description,
    reference,
    lines: [
      { ...CFE_CHARGE_ACCOUNT, debitCents: amount, creditCents: 0 },
      { ...counterpart, debitCents: 0, creditCents: amount },
    ],
  }
  plan.lines = await resolveCodes(companyId, plan.fiscalYearId, plan.lines, body.counterpart === 'bank' ? (company?.defaultBankAccountCode ?? null) : null)
  const result = await writeDraft(companyId, plan, 'cfe-entry')

  if (result.status === 'created' || result.status === 'replaced') {
    await writeAuditLog('info', `CFE ${body.kind} draft prepared (${reference})`, {
      action: 'PREPARE_CFE_ENTRY',
      companyId,
      metadata: { year: body.year, kind: body.kind, counterpart: body.counterpart, reference, entryId: result.entryId, status: result.status, source: options.source ?? 'web' },
    })
  }
  const euros = formatCentsFr(amount)
  const messages: Record<typeof result.status, string> = {
    created: `Écriture préparée en brouillon (${result.entryNumber}, ${euros}) : vérifiez-la, puis validez-la.`,
    replaced: `Le brouillon ne correspondait plus à l’avis : il est remplacé (${result.entryNumber}, ${euros}).`,
    unchanged: `Le brouillon ${result.entryNumber} correspond déjà à l’avis.`,
    validated: `L’écriture ${result.entryNumber} est déjà validée : pour la corriger, contre-passez-la puis préparez-la à nouveau.`,
  }
  return { ...result, lines: plan.lines, message: messages[result.status] }
}
