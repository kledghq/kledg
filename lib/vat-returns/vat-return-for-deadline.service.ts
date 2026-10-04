/**
 * The amount of the VAT return a deadline of the calendar asks for, for
 * the simple home's "TVA à payer" (docs/mode-simple.md): the return of the
 * deadline's period computed like the worksheet (buildVatReturn), only
 * when its checks pass (no draft, every bank line reconciled, every rate
 * identified). Otherwise null, and the home keeps its estimate from the
 * balances of the comptes 445.
 *
 * An acompte of the réel simplifié (July, December) is the share of line 57
 * of the previous year's CA12: 55 % in July, 40 % in December (CGI art.
 * 287, 3; BOI-TVA-DECLA-20-20-30-10).
 */

import { ValidationError } from '@/lib/accounting/errors'
import { buildVatReturn } from './load-vat-return.service'
import { periodKeyOfDeadline } from './period-keys'

export interface VatAmountForDeadline {
  /** Positive: to pay; negative: a credit. */
  amountCents: number
  /** "septembre 2026", "année 2025". */
  periodLabel: string
}

export async function vatReturnForDeadline(companyId: string, deadline: { id: string; ruleId: string }, now?: Date): Promise<VatAmountForDeadline | null> {
  const key = periodKeyOfDeadline(deadline)
  if (!key) return null
  let built
  try {
    built = await buildVatReturn(companyId, key, now)
  } catch (error) {
    // A period outside the company's returns (a first year without a previous CA12): no figure.
    if (error instanceof ValidationError) return null
    throw error
  }
  const { view } = built
  const computation = view.computation
  if (view.status !== 'ready' || !computation || !view.reliable || !view.period) return null
  if (deadline.ruleId === 'tva-acompte') {
    const acomptes = computation.acomptes
    if (!acomptes) return null
    const july = deadline.id.endsWith('-07')
    return { amountCents: (july ? acomptes.nextJulyEuros : acomptes.nextDecemberEuros) * 100, periodLabel: view.period.label }
  }
  const result = computation.result
  return { amountCents: result.kind === 'credit' ? -result.creditEuros * 100 : result.dueEuros * 100, periodLabel: view.period.label }
}
