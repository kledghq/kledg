/**
 * The fixed asset report of a fiscal year (pure module, amounts in cents):
 * forms 2054-SD and 2055-SD (régime réel normal), 2033-C-SD cadres I and II
 * (régime simplifié), the tables of PCG art. 832-1 and 832-2 for the
 * annexe, and the checks that tie them to the balance sheet and to the
 * fixed asset register.
 *
 * Figures come from the validated entries of the year (movements.ts), so
 * the gross values at the end equal the balances of the balance sheet. The
 * checks say where the books and the register (registre des immobilisations,
 * lib/fixed-assets) disagree, line by line, without choosing for the user:
 * - gross value at the end of the 2054 against the "Actif immobilisé" brut
 *   of the balance sheet (box BJ of 2050);
 * - depreciation at the end of the 2055 plus the impairments (29) against
 *   its "Amortissements, dépréciations" column (box BK);
 * - acquisitions, disposals and gross values of the register against the
 *   2054 lines, depreciation of the year and accumulated against the 2055.
 */

import { formatCentsFr } from '@/lib/utils/money'
import { computeDisposal, DISPOSAL_KIND_LABELS, type DisposalKind, type ProfitTaxationKind } from '@/lib/fixed-assets/disposal'
import {
  FORM_2033C_ASSETS,
  FORM_2033C_DEPRECIATION,
  FORM_2054,
  FORM_2055,
  lineOf,
  type AssetColumn,
  type DepreciationColumn,
  type SimplifiedAssetColumn,
} from './fixed-asset-forms'
import { accountMovements, amountOf, depreciationRows, form2033cRows, form2054Rows, type FormRow, type LedgerLine } from './movements'

export interface RegisterAsset {
  id: string
  label: string
  assetAccountCode: string
  depreciationAccountCode: string
  grossCents: number
  acquisitionDate: string
  disposalDate: string | null
  /** Depreciation accumulated at the start of the year (the day before) and at its end, from the plan and the records. */
  depreciationAtStartCents: number
  depreciationAtEndCents: number
  /** The exit recorded on the asset (record-disposal.service.ts); null without one. */
  disposal?: { kind: DisposalKind; priceCents: number; depreciable: boolean; taxation: ProfitTaxationKind } | null
}

/**
 * One asset that left in the year: a line of 2033-C-SD cadre III and of
 * 2059-A-SD (columns 1 to 10). Depreciation runs to the day of exit.
 */
export interface DisposalRow {
  fixedAssetId: string
  label: string
  kind: DisposalKind
  kindLabel: string
  acquisitionDate: string
  disposalDate: string
  assetAccountCode: string
  grossCents: number
  depreciationCents: number
  residualCents: number
  priceCents: number
  gainCents: number
  /** Null when the taxation of the profits (IS or IR) is unknown. */
  shortTermCents: number | null
  longTermCents: number | null
}

/** A total box of 2033-C-SD cadre III; null when Kledg does not follow it. */
export interface DisposalTotal {
  box: string
  label: string
  cents: number | null
  note?: string
}

export interface DisposalReport {
  rows: DisposalRow[]
  /** Box totals of 2033-C-SD cadre III (form n° 2033-SD 2026). */
  form2033c: DisposalTotal[]
  /** Net short-term and long-term results, 2059-A-SD cadres A and B. */
  netShortTermCents: number | null
  netLongTermCents: number | null
}

export interface FixedAssetReportInput {
  fiscalYear: { id: string; year: number; startDate: string; endDate: string }
  lines: readonly LedgerLine[]
  /** Balance of the impairment accounts (29) at the end of the year, credit positive. */
  impairmentCents: number
  /** "Actif immobilisé" of the complete balance sheet: brut and amortissements columns; null when the layout has no BJ line. */
  balanceSheet: { grossCents: number; depreciationCents: number } | null
  register: readonly RegisterAsset[]
  /** Draft entries of the year on class 2 accounts: not in the figures until validated. */
  draftEntries: number
}

export interface ReportCheck {
  id: string
  label: string
  /** What the books say (the forms). */
  booksCents: number
  /** What the other source says. */
  otherCents: number
  ok: boolean
  /** French explanation when it differs. */
  message: string | null
}

