/**
 * The VAT return of a period from the movements of the books
 * (classify.ts): each figure on its line of the CA3 or the CA12, with the
 * box code of the form. Pure, in cents; the forms take whole euros.
 *
 * Rounding (notices 3310-NOT-CA3-SD, cadre B, and 3517-S-NOT-SD, "Les
 * arrondis fiscaux"): every base and every tax is rounded to the nearest
 * euro, 0,50 € and more counting for one; totals add the rounded lines, as
 * the form adds them. The books keep cents: the settlement entry
 * (settlement.ts) books the rounding difference.
 *
 * CA3 (3310-CA3-SD):
 * - A1 taxed sales, A3 services bought from a supplier not established in
 *   France (art. 283-2), B2 intra-Community acquisitions, B5 regularisations
 *   (sales credit notes), E2 sales without VAT (to split with E1 and F2);
 * - 08 (20 %), 9B (10 %), 09 (5,5 %), T6 (2,1 %): base and tax of every
 *   taxed operation, sales and self-assessed purchases alike;
 * - 15 VAT previously deducted to pay back (supplier credit notes), 16 total
 *   gross VAT (08 to 5B), 17 of which on intra-Community acquisitions;
 * - 19 fixed assets, 20 other goods and services, 21 other VAT to deduct
 *   (VAT of sales credit notes, self-assessed VAT cancelled, 44563),
 *   22 credit carried from line 27 of the previous return, 23 total;
 * - 25 credit (23 - 16) or TD VAT due (16 - 23), 27 credit to carry
 *   (25 - 26), 28 net VAT due (TD - X5), 32 total to pay (28 + 29 + Z5).
 * CA12 (3517-S-SD):
 * - 03 sales without VAT (to split with 02 and 04), 5A (20 %), 6C (10 %),
 *   06 (5,5 %), 09 (other rate, 2,1 %), AC services of art. 283-2;
 * - 16 total tax due, 18 VAT previously deducted to pay back, 19 total
 *   gross VAT (16 + 17 + 18 + AD);
 * - 20 deductions on invoices, 22 (20 + 21), 23 fixed assets, 24 credit
 *   not used nor refunded (line 51 of the previous CA12), 25 complements
 *   of deductions, 26 total (22 + 23 + 24 + 25 + AE);
 * - 28 VAT due (19 - 26) or 29 credit (26 - 19), 30 acomptes paid,
 *   33 balance due (28 - 30) or 34 overpayment (30 - 28), 35 surplus
 *   (29 + 34), 56 total to pay, 57 base of next year's acomptes
 *   (16 - (11 + 12 + 22)): 55 % in July and 40 % in December, none when
 *   that VAT is under 1 000 € (CGI art. 287, 3; BOI-TVA-DECLA-20-20-30-10).
 */

import type { VatMovements, RateBucket } from './classify'
import { DECLARED_RATES_BP } from './classify'
import { CA12_LINES, CA3_LINES, RATE_LINES, type FormLineDef } from './forms'
import type { VatForm } from './periods'

export type LineStatus = 'computed' | 'manual' | 'total'

export interface VatReturnLine {
  code: string
  /** Box code of the form, null for a total the form computes. */
  box: string | null
  label: string
  columns: FormLineDef['columns']
  /** From the books, in cents (null for a column the line does not have). */
  baseCents: number | null
  amountCents: number | null
  /** What to type on the form, in whole euros. */
  base: number | null
  amount: number | null
  /** computed: from the books; manual: to fill by hand (Kledg cannot know it); total: computed from other lines. */
  status: LineStatus
  /** How the figure is computed, or what to fill. */
  hint: string
}

export interface VatReturnResult {
  kind: 'due' | 'credit' | 'nil'
  /** On the form, whole euros: CA3 line 28 or CA12 line 33; CA3 line 27 or CA12 line 35. */
  dueEuros: number
  creditEuros: number
  /** From the books, in cents, before rounding: positive due, negative credit. */
  booksNetCents: number
}

export interface CA12Acomptes {
  /** Acomptes paid during the year (44581): line 30. */
  paidCents: number
  /** Line 57: VAT of the year the next acomptes are computed on, whole euros. */
  nextBaseEuros: number
  /** No acompte when that VAT is under 1 000 € (BOI-TVA-DECLA-20-20-30-10). */
  nextDue: boolean
  /** 55 % in July and 40 % in December of the next year, whole euros. */
  nextJulyEuros: number
  nextDecemberEuros: number
}

