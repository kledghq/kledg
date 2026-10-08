/**
 * The reintegrations and deductions Kledg can read with certainty in the
 * books of a fiscal year, and the manual lines the user adds. Pure: the
 * loader passes the balances of the accounts (closing entry excluded) and
 * the dividends received from subsidiaries.
 *
 * Read from the accounts, only what the account says for sure:
 * - 695 impôts sur les bénéfices (6954, impôts dus à l'étranger, aside: a
 *   foreign tax may give a credit instead) and 696 suppléments d'IS liés
 *   aux distributions: never deductible (CGI art. 213, and art. 235 ter ZC
 *   for the contribution sociale). A credit balance (an IS provision
 *   reversed) is deducted. 2033-B-SD 324, 2058-A-SD I7.
 * - 63514 taxe sur les véhicules des sociétés: the annual taxes on vehicles
 *   of CIBS art. L. 421-94 are not deductible (CGI art. 213). 2033-B 324,
 *   2058-A WG.
 * - 6582 pénalités, amendes fiscales et pénales (PCG 2025), and 6712 of
 *   older charts: not deductible (CGI art. 39, 2). 2033-B 330, 2058-A WJ.
 *   The contractual penalties (6581, 6711 of older charts) stay deductible.
 * - 699 produits, reports en arrière des déficits: the carry-back credit is
 *   not taxable (CGI art. 220 quinquies). 2033-B 350, 2058-A XG (ZI).
 * Not read, because the account alone does not say it: réceptions (6257),
 * gifts, vehicle depreciation above the ceilings of art. 39-4 (needs the
 * CO2 rate), sumptuary expenses: manual lines, flagged by the checks when
 * the account moved.
 *
 * Parent-subsidiary regime (CGI art. 145 and 216; BOI-IS-BASE-10-10): the
 * dividends (761) received from a subsidiary the company holds for 5 % at
 * least, as the group data records it, are deducted, and a quote-part de
 * frais et charges of 5 % of them is reintegrated. Kledg cannot check that
 * the titres are nominatifs and kept two years: the line says so. Other
 * dividends stay taxable unless the user adds a manual line.
 */

import type { AccountTotals } from '@/lib/reports/statements/allocation'
import type { Adjustment, CreditLine } from './compute'
import { mulDivRound, PARENT_QUOTE_PART_BP, PARENT_SUBSIDIARY_MIN_STAKE_BP } from './rules'

const debitBalance = (accounts: readonly AccountTotals[], test: (code: string) => boolean) =>
  accounts.filter((a) => test(a.code)).reduce((s, a) => s + a.debitCents - a.creditCents, 0)

const isIncomeTax = (code: string) => (code.startsWith('695') && !code.startsWith('6954')) || code.startsWith('696')
const isVehicleTax = (code: string) => code.startsWith('63514')
const isPenalty = (code: string) => code.startsWith('6582') || code.startsWith('6712')
const isCarryBack = (code: string) => code.startsWith('699')

/** A reintegration for a debit balance, a deduction for a credit one; nothing at zero. */
function signed(base: Omit<Adjustment, 'kind' | 'amountCents'>, debitCents: number, onCredit: Pick<Adjustment, 'label' | 'form' | 'hint'> | null): Adjustment | null {
  if (debitCents > 0) return { ...base, kind: 'reintegration', amountCents: debitCents }
  if (debitCents < 0 && onCredit) return { ...base, ...onCredit, kind: 'deduction', amountCents: -debitCents }
  return null
}

