/**
 * The fixed asset report written as a document (PDF through the document
 * renderer of the approval pack, lib/approval/documents) and as CSV (pure
 * module). Each amount carries the box code of the official form, so the
 * figures are copied into the liasse box by box.
 */

import { eur, type Block, type GeneratedDocument } from '@/lib/approval/documents/model'
import { buildCsv } from '@/lib/reports/csv-safe'
import { centsToDecimal } from '@/lib/utils/money'
import type { AssetColumn, DepreciationColumn, SimplifiedAssetColumn } from './fixed-asset-forms'
import type { FixedAssetReport } from './fixed-asset-report'
import type { FormRow } from './movements'

export const COLUMN_LABELS: { asset: Record<AssetColumn, string>; depreciation: Record<DepreciationColumn, string>; simplified: Record<SimplifiedAssetColumn, string> } = {
  asset: {
    opening: 'Valeur brute au début',
    revaluation: 'Augmentations : réévaluation',
    increase: 'Acquisitions, créations, apports, virements',
    transferOut: 'Diminutions : virements de poste à poste',
    disposal: 'Diminutions : cessions, mises hors service',
    closing: 'Valeur brute à la fin',
    origin: "Réévaluation légale : valeur d'origine",
  },
  depreciation: {
    opening: 'Amortissements au début',
    allowance: "Dotations de l'exercice",
    decrease: 'Diminutions : éléments sortis, reprises',
    closing: 'Amortissements à la fin',
  },
  simplified: {
    opening: 'Valeur brute au début',
    increase: 'Augmentations',
    decrease: 'Diminutions',
    closing: 'Valeur brute à la fin',
  },
}

function cell<C extends string>(row: FormRow<C>, column: C): string {
  const amount = row.amounts[column]
  const code = row.codes[column]
  const value = amount === null ? 'non suivi' : eur(amount)
  return code ? `${code} : ${value}` : value
}

function table<C extends string>(rows: readonly FormRow<C>[], columns: readonly C[], labels: Record<C, string>): Block {
  return {
    kind: 'table',
    columns: ['Immobilisations', ...columns.map((c) => labels[c])],
    rows: rows.map((r) => [r.isTotal ? r.label.toUpperCase() : r.label, ...columns.map((c) => cell(r, c))]),
    numeric: columns.map((_, i) => i + 1),
  }
}

