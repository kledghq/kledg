/**
 * Soldes intermédiaires de gestion (SIG) and capacité d'autofinancement
 * (CAF) of a fiscal year, from the totals of its class 6 and 7 accounts.
 * Pure: no database access, amounts in integer cents.
 *
 * Sources:
 * - The cascade of balances is the "tableau des soldes intermédiaires de
 *   gestion" of the PCG (système développé of the PCG 1982, taken up by the
 *   Ordre des experts-comptables), with the account numbers of the PCG in
 *   force (règlement ANC 2014-03 as amended by règlement ANC 2022-06, the
 *   "PCG 2026" of lib/accounting/pcg-data.ts). Under that règlement the
 *   disposals of intangible and tangible assets moved from 675/775 to the
 *   operating accounts 657/757, the quote-part of investment subsidies from
 *   777 to 747, and class 67/77 keeps only the exceptional items (672/678,
 *   772/778); the old accounts are still recognised for older charts.
 * - Each line names the lines of the official forms it matches: cerfa
 *   2052-SD and 2053-SD (compte de résultat, régime réel normal) and 2033-B-SD
 *   (régime simplifié).
 *
 * Every class 6 and 7 account falls in exactly one bucket (longest prefix
 * wins, unknown codes of class 6 or 7 go to the other charges or products),
 * so the cascade ends on the result of the income statement: produits minus
 * charges (PCG art. 821-1; checked by the tests against
 * lib/reports/statements/income-statement.ts).
 *
 * The closing entries of the year (journal CL) must be excluded from the
 * totals: they bring classes 6 and 7 to zero.
 */

import type { AccountTotals } from '@/lib/reports/statements/allocation'

/** Where an account of class 6 or 7 goes in the cascade. */
export type SigBucket =
  | 'ventesMarchandises'
  | 'coutMarchandises'
  | 'productionVendue'
  | 'productionStockee'
  | 'productionImmobilisee'
  | 'consommationsTiers'
  | 'subventionsExploitation'
  | 'impotsTaxes'
  | 'chargesPersonnel'
  | 'reprisesExploitation'
  | 'transfertsExploitation'
  | 'autresProduits'
  | 'produitsCessionsExploitation'
  | 'quotePartSubventionsInvestissement'
  | 'dotationsExploitation'
  | 'autresCharges'
  | 'valeurComptableCessionsExploitation'
  | 'quotePartBeneficeCommun'
  | 'quotePartPerteCommune'
  | 'produitsFinanciers'
  | 'produitsCessionsFinancieres'
  | 'reprisesFinancieres'
  | 'transfertsFinanciers'
  | 'chargesFinancieres'
  | 'valeurComptableCessionsFinancieres'
  | 'dotationsFinancieres'
  | 'produitsExceptionnels'
  | 'produitsCessionsExceptionnels'
  | 'quotePartSubventionsExceptionnelle'
  | 'reprisesExceptionnelles'
  | 'transfertsExceptionnels'
  | 'chargesExceptionnelles'
  | 'valeurComptableCessionsExceptionnelles'
  | 'dotationsExceptionnelles'
  | 'participationSalaries'
  | 'impotsBenefices'

/**
 * Account prefixes of each bucket (PCG, list of accounts). Charges are read
 * debit minus credit, products credit minus debit, so the rebates obtained
 * (609, 619, 629) and granted (709) reduce their bucket.
 */
