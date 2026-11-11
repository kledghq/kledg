/**
 * "Détermination des effectifs et de la valeur ajoutée": form 2033-E-SD
 * (régime simplifié) and form 2059-E-SD (régime normal), 2026, on plain
 * values (pure, amounts in cents). Same lines on both forms, different box
 * codes.
 *
 * Read in the balances of the income statement accounts of the year
 * (closing entry excluded), with the accounts named by the notice
 * 2033-NOT-SD (BOI-CVAE-BASE-20):
 * - ventes, prestations et marchandises (108 / OA): 701 to 709, so the
 *   rabais of 709 reduce it;
 * - redevances (118 / OK): 751;
 * - autres produits de gestion courante (115 / OH): 752 to 758 except 755;
 * - subventions d'exploitation (113 / OF): 74;
 * - variation des stocks (111 / OD positive, 145 / OQ negative): the balance
 *   of 603 and 713 taken together;
 * - achats (121 / ON): 601 to 609 except 603;
 * - services extérieurs except rents (125 / OR): 61 and 62 except 612 and
 *   613 (rents and redevances of crédit-bail have a line of their own,
 *   310 / OS, on the form);
 * - autres charges de gestion courante (148 / OW): 651 to 658 except 655.
 * What depends on facts the accounts do not hold is to fill by hand, with
 * the balance of the accounts concerned as a hint: plus-values of
 * disposals in the normal course of business (119 / OL), production
 * immobilisée within its deductible charges (143 / OE, 128 / OU), rentrées
 * sur créances amorties (153 / XT), rents of goods leased for more than six
 * months (310 / OS), taxes deductible from the value added (133 / OZ),
 * depreciation of goods leased out (135 / O9), moins-values (150 / OY),
 * the value added subject to CVAE (117 / SA) and the CVAE frame.
 *
 * The headcount (376 / YP) is the average of the headcounts at the end of
 * each quarter (notice 2033-NOT-SD): the one answered on the annexe or the
 * approval of the accounts, else to fill by hand.
 *
 * The form is due when the chiffre d'affaires of the year, ramené à douze
 * mois, exceeds 152 500 € HT (notice 2033-NOT-SD, "Les informations du
 * formulaire n° 2033-E-SD doivent être fournies lorsque le chiffre
 * d'affaires [...] est supérieur à 152 500 € HT").
 */

import { annualize, type FiscalYearDuration } from '@/lib/corporate-tax/rules'
import type { AccountTotals } from '@/lib/reports/statements/allocation'
import { formatCentsFr } from '@/lib/utils/money'
import { amount, cell, count, field, manual, months, sumCells, text, type LiasseCell, type LiasseForm, type LiasseRow } from './cells'

/** Chiffre d'affaires above which the form is due (notice 2033-NOT-SD), in cents. */
export const VALUE_ADDED_TURNOVER_THRESHOLD_CENTS = 15_250_000

export interface ValueAddedCodes {
  employees: string
  apprentices: string
  disabled: string
  craft: string
  sales: string
  royalties: string
  gains: string
  total1: string
  otherIncome: string
  capitalized: string
  subsidies: string
  stockIncrease: string
  recoveries: string
  total2: string
  purchases: string
  stockDecrease: string
  external: string
  rents: string
  taxes: string
  otherCharges: string
  capitalizedCharges: string
  leasedDepreciation: string
  losses: string
  total3: string
  valueAdded: string
  cvae: string
  mono: string
  turnover12: string
  cvaeEmployees: string
  groupTurnover: string
  periodStart: string
  periodEnd: string
  /** Date de cessation: printed without a code on 2033-E-SD. */
  cessation: string | null
}

/** 2059-E-SD 2026. */
export const VALUE_ADDED_CODES_2059E: ValueAddedCodes = {
  employees: 'YP',
  apprentices: 'YF',
  disabled: 'YG',
  craft: 'RL',
  sales: 'OA',
  royalties: 'OK',
  gains: 'OL',
  total1: 'OX',
  otherIncome: 'OH',
  capitalized: 'OE',
  subsidies: 'OF',
  stockIncrease: 'OD',
  recoveries: 'XT',
  total2: 'OM',
  purchases: 'ON',
  stockDecrease: 'OQ',
  external: 'OR',
  rents: 'OS',
  taxes: 'OZ',
  otherCharges: 'OW',
  capitalizedCharges: 'OU',
  leasedDepreciation: 'O9',
  losses: 'OY',
  total3: 'OJ',
  valueAdded: 'OG',
  cvae: 'SA',
  mono: 'EV',
  turnover12: 'GX',
  cvaeEmployees: 'EY',
  groupTurnover: 'HX',
  periodStart: 'GY',
  periodEnd: 'GZ',
  cessation: 'HR',
}

