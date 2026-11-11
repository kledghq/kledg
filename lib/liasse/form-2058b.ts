/**
 * Form 2058-B-SD 2026, "Déficits, indemnités pour congés à payer et
 * provisions non déductibles" (régime réel normal), on plain values (pure):
 * - cadre I, suivi des déficits (K4 to YK): deficits.ts, from the impôt sur
 *   les sociétés worksheet (CGI art. 209, I);
 * - cadre II (ZT): congés à payer of the régime of art. 39-1-1° bis, 1er
 *   alinéa du CGI, not followed by Kledg;
 * - cadre III: dotations and reprises of the year of the provisions the
 *   register marks non deductible (CGI art. 39, 1-5° and 39, 2), in the
 *   slots of the form (8X to 9C for provisions pour risques et charges, 9D
 *   to 9J for dépréciations; more provisions are added up in the last slot,
 *   the form asks for the detail "sur feuillet séparé"); charges à payer
 *   non déductibles (9K to 9T) are not known. Totals YN and YO go to lines
 *   WI and WU of 2058-A-SD.
 *
 * Box codes: form n° 2058-B-SD 2026 and notice n° 2032-NOT-SD.
 */

import { amount, cell, field, manual, sumCells, type LiasseCell, type LiasseForm, type LiasseRow } from './cells'
import { deficitsSection, type DeficitCodes, type DeficitsInput } from './deficits'
import type { ProvisionRegisterItem } from './provisions'

export const DEFICIT_CODES_2058B: DeficitCodes = { opening: 'K4', transferred: 'K4 bis', operations: 'K4 ter', imputed: 'K5', reportable: 'K6', created: 'YJ', total: 'YK' }

const RISK_SLOTS: ReadonlyArray<[string, string]> = [
  ['8X', '8Y'],
  ['8Z', '9A'],
  ['9B', '9C'],
]
const IMPAIRMENT_SLOTS: ReadonlyArray<[string, string]> = [
  ['9D', '9E'],
  ['9F', '9G'],
  ['9H', '9J'],
]
const ACCRUAL_SLOTS: ReadonlyArray<[string, string]> = [
  ['9K', '9L'],
  ['9M', '9N'],
  ['9P', '9R'],
  ['9S', '9T'],
]

export interface Form2058BInput {
  deficits: DeficitsInput | null
  deficitsWhy: string
  register: readonly ProvisionRegisterItem[]
}

/** The provisions of a kind in the slots of the form: one per slot, the rest added up in the last one. */
function slotRows(prefix: string, items: readonly ProvisionRegisterItem[], slots: ReadonlyArray<[string, string]>, empty: string): LiasseRow[] {
  return slots.map(([dotationBox, repriseBox], i) => {
    const last = i === slots.length - 1
    const here = last ? items.slice(i) : items.slice(i, i + 1)
    if (here.length === 0) {
      return { id: `${prefix}-${i}`, label: empty, cells: [cell(dotationBox, 'Dotation de l\'exercice', amount(0), 'record'), cell(repriseBox, "Reprises sur l'exercice", amount(0), 'record')] }
    }
    const dotation = here.reduce((s, p) => s + Math.max(p.movementCents, 0), 0)
    const reprise = here.reduce((s, p) => s + Math.max(-p.movementCents, 0), 0)
    const label = here.length === 1 ? here[0].label : `${here.length} provisions (détail sur feuillet séparé) : ${here.map((p) => p.label).join(', ')}`
    const accounts = [...new Set(here.map((p) => p.accountCode))]
    return {
      id: `${prefix}-${i}`,
      label,
      cells: [
        cell(dotationBox, "Dotation de l'exercice", amount(dotation), 'record', { accounts, note: 'Provision marquée non déductible dans le registre des provisions.' }),
        cell(repriseBox, "Reprises sur l'exercice", amount(reprise), 'record', { accounts }),
      ],
    }
  })
}

