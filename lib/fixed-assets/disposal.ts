/**
 * Disposal of a fixed asset (pure module, amounts in cents, days as
 * yyyy-mm-dd): the gain or loss, its tax character, and the exit entry.
 *
 * Gain or loss (PCG art. 214-10 and 942-65 / 942-75, chart as amended by
 * règlement ANC n° 2022-06): sale price excluding VAT less the net book
 * value, gross value less the depreciation accumulated up to the day of
 * exit (the "dotation complémentaire" of the year runs to that day,
 * lib/fixed-assets/depreciation-plan.ts). A retirement (scrap, destruction)
 * has no price: the loss is the net book value.
 *
 * Exit entry (OD journal, dated the day of exit):
 *   debit 28x  accumulated depreciation of the asset
 *   debit 657  "Valeurs comptables des immobilisations incorporelles et
 *              corporelles cédées", the net book value
 *   credit 2x  gross value
 * and, for a sale whose price is not booked yet (no sale invoice):
 *   debit 462  "Créances sur cessions d'immobilisations"
 *   credit 757 "Produits des cessions d'immobilisations incorporelles et
 *              corporelles", the price excluding VAT.
 * Financial assets (26, 27) leave through 667 / 767 and follow other tax
 * rules (titres de participation): they are outside this module.
 *
 * Tax character (form 2033-C-SD cadre III and 2059-A-SD, notices
 * 2033-NOT-SD and 2032-NOT-SD 2026):
 * - impôt sur les sociétés: the long-term regime only covers titres de
 *   participation and similar shares (CGI art. 219, I-a ter and a
 *   quinquies; notice 2033-NOT-SD, cadre III: "Pour l'impôt sur les
 *   sociétés, le régime des plus et moins-values à long terme concerne
 *   uniquement les titres de participations et assimilés"). A gain or loss
 *   on an intangible or tangible asset is short term, already in the
 *   accounting result and taxed at the normal rate: nothing to add or
 *   deduct on 2033-B / 2058-A;
 * - impôt sur le revenu (CGI art. 39 duodecies): an asset held less than
 *   two years gives a short-term gain or loss; held two years or more, a
 *   depreciable asset gives a short-term gain up to the depreciation
 *   deducted and a long-term gain beyond it, and a short-term loss; a
 *   non-depreciable asset gives a long-term gain or loss. Long-term net
 *   gains are taxed at 12.8 % (CGI art. 39 quindecies, I-1).
 * Exemptions (CGI art. 151 septies, 238 quindecies...) depend on facts
 * Kledg does not hold: they are flagged, never applied.
 */

export const DISPOSAL_KINDS = ['sale', 'scrap', 'destruction'] as const
export type DisposalKind = (typeof DISPOSAL_KINDS)[number]

export const DISPOSAL_KIND_LABELS: Record<DisposalKind, string> = {
  sale: 'Cession (vente)',
  scrap: 'Mise au rebut',
  destruction: 'Destruction',
}

export function isDisposalKind(value: unknown): value is DisposalKind {
  return typeof value === 'string' && (DISPOSAL_KINDS as readonly string[]).includes(value)
}

/** Accounts of the exit entry (PCG chart, règlement ANC n° 2022-06). */
export const DISPOSAL_ACCOUNTS = {
  bookValue: { code: '657', label: 'Valeurs comptables des immobilisations incorporelles et corporelles cédées' },
  proceeds: { code: '757', label: "Produits des cessions d'immobilisations incorporelles et corporelles" },
  receivable: { code: '462', label: "Créances sur cessions d'immobilisations" },
} as const

/** Intangible and tangible assets (20 to 23): the ones this module handles. */
export function isDisposableAssetAccount(code: string): boolean {
  return /^2[0-3]/.test(code)
}

export type ProfitTaxationKind = 'IS' | 'IR' | 'unknown'

export interface DisposalInput {
  grossCents: number
  /** Depreciation accumulated up to the day of exit. */
  depreciationCents: number
  priceCents: number
  acquisitionDate: string
  disposalDate: string
  /** The asset has a depreciation plan. */
  depreciable: boolean
  taxation: ProfitTaxationKind
}

export interface DisposalResult {
  netBookValueCents: number
  /** Price less net book value: positive for a gain, negative for a loss. */
  gainCents: number
  /** Held two years or more on the day of exit (CGI art. 39 duodecies). */
  heldTwoYears: boolean
  /** Short-term and long-term parts (signed); null when the taxation is unknown. */
  shortTermCents: number | null
  longTermCents: number | null
  /** Why the split is what it is (French, for the page and the tool). */
  explanation: string
}