export function bookAdjustments(accounts: readonly AccountTotals[]): Adjustment[] {
  const out: Array<Adjustment | null> = [
    signed(
      {
        id: 'books-income-tax',
        origin: 'books',
        label: 'Impôt sur les sociétés comptabilisé (comptes 695 et 696)',
        form: { simplified: '324', normal: 'I7' },
        source: 'cgi213',
        hint: 'L’impôt sur les sociétés et la contribution sociale ne sont pas déductibles de leur propre base.',
      },
      debitBalance(accounts, isIncomeTax),
      {
        label: 'Reprise d’impôt sur les sociétés (comptes 695 et 696 créditeurs)',
        form: { simplified: '350', normal: 'XG' },
        hint: 'Un impôt comptabilisé en trop puis repris n’est pas un produit imposable.',
      },
    ),
    signed(
      {
        id: 'books-vehicle-tax',
        origin: 'books',
        label: 'Taxes sur les véhicules des sociétés (compte 63514)',
        form: { simplified: '324', normal: 'WG' },
        source: 'cgi213',
        hint: 'Les taxes annuelles sur les véhicules (CIBS, art. L. 421-94) ne sont pas déductibles.',
      },
      debitBalance(accounts, isVehicleTax),
      null,
    ),
    signed(
      {
        id: 'books-penalties',
        origin: 'books',
        label: 'Pénalités, amendes fiscales et pénales (compte 6582, ou 6712)',
        form: { simplified: '330', normal: 'WJ' },
        source: 'cgi39',
        hint: 'Les sanctions pécuniaires et pénalités mises à la charge des contrevenants à des obligations légales ne sont pas déductibles. Les pénalités contractuelles (6581) le restent.',
      },
      debitBalance(accounts, isPenalty),
      null,
    ),
  ]
  const carryBack = -debitBalance(accounts, isCarryBack)
  if (carryBack > 0) {
    out.push({
      id: 'books-carry-back',
      kind: 'deduction',
      origin: 'books',
      label: 'Créance de report en arrière des déficits (compte 699)',
      amountCents: carryBack,
      form: { simplified: '350', normal: 'XG' },
      source: null,
      hint: 'La créance née du report en arrière n’est pas imposable (CGI, art. 220 quinquies).',
    })
  }
  return out.filter((a): a is Adjustment => a !== null)
}

/** Dividends received from a company of the group, with the stake the group data records. */
export interface SubsidiaryDividend {
  subsidiaryId: string
  name: string
  /** Stake in basis points of a percent (500 = 5 %). */
  stakeBp: number
  dividendsCents: number
}

/** The deduction of the dividends of qualifying subsidiaries and the reintegration of the 5 % quote-part. */
export function parentSubsidiaryAdjustments(dividends: readonly SubsidiaryDividend[]): { adjustments: Adjustment[]; qualifying: SubsidiaryDividend[] } {
  const qualifying = dividends.filter((d) => d.stakeBp >= PARENT_SUBSIDIARY_MIN_STAKE_BP && d.dividendsCents > 0)
  const total = qualifying.reduce((s, d) => s + d.dividendsCents, 0)
  if (total === 0) return { adjustments: [], qualifying: [] }
  const names = qualifying.map((d) => `${d.name} (${(d.stakeBp / 100).toLocaleString('fr-FR')} %)`).join(', ')
  return {
    qualifying,
    adjustments: [
      {
        id: 'group-dividends',
        kind: 'deduction',
        origin: 'group',
        label: 'Dividendes de filiales, régime des sociétés mères',
        amountCents: total,
        form: { simplified: '350', normal: 'XA' },
        source: 'cgi145',
        hint: `Filiales détenues à 5 % au moins d’après les associés enregistrés : ${names}. À vérifier : titres nominatifs, conservés deux ans, option pour le régime sur la déclaration.`,
      },
      {
        id: 'group-quote-part',
        kind: 'reintegration',
        origin: 'group',
        label: 'Quote-part de frais et charges de 5 % sur ces dividendes',
        amountCents: mulDivRound(total, PARENT_QUOTE_PART_BP, 10_000),
        form: { simplified: '330', normal: 'XA' },
        source: 'cgi216',
        hint: 'Sur la 2058-A, ligne XA, les dividendes sont portés nets de la quote-part (case 2A). 1 % au lieu de 5 % dans un groupe intégré : non couvert.',
      },
    ],
  }
}

export type ManualKind = 'reintegration' | 'deduction' | 'credit'

export interface ManualLine {
  id: string
  kind: ManualKind
  label: string
  amountCents: number
}

/** Manual lines of the user as adjustments of the worksheet, and the credits d'impôt apart. */
export function manualAdjustments(lines: readonly ManualLine[]): { adjustments: Adjustment[]; credits: CreditLine[] } {
  const adjustments: Adjustment[] = []
  const credits: CreditLine[] = []
  for (const line of lines) {
    if (line.kind === 'credit') {
      credits.push({ id: line.id, label: line.label, amountCents: line.amountCents })
      continue
    }
    adjustments.push({
      id: `manual-${line.id}`,
      kind: line.kind,
      origin: 'manual',
      label: line.label,
      amountCents: line.amountCents,
      form: { simplified: line.kind === 'reintegration' ? '330' : '350', normal: line.kind === 'reintegration' ? 'WQ' : 'XG' },
      source: null,
      hint: 'Ligne ajoutée à la main. Portez-la sur la ligne du formulaire qui lui correspond ; à défaut, sur les lignes « divers ».',
    })
  }
  return { adjustments, credits }
}
