/**
 * Consistency checks shown with a VAT return: what makes the figures
 * incomplete (blocking) and what deserves a look (warning). Pure: the
 * loader gathers the counts and balances, the tests feed plain values.
 *
 * Blocking, the return would be wrong or incomplete:
 * - draft entries dated in the period: only validated entries are
 *   declared (validation makes an entry definitive, PCG art. 1031-3);
 * - bank lines of the period not reconciled: their entries are probably
 *   missing (the VAT of a sale or a purchase is not in the books yet);
 * - VAT whose rate could not be read, and movements on VAT accounts the
 *   return does not read.
 * Warnings:
 * - the VAT accounts do not end the period at the amounts declared: an
 *   earlier return was not settled in the books (no settlement entry);
 * - the payment booked on 4455 differs from the amount of the previous
 *   return, or 4455 is not cleared once its deadline passed;
 * - the credit carried forward (44567) differs from the credit recorded on
 *   the previous return (CA3 line 22 must repeat line 27 of the previous
 *   return, CA12 line 24 line 51 of the previous CA12).
 */

import { formatCentsFr } from '@/lib/utils/money'
import type { UnhandledAccount, UnidentifiedEntry } from './classify'

export type CheckSeverity = 'blocking' | 'warning' | 'info' | 'ok'

export interface VatCheck {
  id: 'drafts' | 'bank' | 'rates' | 'accounts' | 'balances' | 'to-pay' | 'credit' | 'pending'
  severity: CheckSeverity
  title: string
  detail: string
  /** Page of the company that fixes it, relative to the company ("entries?status=draft"). */
  link?: { label: string; page: string }
  /** Details: entries, accounts, balances. */
  items?: string[]
}

export interface BalanceRow {
  /** collected, autoliquidation, deductibleFixedAssets, deductibleOther. */
  group: string
  label: string
  /** Balance of the accounts at the end of the period without this period's settlement: credit for collected and 4452, debit for deductible. */
  balanceCents: number
  /** What the return takes from the period. */
  declaredCents: number
}