export interface VatReturnComputation {
  form: VatForm
  lines: VatReturnLine[]
  result: VatReturnResult
  acomptes: CA12Acomptes | null
}

export interface ComputeInput {
  form: VatForm
  movements: VatMovements
  /** Debit balance of 44567 before the period: the credit carried forward (CA3 line 22, CA12 line 24). */
  creditCarriedCents: number
}

/** Cents to whole euros, half up (notices: "les fractions d'euro supérieures ou égales à 0,50 sont comptées pour 1"). */
export function roundEuros(cents: number): number {
  const sign = cents < 0 ? -1 : 1
  return (sign * Math.floor((Math.abs(cents) + 50) / 100)) || 0
}

/** Threshold under which no acompte of the réel simplifié is due, in euros (BOI-TVA-DECLA-20-20-30-10). */
export const ACOMPTE_THRESHOLD_EUROS = 1000

const sum = (values: number[]) => values.reduce((s, v) => s + v, 0)

function lineOf(def: FormLineDef, status: LineStatus, values: { baseCents?: number | null; amountCents?: number | null; base?: number | null; amount?: number | null }, hint: string): VatReturnLine {
  const baseCents = def.columns === 'amount' ? null : (values.baseCents ?? 0)
  const amountCents = def.columns === 'base' ? null : (values.amountCents ?? 0)
  return {
    code: def.code,
    box: def.box,
    label: def.label,
    columns: def.columns,
    baseCents,
    amountCents,
    base: baseCents === null ? null : (values.base ?? roundEuros(baseCents)),
    amount: amountCents === null ? null : (values.amount ?? roundEuros(amountCents)),
    status,
    hint,
  }
}

const manual = (def: FormLineDef, hint: string) => lineOf(def, 'manual', {}, hint)
const total = (def: FormLineDef, euros: number, cents: number, hint: string) => lineOf(def, 'total', { amountCents: cents, amount: euros }, hint)

function byRate(buckets: RateBucket[][]): Map<number, { baseCents: number; vatCents: number }> {
  const out = new Map<number, { baseCents: number; vatCents: number }>()
  for (const bucket of buckets.flat()) {
    const current = out.get(bucket.rateBp) ?? { baseCents: 0, vatCents: 0 }
    current.baseCents += bucket.baseCents
    current.vatCents += bucket.vatCents
    out.set(bucket.rateBp, current)
  }
  return out
}

/** Rates outside the declared lines (8,5 %, 13 %...): folded into the unidentified VAT, to declare by hand. */
function otherRates(rates: Map<number, { baseCents: number; vatCents: number }>) {
  const declared = new Set<number>(DECLARED_RATES_BP)
  const others = [...rates.entries()].filter(([rate]) => !declared.has(rate))
  return { baseCents: sum(others.map(([, v]) => v.baseCents)), vatCents: sum(others.map(([, v]) => v.vatCents)) }
}

const UNIDENTIFIED_DEF: FormLineDef = { code: '?', box: null, label: 'TVA dont le taux n’a pas pu être déterminé, à répartir sur les lignes de taux', columns: 'base-tax' }

/** The order of the rate lines on both forms: CA3 08, 09, 9B, T6; CA12 5A, 06, 6C, 09. */
const FORM_RATE_ORDER = [2000, 550, 1000, 210] as const

const rateLabel = (rate: number) => `${rate % 100 === 0 ? rate / 100 : String(rate / 100).replace('.', ',')} %`

function rateLines(form: VatForm, rates: Map<number, { baseCents: number; vatCents: number }>, unidentified: { baseCents: number; vatCents: number }): VatReturnLine[] {
  const lines = FORM_RATE_ORDER.map((rate) => {
    const values = rates.get(rate) ?? { baseCents: 0, vatCents: 0 }
    return lineOf(RATE_LINES[form][rate], 'computed', { baseCents: values.baseCents, amountCents: values.vatCents }, `Base et TVA au taux de ${rateLabel(rate)} : ventes (44571) et TVA autoliquidée (4452).`)
  })
  if (unidentified.vatCents !== 0 || unidentified.baseCents !== 0) {
    lines.push(lineOf(UNIDENTIFIED_DEF, 'manual', { baseCents: unidentified.baseCents, amountCents: unidentified.vatCents }, 'Écritures dont la TVA ne correspond à aucun taux unique : répartissez ces montants sur les lignes de taux. Ils sont compris dans le total de la TVA brute.'))
  }
  return lines
}