const PREFIXES: Array<[prefix: string, bucket: SigBucket]> = [
  // Class 7
  ['707', 'ventesMarchandises'], // Ventes de marchandises
  ['7097', 'ventesMarchandises'], // RRR accordés sur ventes de marchandises
  ['70', 'productionVendue'], // Ventes de produits, travaux, études, prestations, activités annexes
  ['73', 'productionVendue'], // Produits nets partiels sur opérations à long terme (older charts)
  ['71', 'productionStockee'], // 713 Variation des stocks (en-cours de production, produits)
  ['72', 'productionImmobilisee'], // Production immobilisée
  ['74', 'subventionsExploitation'], // 741 Subventions d'exploitation, 742 d'équilibre
  ['747', 'quotePartSubventionsInvestissement'], // Quote-part des subventions d'investissement virée au résultat
  ['75', 'autresProduits'], // Autres produits de gestion courante
  ['755', 'quotePartBeneficeCommun'], // Quotes-parts de résultat sur opérations faites en commun
  ['757', 'produitsCessionsExploitation'], // Produits des cessions d'immobilisations incorporelles et corporelles
  ['76', 'produitsFinanciers'],
  ['7671', 'produitsCessionsFinancieres'], // Produits des cessions d'immobilisations financières
  ['77', 'produitsExceptionnels'],
  ['775', 'produitsCessionsExceptionnels'], // Produits des cessions d'éléments d'actif (before ANC 2022-06)
  ['777', 'quotePartSubventionsExceptionnelle'], // Quote-part des subventions d'investissement (before ANC 2022-06)
  ['78', 'reprisesExploitation'], // 781 Reprises (produits d'exploitation)
  ['786', 'reprisesFinancieres'],
  ['787', 'reprisesExceptionnelles'],
  ['79', 'transfertsExploitation'], // 791 Transferts de charges d'exploitation
  ['796', 'transfertsFinanciers'],
  ['797', 'transfertsExceptionnels'],
  // Class 6
  ['607', 'coutMarchandises'], // Achats de marchandises
  ['6087', 'coutMarchandises'], // Frais accessoires d'achat de marchandises
  ['6097', 'coutMarchandises'], // RRR obtenus sur achats de marchandises
  ['6037', 'coutMarchandises'], // Variation des stocks de marchandises
  ['60', 'consommationsTiers'], // Achats d'approvisionnements, variation de leurs stocks, achats non stockés
  ['61', 'consommationsTiers'], // Services extérieurs
  ['62', 'consommationsTiers'], // Autres services extérieurs
  ['63', 'impotsTaxes'], // Impôts, taxes et versements assimilés
  ['64', 'chargesPersonnel'], // Charges de personnel
  ['65', 'autresCharges'], // Autres charges de gestion courante
  ['655', 'quotePartPerteCommune'],
  ['657', 'valeurComptableCessionsExploitation'], // Valeurs comptables des immobilisations incorporelles et corporelles cédées
  ['66', 'chargesFinancieres'],
  ['6671', 'valeurComptableCessionsFinancieres'], // Valeurs comptables des immobilisations financières cédées
  ['67', 'chargesExceptionnelles'],
  ['675', 'valeurComptableCessionsExceptionnelles'], // Valeurs comptables des éléments d'actif cédés (before ANC 2022-06)
  ['68', 'dotationsExploitation'], // 681 Dotations (charges d'exploitation)
  ['686', 'dotationsFinancieres'],
  ['687', 'dotationsExceptionnelles'],
  ['691', 'participationSalaries'],
  ['69', 'impotsBenefices'], // 695 Impôts sur les bénéfices, 696, 698 intégration fiscale, 699
]

const PRODUCT_BUCKETS = new Set<SigBucket>([
  'ventesMarchandises',
  'productionVendue',
  'productionStockee',
  'productionImmobilisee',
  'subventionsExploitation',
  'reprisesExploitation',
  'transfertsExploitation',
  'autresProduits',
  'produitsCessionsExploitation',
  'quotePartSubventionsInvestissement',
  'quotePartBeneficeCommun',
  'produitsFinanciers',
  'produitsCessionsFinancieres',
  'reprisesFinancieres',
  'transfertsFinanciers',
  'produitsExceptionnels',
  'produitsCessionsExceptionnels',
  'quotePartSubventionsExceptionnelle',
  'reprisesExceptionnelles',
  'transfertsExceptionnels',
])

/** The bucket of an account of class 6 or 7, null for other classes. */
export function sigBucketOf(code: string): SigBucket | null {
  const cls = code.charAt(0)
  if (cls !== '6' && cls !== '7') return null
  let best: SigBucket | null = null
  let length = 0
  for (const [prefix, bucket] of PREFIXES) {
    if (prefix.length > length && code.startsWith(prefix)) {
      best = bucket
      length = prefix.length
    }
  }
  // An account outside the PCG list (a bare "6" or "7"): other charges or products, still in the result.
  return best ?? (cls === '6' ? 'autresCharges' : 'autresProduits')
}

export type SigTotals = Record<SigBucket, number>

/** Signed totals per bucket: products credit minus debit, charges debit minus credit. */
export function sigTotals(accounts: readonly AccountTotals[]): SigTotals {
  const totals = Object.fromEntries(PREFIXES.map(([, bucket]) => [bucket, 0])) as SigTotals
  for (const a of accounts) {
    const bucket = sigBucketOf(a.code)
    if (!bucket) continue
    totals[bucket] += PRODUCT_BUCKETS.has(bucket) ? a.creditCents - a.debitCents : a.debitCents - a.creditCents
  }
  return totals
}