export interface FixedAssetReport {
  fiscalYear: FixedAssetReportInput['fiscalYear']
  form2054: FormRow<AssetColumn>[]
  form2055: FormRow<DepreciationColumn>[]
  form2033c: { assets: FormRow<SimplifiedAssetColumn>[]; depreciation: FormRow<DepreciationColumn>[] }
  /** Totals by rubrique for the annexe (PCG art. 832-1). */
  rubriques: Array<{ rubrique: 'intangible' | 'tangible' | 'financial'; label: string; openingCents: number; increaseCents: number; decreaseCents: number; closingCents: number }>
  impairmentCents: number
  disposals: DisposalReport
  checks: ReportCheck[]
  warnings: string[]
}

const NOT_FOLLOWED_LONG_TERM_IS =
  "À l'impôt sur les sociétés, le long terme ne vise que les titres de participation (CGI art. 219, I-a ter), dont Kledg ne prépare pas la cession."
const NOT_FOLLOWED_REGULARISATION =
  'Régularisations (provision spéciale de réévaluation, amortissements exclus des charges déductibles ou irrégulièrement différés) : Kledg ne les suit pas, à ajouter à la main le cas échéant.'

/** Rows and totals of the disposals of the year (2033-C-SD cadre III, 2059-A-SD). */
export function disposalReport(register: readonly RegisterAsset[], inYear: (day: string | null) => boolean): DisposalReport {
  const rows: DisposalRow[] = []
  for (const asset of register) {
    if (!asset.disposal || !inYear(asset.disposalDate)) continue
    const { kind, priceCents, depreciable, taxation } = asset.disposal
    const result = computeDisposal({
      grossCents: asset.grossCents,
      depreciationCents: asset.depreciationAtEndCents,
      priceCents,
      acquisitionDate: asset.acquisitionDate,
      disposalDate: asset.disposalDate as string,
      depreciable,
      taxation,
    })
    rows.push({
      fixedAssetId: asset.id,
      label: asset.label,
      kind,
      kindLabel: DISPOSAL_KIND_LABELS[kind],
      acquisitionDate: asset.acquisitionDate,
      disposalDate: asset.disposalDate as string,
      assetAccountCode: asset.assetAccountCode,
      grossCents: asset.grossCents,
      depreciationCents: asset.depreciationAtEndCents,
      residualCents: result.netBookValueCents,
      priceCents,
      gainCents: result.gainCents,
      shortTermCents: result.shortTermCents,
      longTermCents: result.longTermCents,
    })
  }
  rows.sort((a, b) => a.disposalDate.localeCompare(b.disposalDate) || a.label.localeCompare(b.label))
  const sum = (pick: (r: DisposalRow) => number) => rows.reduce((t, r) => t + pick(r), 0)
  const known = rows.every((r) => r.shortTermCents !== null)
  const sumKnown = (pick: (r: DisposalRow) => number | null) => (known ? rows.reduce((t, r) => t + (pick(r) ?? 0), 0) : null)
  const unknownNote = known ? undefined : "Le régime d'imposition des bénéfices n'est pas renseigné : Kledg ne sépare pas le court et le long terme."
  const taxations = new Set(rows.map((r) => register.find((a) => a.id === r.fixedAssetId)?.disposal?.taxation))
  const income = taxations.has('IR')
  const shortTerm = sumKnown((r) => r.shortTermCents)
  const longTerm = sumKnown((r) => r.longTermCents)
  // Columns of the IS long-term rates: not filled under IR (notice 2033-NOT-SD, cadre III)
  const isOnly = (box: string, label: string): DisposalTotal => ({
    box,
    label,
    cents: null,
    note: income ? "Colonne à ne pas servir à l'impôt sur le revenu (notice 2033-NOT-SD, cadre III)." : NOT_FOLLOWED_LONG_TERM_IS,
  })
  const form2033c: DisposalTotal[] = [
    { box: '578', label: "Valeur d'actif", cents: sum((r) => r.grossCents) },
    { box: '580', label: 'Amortissements', cents: sum((r) => r.depreciationCents) },
    { box: '582', label: 'Valeur résiduelle', cents: sum((r) => r.residualCents) },
    { box: '584', label: 'Prix de cession', cents: sum((r) => r.priceCents) },
    { box: '586', label: 'Plus ou moins-values à court terme', cents: shortTerm, note: unknownNote },
    isOnly('581', 'Long terme à 19 %'),
    {
      box: '587',
      label: 'Long terme à 15 % ou 12,8 %',
      cents: income ? longTerm : null,
      note: income ? unknownNote : NOT_FOLLOWED_LONG_TERM_IS,
    },
    isOnly('589', 'Long terme à 0 %'),
    { box: '590', label: 'Régularisations, court terme', cents: null, note: NOT_FOLLOWED_REGULARISATION },
    { box: '596', label: 'Total court terme', cents: shortTerm, note: 'Plus les régularisations (590) éventuelles.' },
  ]
  return { rows, form2033c, netShortTermCents: shortTerm, netLongTermCents: longTerm }
}