export function fixedAssetDocument(report: FixedAssetReport, company: { name: string; siren: string }): GeneratedDocument {
  const fy = report.fiscalYear
  const blocks: Block[] = [
    { kind: 'heading', text: 'Formulaire 2054-SD : immobilisations, cadre A' },
    table(report.form2054, ['opening', 'revaluation', 'increase'] as const, COLUMN_LABELS.asset),
    { kind: 'heading', text: 'Formulaire 2054-SD : immobilisations, cadre B' },
    table(report.form2054, ['transferOut', 'disposal', 'closing', 'origin'] as const, COLUMN_LABELS.asset),
    { kind: 'heading', text: 'Formulaire 2055-SD : amortissements, cadre A' },
    table(report.form2055, ['opening', 'allowance', 'decrease', 'closing'] as const, COLUMN_LABELS.depreciation),
    { kind: 'heading', text: 'Formulaire 2033-C-SD : cadre I, immobilisations' },
    table(report.form2033c.assets, ['opening', 'increase', 'decrease', 'closing'] as const, COLUMN_LABELS.simplified),
    { kind: 'heading', text: 'Formulaire 2033-C-SD : cadre II, amortissements' },
    table(report.form2033c.depreciation, ['opening', 'allowance', 'decrease', 'closing'] as const, COLUMN_LABELS.depreciation),
    { kind: 'heading', text: 'Plus et moins-values : 2033-C-SD cadre III, 2059-A-SD' },
    ...(report.disposals.rows.length === 0
      ? [{ kind: 'note' as const, text: "Aucune sortie d'immobilisation enregistrée dans l'exercice." }]
      : [
          {
            kind: 'table' as const,
            columns: ['Immobilisation (acquise, sortie)', "Valeur d'origine", 'Amortissements', 'Valeur résiduelle', 'Prix de cession', 'Plus ou moins-value', 'Court terme', 'Long terme'],
            rows: report.disposals.rows.map((r) => [
              `${r.label} (${r.kindLabel}, acquise le ${r.acquisitionDate.split('-').reverse().join('/')}, sortie le ${r.disposalDate.split('-').reverse().join('/')})`,
              eur(r.grossCents),
              eur(r.depreciationCents),
              eur(r.residualCents),
              eur(r.priceCents),
              eur(r.gainCents),
              r.shortTermCents === null ? 'non déterminé' : eur(r.shortTermCents),
              r.longTermCents === null ? 'non déterminé' : eur(r.longTermCents),
            ]),
            numeric: [1, 2, 3, 4, 5, 6, 7],
          },
          {
            kind: 'list' as const,
            items: report.disposals.form2033c.map((t) => `${t.box} ${t.label} : ${t.cents === null ? 'non suivi' : eur(t.cents)}${t.note ? ` (${t.note})` : ''}`),
          },
        ]),
    { kind: 'heading', text: 'Contrôles' },
    {
      kind: 'list',
      items: report.checks.map((c) => `${c.ok ? 'Concordant' : 'À vérifier'} : ${c.label} (écritures ${eur(c.booksCents)}, autre source ${eur(c.otherCents)})${c.message ? `. ${c.message}` : ''}`),
    },
    ...(report.warnings.length > 0 ? [{ kind: 'list' as const, items: report.warnings }] : []),
    {
      kind: 'note',
      text: "Montants lus dans les écritures validées de l'exercice (à-nouveaux compris, écriture de clôture exclue). Le cadre B du 2055-SD (amortissements dérogatoires), le cadre C (charges réparties) et la colonne « valeur d'origine » des immobilisations réévaluées ne sont pas suivis par Kledg. Les plus et moins-values viennent des sorties enregistrées au registre (amortissements jusqu'au jour de la sortie). Formulaires DGFiP n° 2054-SD, 2055-SD, 2033-C-SD et 2059-A-SD, édition 2026.",
    },
  ]
  return {
    header: [company.name, `SIREN ${company.siren.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')}`],
    title: 'Immobilisations et amortissements',
    subtitle: `Exercice du ${fy.startDate.split('-').reverse().join('/')} au ${fy.endDate.split('-').reverse().join('/')}`,
    blocks,
    footer: `${company.name}, immobilisations ${fy.year}`,
    fileName: `Immobilisations_${fy.year}`,
  }
}

const amount = (cents: number | null) => (cents === null ? '' : centsToDecimal(cents).replace('.', ','))

/** One CSV row per form, line and column, with the box code: easy to filter and to copy into the liasse. */
export function fixedAssetCsv(report: FixedAssetReport): string {
  const rows: Array<Array<string | number | null>> = [['Formulaire', 'Ligne', 'Colonne', 'Case', 'Montant', 'Comptes']]
  const push = <C extends string>(form: string, formRows: readonly FormRow<C>[], labels: Record<C, string>) => {
    for (const r of formRows) {
      for (const column of Object.keys(labels) as C[]) {
        rows.push([form, r.label, labels[column], r.codes[column] ?? '', amount(r.amounts[column]), r.accounts.join(' ')])
      }
    }
  }
  push('2054-SD', report.form2054, COLUMN_LABELS.asset)
  push('2055-SD', report.form2055, COLUMN_LABELS.depreciation)
  push('2033-C-SD cadre I', report.form2033c.assets, COLUMN_LABELS.simplified)
  push('2033-C-SD cadre II', report.form2033c.depreciation, COLUMN_LABELS.depreciation)
  for (const r of report.disposals.rows) {
    const line = `${r.label} (sortie le ${r.disposalDate})`
    const columns: Array<[string, number | null]> = [
      ["Valeur d'origine", r.grossCents],
      ['Amortissements', r.depreciationCents],
      ['Valeur résiduelle', r.residualCents],
      ['Prix de cession', r.priceCents],
      ['Plus ou moins-value', r.gainCents],
      ['Court terme', r.shortTermCents],
      ['Long terme', r.longTermCents],
    ]
    for (const [label, cents] of columns) rows.push(['2033-C-SD cadre III, 2059-A-SD', line, label, '', amount(cents), r.assetAccountCode])
  }
  for (const t of report.disposals.form2033c) rows.push(['2033-C-SD cadre III', 'Total', t.label, t.box, amount(t.cents), ''])
  return buildCsv(rows)
}