export interface Sig {
  /** Comptes 70, credit minus debit: chiffre d'affaires net (2052 FL, 2033-B 210 + 214 + 218). */
  chiffreAffairesCents: number
  ventesMarchandisesCents: number
  coutMarchandisesCents: number
  margeCommercialeCents: number
  /** False when the year has no merchandise sale nor purchase: the commercial margin is then not relevant. */
  hasMarchandises: boolean
  productionVendueCents: number
  productionStockeeCents: number
  productionImmobiliseeCents: number
  productionExerciceCents: number
  consommationsTiersCents: number
  valeurAjouteeCents: number
  subventionsExploitationCents: number
  impotsTaxesCents: number
  chargesPersonnelCents: number
  /** Excédent (positive) or insuffisance (negative) brut d'exploitation. */
  ebeCents: number
  reprisesTransfertsCents: number
  autresProduitsCents: number
  dotationsExploitationCents: number
  autresChargesCents: number
  resultatExploitationCents: number
  quotesPartsCommunesCents: number
  produitsFinanciersCents: number
  chargesFinancieresCents: number
  resultatCourantCents: number
  produitsExceptionnelsCents: number
  chargesExceptionnellesCents: number
  resultatExceptionnelCents: number
  participationCents: number
  impotsBeneficesCents: number
  resultatExerciceCents: number
  /** Disposal proceeds of assets (757, 7671, old 775). */
  produitsCessionsCents: number
  /** Book value of the assets disposed of (657, 6671, old 675). */
  valeurComptableCessionsCents: number
  /** Plus-values (positive) or moins-values (negative) de cession: proceeds minus book value. */
  plusValuesCessionCents: number
}

export function computeSig(accounts: readonly AccountTotals[]): Sig {
  const t = sigTotals(accounts)
  const hasMarchandises = accounts.some(
    (a) => (sigBucketOf(a.code) === 'ventesMarchandises' || sigBucketOf(a.code) === 'coutMarchandises') && (a.debitCents !== 0 || a.creditCents !== 0),
  )

  const margeCommercialeCents = t.ventesMarchandises - t.coutMarchandises
  const productionExerciceCents = t.productionVendue + t.productionStockee + t.productionImmobilisee
  const valeurAjouteeCents = margeCommercialeCents + productionExerciceCents - t.consommationsTiers
  const ebeCents = valeurAjouteeCents + t.subventionsExploitation - t.impotsTaxes - t.chargesPersonnel

  const reprisesTransfertsCents = t.reprisesExploitation + t.transfertsExploitation
  // Other operating products: 75 (without the joint operations of 755), the
  // disposal proceeds now in 757 and the investment subsidies released (747):
  // calculated or non recurring, they stay out of the EBE.
  const autresProduitsCents = t.autresProduits + t.produitsCessionsExploitation + t.quotePartSubventionsInvestissement
  const autresChargesCents = t.autresCharges + t.valeurComptableCessionsExploitation
  const resultatExploitationCents =
    ebeCents + reprisesTransfertsCents + autresProduitsCents - t.dotationsExploitation - autresChargesCents

  const quotesPartsCommunesCents = t.quotePartBeneficeCommun - t.quotePartPerteCommune
  const produitsFinanciersCents = t.produitsFinanciers + t.produitsCessionsFinancieres + t.reprisesFinancieres + t.transfertsFinanciers
  const chargesFinancieresCents = t.chargesFinancieres + t.valeurComptableCessionsFinancieres + t.dotationsFinancieres
  const resultatCourantCents = resultatExploitationCents + quotesPartsCommunesCents + produitsFinanciersCents - chargesFinancieresCents

  const produitsExceptionnelsCents =
    t.produitsExceptionnels +
    t.produitsCessionsExceptionnels +
    t.quotePartSubventionsExceptionnelle +
    t.reprisesExceptionnelles +
    t.transfertsExceptionnels
  const chargesExceptionnellesCents = t.chargesExceptionnelles + t.valeurComptableCessionsExceptionnelles + t.dotationsExceptionnelles
  const resultatExceptionnelCents = produitsExceptionnelsCents - chargesExceptionnellesCents

  const resultatExerciceCents = resultatCourantCents + resultatExceptionnelCents - t.participationSalaries - t.impotsBenefices

  const produitsCessionsCents = t.produitsCessionsExploitation + t.produitsCessionsFinancieres + t.produitsCessionsExceptionnels
  const valeurComptableCessionsCents =
    t.valeurComptableCessionsExploitation + t.valeurComptableCessionsFinancieres + t.valeurComptableCessionsExceptionnelles

  return {
    chiffreAffairesCents: sumPrefix(accounts, '70'),
    ventesMarchandisesCents: t.ventesMarchandises,
    coutMarchandisesCents: t.coutMarchandises,
    margeCommercialeCents,
    hasMarchandises,
    productionVendueCents: t.productionVendue,
    productionStockeeCents: t.productionStockee,
    productionImmobiliseeCents: t.productionImmobilisee,
    productionExerciceCents,
    consommationsTiersCents: t.consommationsTiers,
    valeurAjouteeCents,
    subventionsExploitationCents: t.subventionsExploitation,
    impotsTaxesCents: t.impotsTaxes,
    chargesPersonnelCents: t.chargesPersonnel,
    ebeCents,
    reprisesTransfertsCents,
    autresProduitsCents,
    dotationsExploitationCents: t.dotationsExploitation,
    autresChargesCents,
    resultatExploitationCents,
    quotesPartsCommunesCents,
    produitsFinanciersCents,
    chargesFinancieresCents,
    resultatCourantCents,
    produitsExceptionnelsCents,
    chargesExceptionnellesCents,
    resultatExceptionnelCents,
    participationCents: t.participationSalaries,
    impotsBeneficesCents: t.impotsBenefices,
    resultatExerciceCents,
    produitsCessionsCents,
    valeurComptableCessionsCents,
    plusValuesCessionCents: produitsCessionsCents - valeurComptableCessionsCents,
  }
}