/** The same day two years later, as text: compared as text, 29 February is passed on 1 March. */
function twoYearsAfter(day: string): string {
  return `${Number(day.slice(0, 4)) + 2}${day.slice(4)}`
}

const euroWord = (cents: number) => (cents >= 0 ? 'plus-value' : 'moins-value')

export function computeDisposal(input: DisposalInput): DisposalResult {
  const netBookValueCents = input.grossCents - input.depreciationCents
  const gainCents = input.priceCents - netBookValueCents
  // Two years to the day: an asset acquired on 2024-03-15 is held two years on 2026-03-15
  const heldTwoYears = input.disposalDate >= twoYearsAfter(input.acquisitionDate)
  const base = { netBookValueCents, gainCents, heldTwoYears }

  if (input.taxation === 'IS') {
    return {
      ...base,
      shortTermCents: gainCents,
      longTermCents: 0,
      explanation: `À l'impôt sur les sociétés, la ${euroWord(gainCents)} sur une immobilisation incorporelle ou corporelle est à court terme (le long terme ne vise que les titres de participation, CGI art. 219, I-a ter) : elle est déjà dans le résultat comptable et imposée au taux normal.`,
    }
  }
  if (input.taxation === 'IR') {
    if (!heldTwoYears) {
      return { ...base, shortTermCents: gainCents, longTermCents: 0, explanation: `Bien détenu moins de deux ans : la ${euroWord(gainCents)} est à court terme (CGI art. 39 duodecies, 2-a).` }
    }
    if (!input.depreciable) {
      return { ...base, shortTermCents: 0, longTermCents: gainCents, explanation: `Bien non amortissable détenu au moins deux ans : la ${euroWord(gainCents)} est à long terme (CGI art. 39 duodecies, 1 et 3).` }
    }
    if (gainCents <= 0) {
      return { ...base, shortTermCents: gainCents, longTermCents: 0, explanation: 'Bien amortissable détenu au moins deux ans : la moins-value est à court terme (CGI art. 39 duodecies, 2-b).' }
    }
    const shortTermCents = Math.min(gainCents, input.depreciationCents)
    return {
      ...base,
      shortTermCents,
      longTermCents: gainCents - shortTermCents,
      explanation: 'Bien amortissable détenu au moins deux ans : la plus-value est à court terme à hauteur des amortissements déduits, à long terme au-delà (CGI art. 39 duodecies, 2-a et 3).',
    }
  }
  return {
    ...base,
    shortTermCents: null,
    longTermCents: null,
    explanation: "Le régime d'imposition des bénéfices (IS ou IR) n'est pas renseigné : Kledg ne peut pas dire si la plus ou moins-value est à court ou à long terme.",
  }
}

export interface DisposalLine {
  code: string
  label: string
  debitCents: number
  creditCents: number
}

/**
 * Lines of the exit entry. `withPrice`: the price is not booked yet (no
 * sale invoice crediting 757), the entry records the receivable.
 */
export function disposalEntryLines(input: {
  asset: { code: string; label: string }
  depreciation: { code: string; label: string } | null
  grossCents: number
  depreciationCents: number
  priceCents: number
  withPrice: boolean
}): DisposalLine[] {
  const lines: DisposalLine[] = []
  const bookValue = input.grossCents - input.depreciationCents
  if (input.depreciationCents > 0 && input.depreciation) {
    lines.push({ ...input.depreciation, debitCents: input.depreciationCents, creditCents: 0 })
  }
  if (bookValue > 0) lines.push({ ...DISPOSAL_ACCOUNTS.bookValue, debitCents: bookValue, creditCents: 0 })
  lines.push({ ...input.asset, debitCents: 0, creditCents: input.grossCents })
  if (input.withPrice && input.priceCents > 0) {
    lines.push({ ...DISPOSAL_ACCOUNTS.receivable, debitCents: input.priceCents, creditCents: 0 })
    lines.push({ ...DISPOSAL_ACCOUNTS.proceeds, debitCents: 0, creditCents: input.priceCents })
  }
  return lines
}

/** What recording an exit computes and writes (record-disposal.service.ts), as the page and the tool read it. */
export interface DisposalPreview {
  fixedAsset: { id: string; label: string; assetAccount: string; depreciationAccount: string }
  fiscalYear: { id: string; year: number }
  disposalDate: string
  kind: DisposalKind
  kindLabel: string
  grossCents: number
  depreciationCents: number
  priceCents: number
  priceRecorded: boolean
  result: DisposalResult
  /** How the profits are taxed (IS or IR), with its source. */
  taxation: string
  lines: DisposalLine[]
  warnings: string[]
  /** The draft entry, once recorded. */
  entry: { id: string; entryNumber: string } | null
}
