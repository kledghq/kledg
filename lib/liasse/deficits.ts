/**
 * Suivi des déficits reportables (pure, amounts in cents): cadre II of form
 * 2033-D-SD (régime simplifié) and cadre I of form 2058-B-SD (régime
 * normal), from the impôt sur les sociétés worksheet (lib/corporate-tax),
 * which carries the deficits from the returns recorded for earlier years
 * and imputes them under CGI art. 209, I.
 *
 * Lines (forms 2033-D-SD and 2058-B-SD 2026, notice 2033-NOT-SD):
 * - 982 / K4: deficits left at the end of the previous year (line 870 / YK
 *   of the previous form);
 * - 982 bis / K4 bis and 982 ter / K4 ter: deficits transferred de plein
 *   droit (art. 209, II-2 of the CGI) and the number of operations: Kledg
 *   does not follow mergers or splits, they are filled by hand;
 * - 983 / K5: deficits imputed this year (line 360 of 2033-B-SD, XB and XL
 *   of 2058-A-SD);
 * - 984 / K6: reportables, 982 + 982 bis - 983;
 * - 860 / YJ: deficit of the year (line 372 of 2033-B-SD, XO of 2058-A-SD);
 * - 870 / YK: total left to carry, 984 + 860.
 */

import { amount, cell, manual, sumCells, type LiasseCell, type LiasseRow, type LiasseSection } from './cells'

export interface DeficitCodes {
  opening: string
  transferred: string
  operations: string
  imputed: string
  reportable: string
  created: string
  total: string
}

export const DEFICIT_CODES_2033D: DeficitCodes = { opening: '982', transferred: '982 bis', operations: '982 ter', imputed: '983', reportable: '984', created: '860', total: '870' }

export interface DeficitsInput {
  /** The opening is known: recorded for the year or carried from the returns of earlier years. */
  known: boolean
  openingCents: number
  imputedCents: number
  createdCents: number
}

const FROM_WORKSHEET = 'Calcul de la page Impôt sur les sociétés.'

/** The cells of the deficits table; `null` input: no worksheet (company not subject to IS or regime unset). */
export function deficitsSection(id: string, title: string, codes: DeficitCodes, input: DeficitsInput | null, why: string): LiasseSection {
  const unknown = (box: string, label: string) => manual(box, label, why)
  const opening: LiasseCell =
    input && input.known
      ? cell(codes.opening, "Déficits restant à reporter au titre de l'exercice précédent", amount(input.openingCents), 'worksheet', { note: FROM_WORKSHEET })
      : unknown(codes.opening, "Déficits restant à reporter au titre de l'exercice précédent")
  const transferred = manual(codes.transferred, 'Déficits transférés de plein droit (article 209-II-2 du CGI)', "Kledg ne suit pas les fusions, scissions et apports partiels d'actif : laissez vide sans opération de ce type.")
  const operations = manual(codes.operations, "Nombre d'opérations sur l'exercice", 'À remplir avec la case des déficits transférés, opération par opération sur un feuillet séparé.')
  const imputed: LiasseCell = input && input.known ? cell(codes.imputed, 'Déficits imputés', amount(input.imputedCents), 'worksheet', { note: FROM_WORKSHEET }) : unknown(codes.imputed, 'Déficits imputés')
  const reportable: LiasseCell =
    input && input.known
      ? { ...sumCells(codes.reportable, 'Déficits reportables', [opening, transferred], 'worksheet'), value: amount(input.openingCents - input.imputedCents) }
      : unknown(codes.reportable, 'Déficits reportables')
  const created: LiasseCell = input ? cell(codes.created, "Déficit de l'exercice", amount(input.createdCents), 'worksheet', { note: FROM_WORKSHEET }) : unknown(codes.created, "Déficit de l'exercice")
  const total: LiasseCell = input && input.known ? sumCells(codes.total, 'Total des déficits restant à reporter', [reportable, created], 'worksheet') : unknown(codes.total, 'Total des déficits restant à reporter')
  const rows: LiasseRow[] = [opening, transferred, operations, imputed, reportable, created, total].map((c, i) => ({ id: `deficits-${i}`, label: c.label, total: c === total, cells: [c] }))
  return { id, title, columns: null, rows }
}
