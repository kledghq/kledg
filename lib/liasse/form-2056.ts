/**
 * Form 2056-SD 2026, "Provisions inscrites au bilan" (régime réel normal,
 * CGI art. 53 A), on plain values (pure, amounts in cents). Same reading of
 * the entries as the relevé of the régime simplifié (provisions.ts): the
 * opening entry gives the start, credits are dotations, debits reprises, an
 * entry cancelled by its contre-passation of the same year is left out.
 *
 * Accounts (PCG art. 932-1 as amended by règlement ANC 2022-06), the most
 * specific prefix wins: 143 hausse des prix, 145 amortissements dérogatoires,
 * other 14 autres provisions réglementées; 1511 litiges, 1512 garanties,
 * 1514 amendes et pénalités, 1515 pertes de change, 1521 pensions, 1523
 * impôts, 1524 renouvellement des immobilisations, 1525 gros entretien,
 * other 15 autres provisions pour risques et charges; 290 dépréciations des
 * immobilisations incorporelles, 291 to 293 corporelles, 2961 titres de
 * participation, other 29 autres immobilisations financières, 39
 * stocks, 491 comptes clients, other 49 and 59 autres dépréciations.
 *
 * Lines without an account of their own in the chart (gisements miniers,
 * provisions pour investissement, prêts d'installation, charges sociales et
 * fiscales sur congés à payer, titres mis en équivalence) are zero when the
 * line that holds the rest of their accounts is empty, else to fill by
 * hand: Kledg cannot tell them apart.
 *
 * "Dont dotations et reprises" (UE to UK) is read in the income statement:
 * 6815, 6816, 6817 and 7815, 7816, 7817 (exploitation), 6865, 6866 and 7865,
 * 7866 (financières), 6872 to 6876 and 7872 to 7876 (exceptionnelles); the
 * dotations of the relevé (UB) and its reprises (UC) are checked against
 * them.
 *
 * Box codes: form n° 2056-SD 2026 (liasse 2050, impots.gouv.fr), the digit
 * zero printed "Ø" written "0"; notice n° 2032-NOT-SD.
 */

import { amount, cell, manual, type LiasseCell, type LiasseForm, type LiasseRow } from './cells'
import {
  gridRow,
  provisionChecks,
  provisionTotals,
  PROVISION_COLUMN_LABELS,
  PROVISION_COLUMNS,
  type ProvisionColumn,
  type ProvisionDef,
  type ProvisionsInput,
} from './provisions'

const c = (opening: string, increase: string, decrease: string, closing: string): Record<ProvisionColumn, string> => ({ opening, increase, decrease, closing })
const line = (id: string, label: string, prefixes: string[], codes: Record<ProvisionColumn, string>): ProvisionDef => ({ kind: 'line', id, label, prefixes, codes })
const total = (id: string, label: string, of: string[], codes: Record<ProvisionColumn, string>): ProvisionDef => ({ kind: 'total', id, label, of, codes })

const REGULATED = ['mining', 'investment', 'priceIncrease', 'derogatory', 'installationLoans', 'otherRegulated']
const RISKS = ['litigation', 'guarantees', 'fines', 'exchange', 'pensions', 'taxes', 'renewal', 'maintenance', 'paidLeave', 'otherRisks']
const IMPAIRMENTS = ['intangible', 'tangible', 'equityMethod', 'participations', 'otherFinancial', 'inventory', 'customers', 'otherImpairment']