const euro = formatCentsFr

function check(id: string, label: string, booksCents: number, otherCents: number, explain: (gap: number) => string): ReportCheck {
  const ok = booksCents === otherCents
  return { id, label, booksCents, otherCents, ok, message: ok ? null : explain(Math.abs(booksCents - otherCents)) }
}

const RUBRIQUE_LABELS = { intangible: 'Immobilisations incorporelles', tangible: 'Immobilisations corporelles', financial: 'Immobilisations financières' } as const

export function buildFixedAssetReport(input: FixedAssetReportInput): FixedAssetReport {
  const { assets, depreciation } = accountMovements(input.lines)
  const form2054 = form2054Rows(FORM_2054, assets)
  const form2055 = depreciationRows(FORM_2055, depreciation)
  const form2033c = { assets: form2033cRows(FORM_2033C_ASSETS, assets), depreciation: depreciationRows(FORM_2033C_DEPRECIATION, depreciation) }
  const { startDate, endDate } = input.fiscalYear

  const rubriques = (['intangible', 'tangible', 'financial'] as const).map((rubrique) => {
    const lines = FORM_2054.filter((l) => l.kind === 'line' && l.rubrique === rubrique).map((l) => l.id)
    const sum = (column: AssetColumn) => lines.reduce((t, id) => t + amountOf(form2054, id, column), 0)
    return {
      rubrique,
      label: RUBRIQUE_LABELS[rubrique],
      openingCents: sum('opening'),
      increaseCents: sum('revaluation') + sum('increase'),
      decreaseCents: sum('transferOut') + sum('disposal'),
      closingCents: sum('closing'),
    }
  })

  const checks: ReportCheck[] = []
  const warnings: string[] = []
  const grossEnd = amountOf(form2054, 'grandTotal', 'closing')
  const depreciationEnd = amountOf(form2055, 'grandTotal', 'closing')

  if (input.balanceSheet) {
    checks.push(
      check('balance-sheet-gross', "Valeur brute à la fin (2054) et actif immobilisé brut du bilan", grossEnd, input.balanceSheet.grossCents, (gap) =>
        `L'actif immobilisé brut du bilan diffère de ${euro(gap)} : un compte de la classe 2 est rangé ailleurs dans la présentation du bilan, ou un compte du bilan n'est pas une immobilisation.`,
      ),
      check('balance-sheet-depreciation', 'Amortissements (2055) et dépréciations (29) à la fin, et colonne amortissements du bilan', depreciationEnd + input.impairmentCents, input.balanceSheet.depreciationCents, (gap) =>
        `La colonne amortissements et dépréciations du bilan diffère de ${euro(gap)} : vérifiez la présentation du bilan (comptes 28 et 29).`,
      ),
    )
  } else {
    warnings.push("Le bilan n'a pas de ligne « Actif immobilisé » (case BJ) : le rapprochement avec le bilan n'est pas fait.")
  }

  const inYear = (day: string | null) => day !== null && day >= startDate && day <= endDate
  const disposals = disposalReport(input.register, inYear)
  for (const asset of input.register) {
    if (!asset.disposal && inYear(asset.disposalDate)) {
      warnings.push(`« ${asset.label} » est sortie le ${asset.disposalDate} sans que sa sortie soit enregistrée (nature, prix) : enregistrez-la depuis la page Immobilisations pour la reprendre dans les plus et moins-values.`)
    }
  }
  const presentAtEnd = (a: RegisterAsset) => a.acquisitionDate <= endDate && (a.disposalDate === null || a.disposalDate > endDate)
  if (input.register.length === 0) {
    warnings.push("Aucune immobilisation dans le registre : les tableaux viennent des seules écritures, sans contrôle par le registre.")
  } else {
    const registerBy2054 = new Map<string, { acquired: number; disposed: number; end: number }>()
    const registerBy2055 = new Map<string, { allowance: number; end: number }>()
    for (const asset of input.register) {
      const line = lineOf(FORM_2054, asset.assetAccountCode)
      if (line) {
        const r = registerBy2054.get(line.id) ?? { acquired: 0, disposed: 0, end: 0 }
        if (inYear(asset.acquisitionDate)) r.acquired += asset.grossCents
        if (inYear(asset.disposalDate)) r.disposed += asset.grossCents
        if (presentAtEnd(asset)) r.end += asset.grossCents
        registerBy2054.set(line.id, r)
      } else {
        warnings.push(`L'immobilisation « ${asset.label} » est rattachée au compte ${asset.assetAccountCode}, qui n'est pas un compte d'immobilisation (20 à 27).`)
      }
      const dLine = lineOf(FORM_2055, asset.depreciationAccountCode)
      if (dLine && asset.depreciationAccountCode.startsWith('28')) {
        const r = registerBy2055.get(dLine.id) ?? { allowance: 0, end: 0 }
        r.allowance += asset.depreciationAtEndCents - asset.depreciationAtStartCents
        // A disposed asset leaves the depreciation accounts with it
        if (presentAtEnd(asset)) r.end += asset.depreciationAtEndCents
        registerBy2055.set(dLine.id, r)
      }
    }
    for (const entry of FORM_2054) {
      if (entry.kind !== 'line') continue
      const r = registerBy2054.get(entry.id)
      if (!r) continue
      const books = (column: AssetColumn) => amountOf(form2054, entry.id, column)
      checks.push(
        check(`register-acquisitions-${entry.id}`, `${entry.label} : acquisitions du registre et augmentations`, books('increase') + books('revaluation'), r.acquired, (gap) =>
          `Les augmentations de l'exercice diffèrent de ${euro(gap)} des acquisitions du registre : une immobilisation acquise n'est pas au registre, ou une acquisition du registre n'est pas comptabilisée (les mises en service d'immobilisations en cours comptent aussi en augmentation).`,
        ),
        check(`register-disposals-${entry.id}`, `${entry.label} : sorties du registre et diminutions`, books('disposal') + books('transferOut'), r.disposed, (gap) =>
          `Les diminutions de l'exercice diffèrent de ${euro(gap)} des sorties du registre : renseignez la date de cession dans le registre, ou comptabilisez la sortie.`,
        ),
        check(`register-gross-${entry.id}`, `${entry.label} : valeur brute à la fin, registre et écritures`, books('closing'), r.end, (gap) =>
          `La valeur brute à la fin diffère de ${euro(gap)} de celle du registre.`,
        ),
      )
    }
    for (const entry of FORM_2055) {
      if (entry.kind !== 'line') continue
      const r = registerBy2055.get(entry.id)
      if (!r) continue
      checks.push(
        check(`register-allowance-${entry.id}`, `${entry.label} : dotations de l'exercice, registre et écritures`, amountOf(form2055, entry.id, 'allowance'), r.allowance, (gap) =>
          `Les dotations comptabilisées diffèrent de ${euro(gap)} du plan d'amortissement du registre : générez les dotations manquantes, ou corrigez le montant enregistré.`,
        ),
        check(`register-depreciation-${entry.id}`, `${entry.label} : amortissements cumulés à la fin, registre et écritures`, amountOf(form2055, entry.id, 'closing'), r.end, (gap) =>
          `Les amortissements cumulés diffèrent de ${euro(gap)} de ceux du registre.`,
        ),
      )
    }
  }
  if (input.draftEntries > 0) {
    warnings.push(`${input.draftEntries} écriture${input.draftEntries > 1 ? 's' : ''} en brouillon touche${input.draftEntries > 1 ? 'nt' : ''} les immobilisations : elles ne comptent qu'une fois validées.`)
  }
  return { fiscalYear: input.fiscalYear, form2054, form2055, form2033c, rubriques, impairmentCents: input.impairmentCents, disposals, checks, warnings }
}