function computeCA3(input: ComputeInput): VatReturnComputation {
  const m = input.movements
  const L = CA3_LINES
  const rates = byRate([m.collected, m.autoliquidationGoods, m.autoliquidationServices])
  const other = otherRates(rates)
  const unidentified = { baseCents: sum(m.unidentified.map((u) => u.baseCents)) + other.baseCents, vatCents: sum(m.unidentified.map((u) => u.vatCents)) + other.vatCents }
  const rateRows = rateLines('CA3', rates, unidentified)

  const l15 = lineOf(L.L15, 'computed', { amountCents: m.deductibleReversalCents }, 'TVA déduite reversée : avoirs de fournisseurs (crédit net des comptes 44562, 44566 et 44563 sur une écriture).')
  const l5B = manual(L.L5B, 'Insuffisances de déclarations antérieures, acompte congés : à remplir à la main.')
  const grossEuros = sum(rateRows.map((r) => r.amount ?? 0)) + (l15.amount ?? 0)
  const grossCents = sum(rateRows.map((r) => r.amountCents ?? 0)) + m.deductibleReversalCents
  const l17Cents = sum(m.autoliquidationGoods.map((b) => b.vatCents))

  const l19 = lineOf(L.L19, 'computed', { amountCents: m.deductibleFixedAssetsCents }, 'TVA déductible sur immobilisations : débit net du compte 44562.')
  const l20 = lineOf(L.L20, 'computed', { amountCents: m.deductibleOtherCents }, 'TVA déductible sur autres biens et services : débit net du compte 44566, TVA autoliquidée comprise.')
  const l21Cents = m.salesCreditNotes.vatCents + m.autoliquidationReversalCents + m.transferredDeductibleCents + m.coefficientComplementCents
  const l21 = lineOf(L.L21, 'computed', { amountCents: l21Cents }, 'TVA des avoirs clients (débit net de 44571), TVA autoliquidée annulée (débit net de 4452), TVA transférée (44563) et complément de déduction de la régularisation du coefficient de déduction.')
  const l22 = lineOf(L.L22, 'computed', { amountCents: input.creditCarriedCents }, 'Crédit de TVA reporté : solde débiteur du compte 44567 au début de la période, à comparer avec la ligne 27 de la déclaration précédente.')
  const l2C = manual(L.L2C, 'Excédents de déclarations antérieures, acompte congés : à remplir à la main.')
  const deductibleEuros = sum([l19, l20, l21, l22].map((l) => l.amount ?? 0))
  const deductibleCents = m.deductibleFixedAssetsCents + m.deductibleOtherCents + l21Cents + input.creditCarriedCents

  const credit = Math.max(deductibleEuros - grossEuros, 0)
  const due = Math.max(grossEuros - deductibleEuros, 0)
  const lines: VatReturnLine[] = [
    lineOf(L.A1, 'computed', { baseCents: sum(m.collected.map((b) => b.baseCents)) }, 'Ventes et prestations taxées : base des ventes dont la TVA est au compte 44571 (exigible sur la période).'),
    manual(L.A2, 'Cessions d’immobilisations, livraisons à soi-même, autoliquidations du BTP : Kledg les compte en A1, déplacez-les ici.'),
    lineOf(L.A3, 'computed', { baseCents: sum(m.autoliquidationServices.map((b) => b.baseCents)) }, 'Services achetés à un prestataire non établi en France (TVA autoliquidée au compte 4452, contrepartie hors comptes 60 et 2).'),
    lineOf(L.B2, 'computed', { baseCents: sum(m.autoliquidationGoods.map((b) => b.baseCents)) }, 'Acquisitions intracommunautaires de biens (TVA autoliquidée au compte 4452, contrepartie en achats 60 ou immobilisations 2).'),
    manual(L.B4, 'Achats auprès d’un assujetti non établi en France (article 283-1) : à remplir à la main.'),
    lineOf(L.B5, 'computed', { baseCents: m.salesCreditNotes.baseCents }, 'Avoirs et rabais accordés aux clients : base des écritures qui diminuent le compte 44571.'),
    manual(L.E1, 'Exportations hors UE : à déplacer depuis E2.'),
    lineOf(L.E2, 'computed', { baseCents: m.nonTaxedSalesCents }, 'Ventes (comptes 70) sans TVA : à répartir entre E1, E2 et F2 selon leur nature.'),
    manual(L.F2, 'Livraisons intracommunautaires : à déplacer depuis E2.'),
    ...rateRows,
    l15,
    l5B,
    total(L.L16, grossEuros, grossCents, 'Somme des lignes 08 à 5B arrondies.'),
    lineOf(L.L17, 'computed', { amountCents: l17Cents }, 'TVA des acquisitions intracommunautaires déclarées ligne B2.'),
    l19,
    l20,
    l21,
    l22,
    l2C,
    total(L.L23, deductibleEuros, deductibleCents, 'Somme des lignes 19 à 2C arrondies.'),
    total(L.L25, credit, Math.max(deductibleCents - grossCents, 0), 'Ligne 23 moins ligne 16, quand elle est positive.'),
    total(L.TD, due, Math.max(grossCents - deductibleCents, 0), 'Ligne 16 moins ligne 23, quand elle est positive.'),
    manual(L.L26, 'Remboursement demandé sur le formulaire 3519 : à remplir à la main, il diminue la ligne 27.'),
    total(L.L27, credit, Math.max(deductibleCents - grossCents, 0), 'Ligne 25 moins ligne 26 : à reporter ligne 22 de la prochaine déclaration.'),
    total(L.L28, due, Math.max(grossCents - deductibleCents, 0), 'Ligne TD moins le crédit d’accise imputé (X5).'),
    manual(L.L29, 'Taxes assimilées de l’annexe 3310 A : à remplir à la main.'),
    total(L.L32, due, Math.max(grossCents - deductibleCents, 0), 'Lignes 28 + 29 + Z5 - AB.'),
  ]
  return {
    form: 'CA3',
    lines,
    result: { kind: due > 0 ? 'due' : credit > 0 ? 'credit' : 'nil', dueEuros: due, creditEuros: credit, booksNetCents: grossCents - deductibleCents },
    acomptes: null,
  }
}