/** Form 2056-SD 2026. "Dont majorations exceptionnelles de 30 %" (D3 to D6) is added by the builder. */
export const PROVISIONS_2056: readonly ProvisionDef[] = [
  line('mining', 'Provisions pour reconstitution des gisements miniers et pétroliers', [], c('3T', 'TA', 'TB', 'TC')),
  line('investment', 'Provisions pour investissement (art. 237 bis A-II du CGI)', [], c('3U', 'TD', 'TE', 'TF')),
  line('priceIncrease', 'Provisions pour hausse des prix', ['143'], c('3V', 'TG', 'TH', 'TI')),
  line('derogatory', 'Amortissements dérogatoires', ['145'], c('3X', 'TM', 'TN', 'TO')),
  line('installationLoans', "Provisions pour prêts d'installation (art. 39 quinquies H du CGI)", [], c('IJ', 'IK', 'IL', 'IM')),
  line('otherRegulated', 'Autres provisions réglementées', ['14'], c('3Y', 'TP', 'TQ', 'TR')),
  total('regulatedTotal', 'Total I (provisions réglementées)', REGULATED, c('3Z', 'TS', 'TT', 'TU')),
  line('litigation', 'Provisions pour litiges', ['1511'], c('4A', '4B', '4C', '4D')),
  line('guarantees', 'Provisions pour garanties données aux clients', ['1512'], c('4E', '4F', '4G', '4H')),
  line('fines', 'Provisions pour amendes et pénalités', ['1514'], c('4N', '4P', '4R', '4S')),
  line('exchange', 'Provisions pour pertes de change', ['1515'], c('4T', '4U', '4V', '4W')),
  line('pensions', 'Provisions pour pensions et obligations similaires', ['1521'], c('4X', '4Y', '4Z', '5A')),
  line('taxes', 'Provisions pour impôts', ['1523'], c('5B', '5C', '5D', '5E')),
  line('renewal', 'Provisions pour renouvellement des immobilisations', ['1524'], c('5F', '5H', '5J', '5K')),
  line('maintenance', 'Provisions pour gros entretien et grandes révisions', ['1525'], c('EO', 'EP', 'EQ', 'ER')),
  line('paidLeave', 'Provisions pour charges sociales et fiscales sur congés à payer', [], c('5R', '5S', '5T', '5U')),
  line('otherRisks', 'Autres provisions pour risques et charges', ['15'], c('5V', '5W', '5X', '5Y')),
  total('risksTotal', 'Total II (provisions pour risques et charges)', RISKS, c('5Z', 'TV', 'TW', 'TX')),
  line('intangible', 'Provisions pour dépréciation sur immobilisations incorporelles', ['290'], c('6A', '6B', '6C', '6D')),
  line('tangible', 'Provisions pour dépréciation sur immobilisations corporelles', ['291', '292', '293'], c('6E', '6F', '6G', '6H')),
  line('equityMethod', 'Provisions pour dépréciation sur titres mis en équivalence', [], c('02', '03', '04', '05')),
  line('participations', 'Provisions pour dépréciation sur titres de participation', ['2961'], c('9U', '9V', '9W', '9X')),
  line('otherFinancial', 'Provisions pour dépréciation sur autres immobilisations financières', ['29'], c('06', '07', '08', '09')),
  line('inventory', 'Provisions pour dépréciation sur stocks et en cours', ['39'], c('6N', '6P', '6R', '6S')),
  line('customers', 'Provisions pour dépréciation sur comptes clients', ['491'], c('6T', '6U', '6V', '6W')),
  line('otherImpairment', 'Autres provisions pour dépréciation', ['49', '59'], c('6X', '6Y', '6Z', '7A')),
  total('impairmentTotal', 'Total III (provisions pour dépréciation)', IMPAIRMENTS, c('7B', 'TY', 'TZ', 'UA')),
  total('grandTotal', 'Total général (I + II + III)', [...REGULATED, ...RISKS, ...IMPAIRMENTS], c('7C', 'UB', 'UC', 'UD')),
]

/** Lines without an account of their own, and the line that holds the rest of their accounts. */
const SHARED_WITH: Record<string, string> = { mining: 'otherRegulated', investment: 'otherRegulated', installationLoans: 'otherRegulated', paidLeave: 'otherRisks' }