/** Credit minus debit of the accounts starting with `prefix`. */
function sumPrefix(accounts: readonly AccountTotals[], prefix: string): number {
  let cents = 0
  for (const a of accounts) if (a.code.startsWith(prefix)) cents += a.creditCents - a.debitCents
  return cents
}

export interface Caf {
  resultatExerciceCents: number
  /** All of class 68: dotations d'exploitation, financières, exceptionnelles. */
  dotationsCents: number
  /** All of class 78. */
  reprisesCents: number
  valeurComptableCessionsCents: number
  produitsCessionsCents: number
  /** 747 (777 before ANC 2022-06): a calculated product, never cashed. */
  quotePartSubventionsCents: number
  cafCents: number
  /** The same CAF from the EBE (subtractive method): equal to cafCents by construction, kept as a check. */
  cafFromEbeCents: number
}

/**
 * Capacité d'autofinancement by the additive method, from the result of the
 * year: plus the calculated charges (dotations, book value of the assets
 * sold), minus the calculated products (reprises, disposal proceeds, quote-
 * part of investment subsidies). PCG 1982, tableau de financement (système
 * développé); same definition as the Banque de France and the OEC. The
 * subtractive method (from the EBE, adding the other products to be cashed
 * and subtracting the other charges to be paid) gives the same amount.
 */
export function computeCaf(accounts: readonly AccountTotals[], sig: Sig = computeSig(accounts)): Caf {
  const t = sigTotals(accounts)
  const dotationsCents = t.dotationsExploitation + t.dotationsFinancieres + t.dotationsExceptionnelles
  const reprisesCents = t.reprisesExploitation + t.reprisesFinancieres + t.reprisesExceptionnelles
  const quotePartSubventionsCents = t.quotePartSubventionsInvestissement + t.quotePartSubventionsExceptionnelle
  const cafCents =
    sig.resultatExerciceCents +
    dotationsCents -
    reprisesCents +
    sig.valeurComptableCessionsCents -
    sig.produitsCessionsCents -
    quotePartSubventionsCents

  const cafFromEbeCents =
    sig.ebeCents +
    t.transfertsExploitation +
    t.autresProduits -
    t.autresCharges +
    t.quotePartBeneficeCommun -
    t.quotePartPerteCommune +
    t.produitsFinanciers +
    t.transfertsFinanciers -
    t.chargesFinancieres +
    t.produitsExceptionnels +
    t.transfertsExceptionnels -
    t.chargesExceptionnelles -
    t.participationSalaries -
    t.impotsBenefices

  return {
    resultatExerciceCents: sig.resultatExerciceCents,
    dotationsCents,
    reprisesCents,
    valeurComptableCessionsCents: sig.valeurComptableCessionsCents,
    produitsCessionsCents: sig.produitsCessionsCents,
    quotePartSubventionsCents,
    cafCents,
    cafFromEbeCents,
  }
}
