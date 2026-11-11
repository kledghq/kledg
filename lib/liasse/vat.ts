/**
 * VAT of the year for the liasse fiscale (2033-D-SD cadre III, lines 374
 * and 378; 2058-C-SD, lines YY and YZ), on plain values (pure).
 *
 * Read in the validated entries of the year, opening entry, closing entry
 * and settlement entries left out (a settlement entry is one that touches
 * 4455 "Taxes sur le chiffre d'affaires à décaisser" or 44567 "Crédit de
 * TVA à reporter", PCG art. 944-44: it clears the period's VAT accounts,
 * lib/vat-returns/settlement.ts):
 * - collected: credits minus debits of 4457 "Taxes sur le chiffre
 *   d'affaires collectées", except 44574 (VAT on services not yet received,
 *   counted when it becomes due, on its transfer to 44571), so credit notes
 *   reduce it;
 * - deductible on goods and services: debits minus credits of 44566 "TVA
 *   sur autres biens et services" (44562, on fixed assets, is excluded by
 *   the form's wording).
 */

export interface VatTotals {
  collectedCents: number
  deductibleCents: number
  collectedAccounts: string[]
  deductibleAccounts: string[]
  note: string
}

export const VAT_COLLECTED_PREFIX = '4457'
export const VAT_PENDING_PREFIX = '44574'
export const VAT_DEDUCTIBLE_PREFIX = '44566'
/** An entry touching one of these accounts settles a VAT return. */
export const VAT_SETTLEMENT_PREFIXES = ['4455', '44567'] as const

export const VAT_NOTE =
  "Mouvements de l'exercice dans les écritures validées, hors à-nouveaux et hors écritures de liquidation des déclarations (comptes 4455 et 44567). La TVA collectée en attente d'encaissement (44574) compte quand elle devient exigible."

export interface VatLine {
  code: string
  debitCents: number
  creditCents: number
  /** The entry touches 4455 or 44567. */
  settlement: boolean
  opening: boolean
}

/** Collected and deductible VAT of the year from its lines. */
export function vatTotals(lines: readonly VatLine[]): VatTotals {
  let collectedCents = 0
  let deductibleCents = 0
  const collected = new Set<string>()
  const deductible = new Set<string>()
  for (const l of lines) {
    if (l.settlement || l.opening) continue
    if (l.code.startsWith(VAT_COLLECTED_PREFIX) && !l.code.startsWith(VAT_PENDING_PREFIX)) {
      collectedCents += l.creditCents - l.debitCents
      collected.add(l.code)
    } else if (l.code.startsWith(VAT_DEDUCTIBLE_PREFIX)) {
      deductibleCents += l.debitCents - l.creditCents
      deductible.add(l.code)
    }
  }
  return { collectedCents, deductibleCents, collectedAccounts: [...collected].sort(), deductibleAccounts: [...deductible].sort(), note: VAT_NOTE }
}