export const VALUE_ADDED_CODES_2033E: ValueAddedCodes = {
  employees: '376',
  apprentices: '657',
  disabled: '651',
  craft: '861',
  sales: '108',
  royalties: '118',
  gains: '119',
  total1: '106',
  otherIncome: '115',
  capitalized: '143',
  subsidies: '113',
  stockIncrease: '111',
  recoveries: '153',
  total2: '144',
  purchases: '121',
  stockDecrease: '145',
  external: '125',
  rents: '310',
  taxes: '133',
  otherCharges: '148',
  capitalizedCharges: '128',
  leasedDepreciation: '135',
  losses: '150',
  total3: '152',
  valueAdded: '137',
  cvae: '117',
  mono: '020',
  turnover12: '022',
  cvaeEmployees: '023',
  groupTurnover: '026',
  periodStart: '024',
  periodEnd: '016',
  cessation: null,
}

export interface ValueAddedInput {
  form: { id: string; number: string }
  /** Notice of the liasse, named in the explanations: 2033-NOT-SD or 2032-NOT-SD. */
  notice: string
  codes: ValueAddedCodes
  fiscalYear: { startDate: string; endDate: string }
  duration: FiscalYearDuration
  /** Balances of the year, closing entry excluded. */
  accounts: readonly AccountTotals[]
  /** Average headcount answered on the annexe or the approval, and where. */
  employees: { value: number; from: 'annexe' | 'approval' } | null
}

const matches = (code: string, prefixes: readonly string[]) => prefixes.some((p) => code.startsWith(p))

/** Credit minus debit (income) or debit minus credit (charges) of the accounts matching `prefixes` and not `except`. */
function balance(accounts: readonly AccountTotals[], prefixes: readonly string[], except: readonly string[], side: 'credit' | 'debit') {
  const list = accounts.filter((a) => matches(a.code, prefixes) && !matches(a.code, except))
  const credit = list.reduce((s, a) => s + a.creditCents - a.debitCents, 0)
  return { cents: side === 'credit' ? credit : -credit, accounts: list.filter((a) => a.debitCents !== 0 || a.creditCents !== 0).map((a) => a.code) }
}

const frDay = (iso: string) => iso.split('-').reverse().join('/')

export function buildValueAddedForm(input: ValueAddedInput): LiasseForm {
  const form = valueAddedForm(input)
  if (input.notice === '2033-NOT-SD') return form
  const swap = (t: string) => t.replaceAll('notice 2033-NOT-SD', `notice ${input.notice}`)
  return {
    ...form,
    sections: form.sections.map((sec) => ({ ...sec, rows: sec.rows.map((r) => ({ ...r, cells: r.cells.map((c) => (c.note ? { ...c, note: swap(c.note) } : c)) })) })),
    required: { ...form.required, reason: form.required.reason ? swap(form.required.reason) : null },
  }
}

