/**
 * The value added of the CVAE (CGI art. 1586 sexies, I, general regime)
 * read from the soldes intermédiaires de gestion of the books
 * (lib/reports/financial-indicators/sig.ts). Pure, amounts in cents.
 *
 * The SIG value added (marge commerciale + production - consommations en
 * provenance des tiers) is close to the tax one but not equal. Kledg adds
 * what the article lists and the books show with certainty:
 * - plus the subventions d'exploitation (74), the other operating products
 *   (75 except the quotes-parts of 755) and the transferts de charges
 *   d'exploitation (791), which art. 1586 sexies, I, 1 and 3 count;
 * - minus the other operating charges (65 except 655), deductible under
 *   art. 1586 sexies, I, 4, c.
 * Everything else is a manual adjustment, with a label and a signed amount:
 * rents of goods taken for more than six months or in crédit-bail (not
 * deductible, art. 1586 sexies, I, 4, b), the capitalized production valued
 * beyond its deductible charges, disposals of fixed assets within the
 * ordinary activity, the specific regimes (banks, holdings, real estate).
 * Taxes (63) are not deducted (only some taxes on turnover are), which is
 * the cautious reading: the value added is never understated.
 */

import type { AccountTotals } from '@/lib/reports/statements/allocation'
import { computeSig, sigTotals } from '@/lib/reports/financial-indicators/sig'

export interface ValueAddedFromBooks {
  /** Comptes 70, credit minus debit. */
  turnoverCents: number
  /** Valeur ajoutée of the SIG. */
  sigValueAddedCents: number
  subsidiesCents: number
  otherProductsCents: number
  chargeTransfersCents: number
  otherChargesCents: number
  /** SIG value added + 74 + 75 + 791 - 65. */
  valueAddedCents: number
}

export function valueAddedFromBooks(accounts: readonly AccountTotals[]): ValueAddedFromBooks {
  const sig = computeSig(accounts)
  const t = sigTotals(accounts)
  const valueAddedCents = sig.valeurAjouteeCents + t.subventionsExploitation + t.autresProduits + t.transfertsExploitation - t.autresCharges
  return {
    turnoverCents: sig.chiffreAffairesCents,
    sigValueAddedCents: sig.valeurAjouteeCents,
    subsidiesCents: t.subventionsExploitation,
    otherProductsCents: t.autresProduits,
    chargeTransfersCents: t.transfertsExploitation,
    otherChargesCents: t.autresCharges,
    valueAddedCents,
  }
}

/** Sums the parts of several fiscal years closed in one calendar year. */
export function sumValueAdded(parts: readonly ValueAddedFromBooks[]): ValueAddedFromBooks {
  const zero: ValueAddedFromBooks = { turnoverCents: 0, sigValueAddedCents: 0, subsidiesCents: 0, otherProductsCents: 0, chargeTransfersCents: 0, otherChargesCents: 0, valueAddedCents: 0 }
  return parts.reduce(
    (sum, p) => ({
      turnoverCents: sum.turnoverCents + p.turnoverCents,
      sigValueAddedCents: sum.sigValueAddedCents + p.sigValueAddedCents,
      subsidiesCents: sum.subsidiesCents + p.subsidiesCents,
      otherProductsCents: sum.otherProductsCents + p.otherProductsCents,
      chargeTransfersCents: sum.chargeTransfersCents + p.chargeTransfersCents,
      otherChargesCents: sum.otherChargesCents + p.otherChargesCents,
      valueAddedCents: sum.valueAddedCents + p.valueAddedCents,
    }),
    zero,
  )
}