export function buildForm2058B(input: Form2058BInput): LiasseForm {
  const deficits = deficitsSection('deficits', 'I. Suivi des déficits', DEFICIT_CODES_2058B, input.deficits, input.deficitsWhy)
  const nonDeductible = input.register.filter((p) => !p.taxDeductible && p.movementCents !== 0)
  const risks = nonDeductible.filter((p) => p.category === 'RISK_CHARGE')
  const impairments = nonDeductible.filter((p) => p.category !== 'RISK_CHARGE')

  const paidLeave: LiasseRow = {
    id: 'paid-leave',
    label: 'Indemnités pour congés à payer, charges sociales et fiscales correspondantes non déductibles (article 39-1-1° bis, 2e alinéa du CGI)',
    cells: [
      manual('ZV', "Dotation de l'exercice", "Seulement pour les entreprises placées sous le régime optionnel de l'article 39-1-1° bis, 2e alinéa du CGI."),
      manual('ZW', "Reprises sur l'exercice", 'Voir la case ZV.'),
    ],
  }
  const accruals: LiasseRow[] = ACCRUAL_SLOTS.map(([d, r], i) => ({
    id: `accrual-${i}`,
    label: 'Charges à payer non déductibles',
    cells: [manual(d, "Dotation de l'exercice", "Kledg ne sait pas quelles charges à payer ne sont pas déductibles : ajoutez-les s'il y en a."), manual(r, "Reprises sur l'exercice", 'Voir la dotation.')],
  }))
  const rows: LiasseRow[] = [
    paidLeave,
    ...slotRows('risks', risks, RISK_SLOTS, 'Provisions pour risques et charges (aucune non déductible au registre)'),
    ...slotRows('impairments', impairments, IMPAIRMENT_SLOTS, 'Provisions pour dépréciation (aucune non déductible au registre)'),
    ...accruals,
  ]
  const column = (i: number) => rows.map((r) => r.cells[i])
  const yn = sumCells('YN', "Total des dotations, à reporter ligne WI du tableau n° 2058-A-SD", column(0), 'record')
  const yo = sumCells('YO', 'Total des reprises, à reporter ligne WU du tableau n° 2058-A-SD', column(1), 'record')
  rows.push({ id: 'totals', label: 'Totaux', total: true, cells: [yn, yo] })

  const components: LiasseCell[] = [
    manual('L1', 'Conséquences de la méthode par composants (art. 237 septies du CGI) : montant de la réintégration ou de la déduction', 'Seulement pour la première application de la méthode par composants.'),
  ]
  const dotations = risks.concat(impairments).reduce((s, p) => s + Math.max(p.movementCents, 0), 0)
  const reprises = risks.concat(impairments).reduce((s, p) => s + Math.max(-p.movementCents, 0), 0)
  return {
    id: '2058-B',
    number: '2058-B-SD',
    title: 'Déficits, indemnités pour congés à payer et provisions non déductibles',
    sections: [
      deficits,
      {
        id: 'paid-leave-deductible',
        title: 'II. Indemnités pour congés à payer, charges sociales et fiscales correspondantes',
        columns: null,
        rows: [field('zt', manual('ZT', "Montant déductible correspondant aux droits acquis par les salariés (article 39-1-1° bis, 1er alinéa du CGI), dotations de l'exercice", 'Seulement pour les entreprises placées sous ce régime.'))],
      },
      { id: 'non-deductible', title: "III. Provisions et charges à payer, non déductibles pour l'assiette de l'impôt", columns: ["Dotation de l'exercice", "Reprises sur l'exercice"], rows },
      { id: 'components', title: 'Conséquences de la méthode par composants', columns: null, rows: components.map((c, i) => field(`components-${i}`, c)) },
    ],
    checks: [],
    warnings: [
      ...(dotations > 0 ? ['Les dotations non déductibles (YN) se réintègrent ligne WI du 2058-A-SD : ajoutez-les sur la page Impôt sur les sociétés si elles n\'y sont pas.'] : []),
      ...(reprises > 0 ? ['Les reprises de provisions non déductibles (YO), déjà taxées, se déduisent ligne WU du 2058-A-SD : ajoutez-les sur la page Impôt sur les sociétés.'] : []),
    ],
    required: { value: true, reason: null },
  }
}