function valueAddedForm(input: ValueAddedInput): LiasseForm {
  const { accounts, codes } = input
  const books = (box: string, label: string, prefixes: string[], except: string[], side: 'credit' | 'debit') => {
    const b = balance(accounts, prefixes, except, side)
    return cell(box, label, amount(b.cents), 'books', { accounts: b.accounts })
  }
  const hintOf = (prefixes: string[], except: string[], side: 'credit' | 'debit') => {
    const b = balance(accounts, prefixes, except, side)
    return b.cents !== 0 ? amount(b.cents) : undefined
  }

  // Header and headcount
  const header: LiasseCell[] = [
    cell(null, 'Exercice ouvert le', text(frDay(input.fiscalYear.startDate)), 'record'),
    cell(null, 'Et clos le', text(frDay(input.fiscalYear.endDate)), 'record'),
    input.duration.months !== null
      ? cell(null, 'Données en nombre de mois', months(input.duration.months), 'record')
      : manual(null, 'Données en nombre de mois', `L'exercice ne couvre pas des mois entiers (${input.duration.days} jours) : indiquez sa durée en mois.`),
  ]
  const headcount: LiasseCell[] = [
    input.employees
      ? cell(codes.employees, 'Effectif moyen du personnel', count(input.employees.value), 'answer', {
          note: input.employees.from === 'annexe' ? "Effectif répondu dans l'annexe." : 'Effectif répondu sur la page Approbation des comptes.',
        })
      : manual(codes.employees, 'Effectif moyen du personnel', "Moyenne des effectifs à la fin de chaque trimestre de l'exercice (notice 2033-NOT-SD) : indiquez-le dans l'annexe ou sur la page Approbation des comptes."),
    manual(codes.apprentices, 'Dont apprentis', 'Kledg ne connaît pas les contrats de travail.'),
    manual(codes.disabled, 'Dont handicapés', 'Personnes reconnues par la CDAPH : Kledg ne les connaît pas.'),
    manual(codes.craft, "Effectifs affectés à l'activité artisanale", 'Utile à une exonération ou une réduction de CFE (notice 2033-NOT-SD).'),
  ]

  // I. Chiffre d'affaires de référence CVAE
  const sales = books(codes.sales, 'Ventes de produits fabriqués, prestations de services et marchandises', ['70'], [], 'credit')
  const royalties = books(codes.royalties, 'Redevances pour concessions, brevets, licences et assimilées', ['751'], [], 'credit')
  const gains = manual(
    codes.gains,
    "Plus-values de cession d'immobilisations corporelles ou incorporelles si rattachées à une activité normale et courante",
    "Seules les cessions qui entrent dans le cycle de production comptent ici : Kledg ne peut pas le savoir. Les produits et valeurs comptables des cessions courantes (757, 657) sont déjà dans les lignes des autres produits et des autres charges de gestion courante.",
  )
  const total1 = sumCells(codes.total1, 'Total 1', [sales, royalties, gains])

  // II. Autres produits
  const stock = balance(accounts, ['603', '713'], [], 'credit')
  const otherIncome = books(
    codes.otherIncome,
    "Autres produits de gestion courante (hors quotes-parts de résultat sur opérations faites en commun), y compris les plus-values de cession non rattachées à une activité normale et courante",
    ['752', '753', '754', '756', '757', '758'],
    [],
    'credit',
  )
  const capitalized = manual(
    codes.capitalized,
    'Production immobilisée à hauteur des seules charges déductibles ayant concouru à sa formation',
    'Seules les charges déductibles de la valeur ajoutée comptent : le compte 72 seul ne le dit pas.',
    hintOf(['72'], [], 'credit'),
  )
  const subsidies = books(codes.subsidies, "Subventions d'exploitation reçues et certains abandons de créances à caractère commercial", ['74'], [], 'credit')
  const stockIncrease = cell(codes.stockIncrease, 'Variation positive des stocks', amount(Math.max(stock.cents, 0)), 'books', { accounts: stock.accounts })
  const recoveries = manual(
    codes.recoveries,
    "Rentrées sur créances amorties lorsqu'elles se rapportent au résultat d'exploitation",
    'Kledg ne sait pas si la créance se rapporte au résultat d\'exploitation.',
    hintOf(['7714'], [], 'credit'),
  )
  const total2 = sumCells(codes.total2, 'Total 2', [otherIncome, capitalized, subsidies, stockIncrease, recoveries])

  // III. Charges
  const purchases = books(codes.purchases, 'Achats', ['60'], ['603'], 'debit')
  const stockDecrease = cell(codes.stockDecrease, 'Variation négative des stocks', amount(Math.max(-stock.cents, 0)), 'books', { accounts: stock.accounts })
  const external = books(codes.external, "Services extérieurs, à l'exception des loyers et des redevances", ['61', '62'], ['612', '613'], 'debit')
  const rents = manual(
    codes.rents,
    "Loyers et redevances, à l'exception de ceux afférents à des immobilisations corporelles mises à disposition dans le cadre d'une convention de location-gérance ou de crédit-bail ou encore d'une convention de location de plus de 6 mois",
    'Les loyers de biens corporels pris en location pour plus de six mois, en crédit-bail ou en location-gérance ne se déduisent pas : Kledg ne connaît pas la durée des contrats.',
    hintOf(['612', '613'], [], 'debit'),
  )
  const taxes = manual(
    codes.taxes,
    'Taxes déductibles de la valeur ajoutée',
    "Parmi les impôts et taxes (631 à 638), seules les taxes sur le chiffre d'affaires et assimilées et les contributions indirectes se déduisent.",
    hintOf(['63'], [], 'debit'),
  )
  const otherCharges = books(codes.otherCharges, 'Autres charges de gestion courante (hors quotes-parts de résultat sur opérations faites en commun)', ['651', '652', '653', '654', '656', '657', '658'], [], 'debit')
  const capitalizedCharges = manual(codes.capitalizedCharges, 'Charges déductibles de la valeur ajoutée afférente à la production immobilisée déclarée', 'Va avec la ligne de la production immobilisée.')
  const leasedDepreciation = manual(
    codes.leasedDepreciation,
    "Fraction déductible de la valeur ajoutée des dotations aux amortissements afférentes à des immobilisations corporelles mises à disposition dans le cadre d'une convention de location-gérance ou de crédit-bail ou encore d'une convention de location de plus de 6 mois",
    'Seulement pour les biens donnés en location plus de six mois, en crédit-bail ou en location-gérance.',
  )
  const losses = manual(
    codes.losses,
    "Moins-values de cession d'immobilisations corporelles ou incorporelles rattachées ou non à une activité normale et courante",
    'Différence entre la valeur comptable et le prix de chaque cession : Kledg ne rapproche pas les cessions une à une (les cessions courantes, 657 et 757, sont déjà dans les autres produits et charges de gestion courante).',
  )
  const total3 = sumCells(codes.total3, 'Total 3', [purchases, stockDecrease, external, rents, taxes, otherCharges, capitalizedCharges, leasedDepreciation, losses])

  // IV. Valeur ajoutée
  const t1 = total1.value?.kind === 'amount' ? total1.value.cents : 0
  const t2 = total2.value?.kind === 'amount' ? total2.value.cents : 0
  const t3 = total3.value?.kind === 'amount' ? total3.value.cents : 0
  const pending = [...(total1.pending ?? []), ...(total2.pending ?? []), ...(total3.pending ?? [])]
  const valueAdded: LiasseCell = { box: codes.valueAdded, label: 'Calcul de la valeur ajoutée (total 1 + total 2 - total 3)', value: amount(t1 + t2 - t3), source: 'books', ...(pending.length ? { pending } : {}) }

  // V. CVAE
  const cvae = [
    manual(codes.cvae, 'Valeur ajoutée assujettie à la CVAE', 'La valeur ajoutée diminuée des exonérations de plein droit de CFE (articles 1449 à 1463 B du CGI) ; 0 si elle est négative.'),
    manual(codes.mono, 'Mono-établissement au sens de la CVAE (case à cocher)', 'Conditions de la notice 1330-CVAE-SD.'),
    { ...cell(codes.turnover12, "Chiffre d'affaires de référence CVAE (report de la ligne du total 1, le cas échéant ajusté à 12 mois)", amount(annualize(t1, input.duration)), 'books'), ...(total1.pending ? { pending: total1.pending } : {}) },
    manual(codes.cvaeEmployees, 'Effectifs au sens de la CVAE', 'Notice 1330-CVAE-SD, répartition des salariés.'),
    manual(codes.groupTurnover, "Chiffre d'affaires du groupe économique (entreprises répondant aux conditions de détention fixées à l'article 223 A du CGI)", "Somme des chiffres d'affaires des sociétés du groupe économique."),
    cell(codes.periodStart, 'Période de référence : début', text(frDay(input.fiscalYear.startDate)), 'record', { note: "L'exercice de douze mois clos au cours de l'année d'imposition (notice 2033-NOT-SD)." }),
    cell(codes.periodEnd, 'Période de référence : fin', text(frDay(input.fiscalYear.endDate)), 'record'),
    manual(codes.cessation, 'Date de cessation', "Seulement en cas de cessation d'activité."),
  ]

  const turnover = balance(accounts, ['70'], [], 'credit').cents
  const annual = annualize(Math.max(turnover, 0), input.duration)
  const required = annual > VALUE_ADDED_TURNOVER_THRESHOLD_CENTS
  const fields = (prefix: string, list: LiasseCell[]): LiasseRow[] => list.map((c, i) => ({ ...field(`${prefix}-${i}`, c), total: c.label.startsWith('Total') || c === valueAdded }))
  return {
    id: input.form.id,
    number: input.form.number,
    title: 'Détermination des effectifs et de la valeur ajoutée',
    sections: [
      { id: 'header', title: 'Exercice', columns: null, rows: fields('header', header) },
      { id: 'headcount', title: 'Déclaration des effectifs', columns: null, rows: fields('headcount', headcount) },
      { id: 'turnover', title: "I. Chiffre d'affaires de référence CVAE", columns: null, rows: fields('turnover', [sales, royalties, gains, total1]) },
      { id: 'other-income', title: 'II. Autres produits à retenir pour le calcul de la valeur ajoutée', columns: null, rows: fields('other-income', [otherIncome, capitalized, subsidies, stockIncrease, recoveries, total2]) },
      {
        id: 'charges',
        title: 'III. Charges à retenir pour le calcul de la valeur ajoutée',
        columns: null,
        rows: fields('charges', [purchases, stockDecrease, external, rents, taxes, otherCharges, capitalizedCharges, leasedDepreciation, losses, total3]),
      },
      { id: 'value-added', title: 'IV. Valeur ajoutée produite', columns: null, rows: fields('value-added', [valueAdded]) },
      { id: 'cvae', title: 'V. Cotisation sur la valeur ajoutée des entreprises', columns: null, rows: fields('cvae', cvae) },
    ],
    checks: [],
    warnings: t1 + t2 - t3 < 0 ? ['La valeur ajoutée calculée est négative : la valeur ajoutée assujettie à la CVAE se déclare alors pour 0.'] : [],
    required: required
      ? { value: true, reason: null }
      : {
          value: false,
          reason: `Chiffre d'affaires ramené à douze mois de ${formatCentsFr(annual)}, inférieur ou égal à 152 500 € : les informations de ce tableau ne sont pas exigées (notice 2033-NOT-SD).`,
        },
  }
}