function computeCA12(input: ComputeInput): VatReturnComputation {
  const m = input.movements
  const L = CA12_LINES
  const rates = byRate([m.collected, m.autoliquidationGoods])
  const other = otherRates(rates)
  const unidentified = { baseCents: sum(m.unidentified.map((u) => u.baseCents)) + other.baseCents, vatCents: sum(m.unidentified.map((u) => u.vatCents)) + other.vatCents }
  const rateRows = rateLines('CA12', rates, unidentified)
  const ac = lineOf(
    L.AC,
    'computed',
    { baseCents: sum(m.autoliquidationServices.map((b) => b.baseCents)), amountCents: sum(m.autoliquidationServices.map((b) => b.vatCents)) },
    'Services achetés à un prestataire non établi en France (TVA autoliquidée au compte 4452, contrepartie hors comptes 60 et 2).',
  )
  const taxEuros = sum(rateRows.map((r) => r.amount ?? 0)) + (ac.amount ?? 0)
  const taxCents = sum(rateRows.map((r) => r.amountCents ?? 0)) + (ac.amountCents ?? 0)
  const l18 = lineOf(L.L18, 'computed', { amountCents: m.deductibleReversalCents }, 'TVA déduite reversée : avoirs de fournisseurs (crédit net des comptes 44562, 44566 et 44563 sur une écriture).')
  const grossEuros = taxEuros + (l18.amount ?? 0)
  const grossCents = taxCents + m.deductibleReversalCents

  const l20 = lineOf(L.L20, 'computed', { amountCents: m.deductibleOtherCents }, 'TVA déductible sur autres biens et services : débit net du compte 44566, TVA autoliquidée comprise.')
  const l23 = lineOf(L.L23, 'computed', { amountCents: m.deductibleFixedAssetsCents }, 'TVA déductible sur immobilisations : débit net du compte 44562.')
  const l24 = lineOf(L.L24, 'computed', { amountCents: input.creditCarriedCents }, 'Crédit antérieur : solde débiteur du compte 44567 au début de l’année, à comparer avec la ligne 51 de la CA12 précédente.')
  const l25Cents = m.salesCreditNotes.vatCents + m.autoliquidationReversalCents + m.transferredDeductibleCents + m.coefficientComplementCents
  const l25 = lineOf(L.L25, 'computed', { amountCents: l25Cents }, 'TVA des avoirs clients (débit net de 44571), TVA autoliquidée annulée (débit net de 4452), TVA transférée (44563) et complément de déduction de la régularisation du coefficient de déduction.')
  const deductibleEuros = (l20.amount ?? 0) + (l23.amount ?? 0) + (l24.amount ?? 0) + (l25.amount ?? 0)
  const deductibleCents = m.deductibleOtherCents + m.deductibleFixedAssetsCents + input.creditCarriedCents + l25Cents

  const l28 = Math.max(grossEuros - deductibleEuros, 0)
  const l29 = Math.max(deductibleEuros - grossEuros, 0)
  const l30Line = lineOf(L.L30, 'computed', { amountCents: Math.max(m.acomptesPaidCents, 0) }, 'Acomptes de juillet et de décembre payés : débit net du compte 44581 sur l’année. Ajoutez les acomptes restant dus (colonne 2).')
  const l30 = l30Line.amount ?? 0
  const l33 = l28 > 0 && l28 - l30 >= 0 ? l28 - l30 : 0
  const l34 = l30 - l28 >= 0 ? l30 - l28 : 0
  const l35 = l29 + l34
  const l57 = Math.max(taxEuros - (l20.amount ?? 0), 0)
  const nextDue = l57 >= ACOMPTE_THRESHOLD_EUROS
  const booksNetCents = grossCents - deductibleCents - Math.max(m.acomptesPaidCents, 0)

  const lines: VatReturnLine[] = [
    manual(L.L02, 'Exportations hors UE : à déplacer depuis la ligne 03.'),
    lineOf(L.L03, 'computed', { baseCents: m.nonTaxedSalesCents }, 'Ventes (comptes 70) sans TVA : à répartir entre les lignes 02, 03 et 04 selon leur nature.'),
    manual(L.L04, 'Livraisons intracommunautaires : à déplacer depuis la ligne 03.'),
    ...rateRows,
    ac,
    manual(L.L11, 'Cessions d’immobilisations : Kledg les compte avec les ventes, déplacez-les ici.'),
    manual(L.L12, 'Livraisons à soi-même : à remplir à la main.'),
    total(L.L16, taxEuros, taxCents, 'Somme des lignes 5A à 13 arrondies.'),
    manual(L.L17, 'Remboursements provisionnels obtenus dans l’année : à remplir à la main.'),
    l18,
    manual(L.AD, 'Insuffisances de déclaration constatées : à remplir à la main.'),
    total(L.L19, grossEuros, grossCents, 'Lignes 16 + 17 + 18 + AD.'),
    l20,
    manual(L.L21, 'Déduction forfaitaire des frais généraux, sur option : à remplir à la main.'),
    total(L.L22, l20.amount ?? 0, m.deductibleOtherCents, 'Lignes 20 + 21.'),
    l23,
    l24,
    l25,
    manual(L.AE, 'Crédit imputé sur les acomptes, excédents constatés : à remplir à la main.'),
    total(L.L26, deductibleEuros, deductibleCents, 'Lignes 22 + 23 + 24 + 25 + AE.'),
    total(L.L28, l28, Math.max(grossCents - deductibleCents, 0), 'Ligne 19 moins ligne 26, quand elle est positive.'),
    total(L.L29, l29, Math.max(deductibleCents - grossCents, 0), 'Ligne 26 moins ligne 19, quand elle est positive.'),
    l30Line,
    total(L.L33, l33, Math.max(booksNetCents, 0), 'Ligne 28 moins les acomptes de la ligne 30, quand elle est positive.'),
    total(L.L34, l34, Math.max(m.acomptesPaidCents - Math.max(grossCents - deductibleCents, 0), 0), 'Acomptes de la ligne 30 moins la ligne 28, quand elle est positive.'),
    total(L.L35, l35, Math.max(-booksNetCents, 0), 'Lignes 29 + 34 : crédit à reporter ligne 24 de la prochaine CA12 ou à imputer sur le prochain acompte.'),
    manual(L.L55, 'Taxes assimilées (lignes 36 à 94) : à remplir à la main.'),
    total(L.L56, l33, Math.max(booksNetCents, 0), 'Lignes 54 + 55 + Z5 : la TVA nette due, plus les taxes assimilées.'),
    total(L.L57, l57, Math.max(taxCents - m.deductibleOtherCents, 0), 'Ligne 16 moins les lignes 11, 12 et 22 : 55 % en juillet et 40 % en décembre de l’année suivante.'),
  ]
  return {
    form: 'CA12',
    lines,
    result: { kind: l33 > 0 ? 'due' : l35 > 0 ? 'credit' : 'nil', dueEuros: l33, creditEuros: l35, booksNetCents },
    acomptes: {
      paidCents: Math.max(m.acomptesPaidCents, 0),
      nextBaseEuros: l57,
      nextDue,
      nextJulyEuros: nextDue ? Math.floor((l57 * 55 + 50) / 100) : 0,
      nextDecemberEuros: nextDue ? Math.floor((l57 * 40 + 50) / 100) : 0,
    },
  }
}

export function computeVatReturn(input: ComputeInput): VatReturnComputation {
  return input.form === 'CA3' ? computeCA3(input) : computeCA12(input)
}