export function buildForm2056(input: ProvisionsInput): LiasseForm {
  const totals = provisionTotals(PROVISIONS_2056, input.movements)
  const empty = (id: string) => PROVISION_COLUMNS.every((col) => totals.get(id)![col] === 0)
  const rows: LiasseRow[] = []
  for (const def of PROVISIONS_2056) {
    const shared = SHARED_WITH[def.id]
    if (def.id === 'equityMethod') {
      rows.push({
        id: def.id,
        label: def.label,
        cells: PROVISION_COLUMNS.map((col) => cell(def.codes[col], PROVISION_COLUMN_LABELS[col], amount(0), 'books', { note: "Le plan de comptes de Kledg n'a pas de compte de titres mis en équivalence." })),
      })
    } else if (shared && !empty(shared)) {
      rows.push({
        id: def.id,
        label: def.label,
        cells: PROVISION_COLUMNS.map((col) =>
          manual(def.codes[col], PROVISION_COLUMN_LABELS[col], `Ces provisions n'ont pas de compte propre : la ligne « ${PROVISIONS_2056.find((d) => d.id === shared)!.label} » comprend tout le compte. Ventilez-la si la société en a.`),
        ),
      })
    } else if (shared) {
      rows.push({
        id: def.id,
        label: def.label,
        cells: PROVISION_COLUMNS.map((col) => cell(def.codes[col], PROVISION_COLUMN_LABELS[col], amount(0), 'books', { note: 'Aucun mouvement sur la ligne qui en comprend les comptes.' })),
      })
    } else {
      rows.push(gridRow(def, totals.get(def.id)!))
    }
    if (def.id === 'derogatory') {
      const codes = c('D3', 'D4', 'D5', 'D6')
      const none = empty('derogatory')
      rows.push({
        id: 'exceptional30',
        label: 'Dont majorations exceptionnelles de 30 %',
        cells: PROVISION_COLUMNS.map(
          (col): LiasseCell =>
            none
              ? cell(codes[col], PROVISION_COLUMN_LABELS[col], amount(0), 'books', { note: 'Aucun amortissement dérogatoire dans les écritures (compte 145).' })
              : manual(codes[col], PROVISION_COLUMN_LABELS[col], 'Kledg ne distingue pas les majorations exceptionnelles de 30 % dans le compte 145 : indiquez la part qui en relève.'),
        ),
      })
    }
  }

  const is = input.incomeStatement
  const split: LiasseRow[] = is
    ? [
        { id: 'operating', label: "Dont dotations et reprises d'exploitation", cells: [cell('UE', 'Dotations', amount(is.operating.dotationsCents), 'books', { accounts: ['6815', '6816', '6817'] }), cell('UF', 'Reprises', amount(is.operating.reprisesCents), 'books', { accounts: ['7815', '7816', '7817'] })] },
        { id: 'financial', label: 'Dont dotations et reprises financières', cells: [cell('UG', 'Dotations', amount(is.financial.dotationsCents), 'books', { accounts: ['6865', '6866'] }), cell('UH', 'Reprises', amount(is.financial.reprisesCents), 'books', { accounts: ['7865', '7866'] })] },
        {
          id: 'exceptional',
          label: 'Dont dotations et reprises exceptionnelles',
          cells: [
            cell('UJ', 'Dotations', amount(is.exceptional.dotationsCents), 'books', { accounts: ['6872', '6873', '6874', '6875', '6876'] }),
            cell('UK', 'Reprises', amount(is.exceptional.reprisesCents), 'books', { accounts: ['7872', '7873', '7874', '7875', '7876'] }),
          ],
        },
      ]
    : []
  const { checks, warnings } = provisionChecks(PROVISIONS_2056, totals, input)
  return {
    id: '2056',
    number: '2056-SD',
    title: 'Provisions inscrites au bilan',
    sections: [
      { id: 'provisions', title: 'Provisions inscrites au bilan', columns: PROVISION_COLUMNS.map((col) => PROVISION_COLUMN_LABELS[col]), rows },
      { id: 'split', title: 'Dont dotations et reprises', columns: ['Dotations', 'Reprises'], rows: split },
      {
        id: 'equity-method',
        title: 'Titres mis en équivalence',
        columns: null,
        rows: [
          {
            id: 'equity-method-10',
            label: "Montant de la dépréciation à la clôture de l'exercice calculé selon les règles prévues à l'article 39-1-5ème du CGI",
            cells: [manual('10', "Montant de la dépréciation à la clôture de l'exercice calculé selon les règles prévues à l'article 39-1-5ème du CGI", 'Seulement pour des titres mis en équivalence.')],
          },
        ],
      },
    ],
    checks,
    warnings,
    required: { value: true, reason: null },
  }
}