export interface CheckInput {
  drafts: { count: number; numbers: string[] }
  unreconciled: { count: number; totalCents: number }
  unidentified: UnidentifiedEntry[]
  unhandled: UnhandledAccount[]
  balances: BalanceRow[]
  toPay: {
    /** Credit balance of 4455 at the start of the period. */
    openingCents: number
    /** Debits of 4455 during the period (payments), settlement of this period left out. */
    paidCents: number
    /** Amount due on the previous return as recorded when it was filed, null when not recorded. */
    previousDueCents: number | null
    /** The previous return's deadline is past (its payment should be booked). */
    previousDeadlinePassed: boolean
  }
  credit: { carriedCents: number; previousCreditCents: number | null }
  pendingCollectedCents: number
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`
const euros = (cents: number) => `${formatCentsFr(cents)} €`

export function vatChecks(input: CheckInput): VatCheck[] {
  const checks: VatCheck[] = []

  checks.push(
    input.drafts.count > 0
      ? {
          id: 'drafts',
          severity: 'blocking',
          title: `${plural(input.drafts.count, 'écriture', 'écritures')} en brouillon sur la période`,
          detail: 'Seules les écritures validées sont déclarées. Validez ou supprimez les brouillons de la période, puis revenez à la déclaration.',
          link: { label: 'Voir les brouillons', page: 'entries?statut=brouillon' },
          items: input.drafts.numbers,
        }
      : { id: 'drafts', severity: 'ok', title: 'Aucune écriture en brouillon sur la période', detail: 'Toutes les écritures de la période sont validées.' },
  )

  checks.push(
    input.unreconciled.count > 0
      ? {
          id: 'bank',
          severity: 'blocking',
          title: `${plural(input.unreconciled.count, 'opération bancaire', 'opérations bancaires')} non ${input.unreconciled.count > 1 ? 'rapprochées' : 'rapprochée'} sur la période`,
          detail: `Pour ${euros(input.unreconciled.totalCents)} : leurs écritures manquent peut-être, et avec elles leur TVA. Rapprochez-les avant de déclarer.`,
          link: { label: 'Rapprocher', page: 'reconciliation' },
        }
      : { id: 'bank', severity: 'ok', title: 'Opérations bancaires de la période rapprochées', detail: 'Chaque opération bancaire de la période a son écriture.' },
  )

  if (input.unidentified.length > 0) {
    checks.push({
      id: 'rates',
      severity: 'blocking',
      title: `Taux de TVA à déterminer sur ${plural(input.unidentified.length, 'écriture', 'écritures')}`,
      detail: `La TVA de ${input.unidentified.length > 1 ? 'ces écritures' : 'cette écriture'} ne correspond à aucun taux unique (plusieurs taux sans facture, ou une base hors des comptes 6, 7 et 2). Elle est comprise dans le total ; répartissez-la à la main sur les lignes de taux.`,
      items: input.unidentified.map((u) => `N° ${u.number} du ${u.date.slice(8, 10)}/${u.date.slice(5, 7)}/${u.date.slice(0, 4)} : TVA ${euros(u.vatCents)}, base ${euros(u.baseCents)}`),
    })
  }

  if (input.unhandled.length > 0) {
    checks.push({
      id: 'accounts',
      severity: 'blocking',
      title: 'Mouvements sur des comptes de TVA que Kledg ne déclare pas',
      detail: 'Taxes assimilées, remboursements demandés, TVA récupérée d’avance ou compte de TVA général : Kledg ne sait pas sur quelle ligne les porter. Vérifiez ces écritures et complétez la déclaration à la main.',
      items: input.unhandled.map((u) => `Compte ${u.code} : ${u.netCents >= 0 ? 'débit' : 'crédit'} net de ${euros(Math.abs(u.netCents))}`),
    })
  }

  const unbalanced = input.balances.filter((b) => b.balanceCents !== b.declaredCents)
  checks.push(
    unbalanced.length > 0
      ? {
          id: 'balances',
          severity: 'warning',
          title: 'Comptes de TVA non soldés par les déclarations précédentes',
          detail:
            'À la fin de la période, les comptes de TVA devraient porter exactement les montants de cette déclaration. Un écart vient en général d’une déclaration précédente non passée en écriture, ou d’une écriture de TVA hors période : préparez les écritures de liquidation des périodes précédentes.',
          items: unbalanced.map((b) => `${b.label} : solde ${euros(b.balanceCents)}, déclaré ${euros(b.declaredCents)}, écart ${euros(b.balanceCents - b.declaredCents)}`),
        }
      : { id: 'balances', severity: 'ok', title: 'Comptes de TVA cohérents avec la déclaration', detail: 'Les soldes des comptes de TVA à la fin de la période correspondent aux montants déclarés.' },
  )

  const { toPay } = input
  const endCents = toPay.openingCents - toPay.paidCents
  const paymentMismatch = toPay.previousDueCents !== null && toPay.previousDeadlinePassed && toPay.paidCents !== toPay.previousDueCents
  const notCleared = toPay.previousDeadlinePassed && endCents !== 0
  if (paymentMismatch || notCleared) {
    const items = [`Solde du compte 4455 au début de la période : ${euros(toPay.openingCents)}`, `Paiements de la période : ${euros(toPay.paidCents)}`]
    if (toPay.previousDueCents !== null) items.push(`Montant de la déclaration précédente : ${euros(toPay.previousDueCents)}`)
    checks.push({
      id: 'to-pay',
      severity: 'warning',
      title: 'Le compte 4455 ne correspond pas au paiement de la déclaration précédente',
      detail: 'Après son échéance, le paiement de la déclaration précédente solde le compte 4455. Vérifiez l’écriture de liquidation précédente et l’écriture de paiement.',
      items,
    })
  } else if (toPay.previousDeadlinePassed && (toPay.openingCents !== 0 || toPay.paidCents !== 0)) {
    checks.push({ id: 'to-pay', severity: 'ok', title: 'Paiement de la déclaration précédente comptabilisé', detail: `Le compte 4455 est soldé par un paiement de ${euros(toPay.paidCents)}.` })
  }

  if (input.credit.previousCreditCents !== null && input.credit.previousCreditCents !== input.credit.carriedCents) {
    checks.push({
      id: 'credit',
      severity: 'warning',
      title: 'Le crédit reporté diffère de la déclaration précédente',
      detail: 'Le crédit à reporter doit reprendre celui de la déclaration précédente (ligne 27 de la CA3, ligne 51 de la CA12). Kledg lit le solde du compte 44567 au début de la période.',
      items: [`Solde du compte 44567 : ${euros(input.credit.carriedCents)}`, `Crédit de la déclaration précédente : ${euros(input.credit.previousCreditCents)}`],
    })
  }

  if (input.pendingCollectedCents > 0) {
    checks.push({
      id: 'pending',
      severity: 'info',
      title: 'TVA en attente d’encaissement',
      detail: `${euros(input.pendingCollectedCents)} de TVA sur des prestations de services attendent leur paiement (compte 44574) : elle sera déclarée sur la période où les clients paieront (CGI art. 269, 2, c).`,
    })
  }
  return checks
}

/** The figures can be declared as computed: no blocking check. */
export function isReliable(checks: VatCheck[]): boolean {
  return checks.every((c) => c.severity !== 'blocking')
}
