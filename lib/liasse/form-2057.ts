/**
 * Form 2057-SD 2026, "État des échéances des créances et des dettes à la
 * clôture de l'exercice" (régime réel normal, CGI art. 53 A), on plain
 * values (pure, amounts in cents).
 *
 * Gross amounts (before impairment, notice 2032-NOT-SD: "pour leur montant
 * brut (avant provision)") are the balances of the accounts at the closing,
 * account by account: a debit balance is a receivable, a credit balance a
 * debt, with the same accounts as the état des créances and the état des
 * dettes of the annexe (lib/annexe/build-annexe.ts, PCG art. 832-9 and
 * 832-15), the most specific prefix choosing the line of the form.
 *
 * Maturities are not in the books: the part of the receivables at more than
 * one year, and of the debts at more than one and more than five years, is
 * the answer of the annexe. When the answer is zero, every line is due
 * within a year; otherwise the totals come from the answer and the split
 * line by line is to fill by hand. Without an answer, the split is asked.
 *
 * The bank debts split by their term at origin (VG one year at most, VH
 * more than one year): overdrafts (512, 514, 517, 519 in credit) are short
 * at origin; the loans of 164 are not known, so with a 164 balance both
 * boxes are to fill by hand.
 *
 * Box codes: form n° 2057-SD 2026 (liasse 2050, impots.gouv.fr). The form
 * prints codes for the gross amount of every line, for the split of the
 * three lines of financial assets (UL to US, UT to UW) and for the totals
 * (VT, VU, VV; VY, VZ); the other columns have no code.
 */

import type { AccountYear } from '@/lib/annexe/build-annexe'
import { formatCentsFr } from '@/lib/utils/money'
import { amount, cell, check, manual, sumCells, type LiasseCell, type LiasseCheck, type LiasseForm, type LiasseRow } from './cells'

interface LineDef {
  id: string
  label: string
  prefixes: readonly string[]
  /** Gross amount box, then the split boxes when the form prints them. */
  box: string | null
  split?: readonly [string, string]
}

const RECEIVABLES: readonly LineDef[] = [
  { id: 'participations', label: 'Créances rattachées à des participations', prefixes: ['267', '268'], box: 'UL', split: ['UM', 'UN'] },
  { id: 'loans', label: 'Prêts', prefixes: ['274'], box: 'UP', split: ['UR', 'US'] },
  { id: 'otherFinancial', label: 'Autres immobilisations financières', prefixes: ['27'], box: 'UT', split: ['UV', 'UW'] },
  { id: 'doubtful', label: 'Clients douteux ou litigieux', prefixes: ['416'], box: 'VA' },
  { id: 'customers', label: 'Autres créances clients', prefixes: ['41'], box: 'UX' },
  { id: 'staff', label: 'Personnel et comptes rattachés', prefixes: ['42'], box: 'UY' },
  { id: 'social', label: 'Sécurité sociale et autres organismes sociaux', prefixes: ['43'], box: 'UZ' },
  { id: 'incomeTax', label: 'État : impôts sur les bénéfices', prefixes: ['444'], box: 'VM' },
  { id: 'vat', label: 'État : taxe sur la valeur ajoutée', prefixes: ['445'], box: 'VB' },
  { id: 'otherTaxes', label: 'État : autres impôts, taxes et versements assimilés', prefixes: ['446', '447'], box: 'VN' },
  { id: 'stateOther', label: 'État et autres collectivités publiques : divers', prefixes: ['44'], box: 'VP' },
  { id: 'group', label: 'Groupe et associés', prefixes: ['45'], box: 'VC' },
  { id: 'sundry', label: 'Débiteurs divers (dont créances relatives à des opérations de pension de titres)', prefixes: ['46', '47'], box: 'VR' },
  { id: 'prepaid', label: "Charges constatées d'avance", prefixes: ['486'], box: 'VS' },
]
/** Not receivables: versements restant à effectuer (279), accrued interest of 2768 (with its asset), advances received (419), écarts de conversion (476, 477). */
const RECEIVABLE_EXCLUDED = ['279', '2768', '419', '476', '477']

const DEBTS: readonly LineDef[] = [
  { id: 'convertible', label: 'Emprunts obligataires convertibles', prefixes: ['161'], box: '7Y' },
  { id: 'bonds', label: 'Autres emprunts obligataires', prefixes: ['163'], box: '7Z' },
  { id: 'bank', label: 'Emprunts et dettes auprès des établissements de crédit', prefixes: ['164', '512', '514', '517', '519'], box: null },
  { id: 'financialOther', label: 'Emprunts et dettes financières divers', prefixes: ['165', '166', '167', '168', '17'], box: '8A' },
  { id: 'suppliers', label: 'Fournisseurs et comptes rattachés', prefixes: ['40'], box: '8B' },
  { id: 'staff', label: 'Personnel et comptes rattachés', prefixes: ['42'], box: '8C' },
  { id: 'social', label: 'Sécurité sociale et autres organismes sociaux', prefixes: ['43'], box: '8D' },
  { id: 'incomeTax', label: 'État : impôts sur les bénéfices', prefixes: ['444'], box: '8E' },
  { id: 'vat', label: 'État : taxe sur la valeur ajoutée', prefixes: ['445'], box: 'VW' },
  { id: 'otherTaxes', label: 'État : autres impôts, taxes et assimilés', prefixes: ['44'], box: 'VQ' },
  { id: 'fixedAssetDebts', label: 'Dettes sur immobilisations et comptes rattachés', prefixes: ['404', '405'], box: '8J' },
  { id: 'group', label: 'Groupe et associés', prefixes: ['45'], box: 'VI' },
  { id: 'otherDebts', label: 'Autres dettes (dont dettes relatives à des opérations de pension de titres)', prefixes: ['46', '47', '419'], box: '8K' },
  { id: 'deferred', label: "Produits constatés d'avance", prefixes: ['487'], box: '8L' },
]
const DEBT_EXCLUDED = ['409', '476', '477']

const balanceOf = (a: AccountYear) => a.openingCents + a.debitCents - a.creditCents
const matches = (code: string, prefixes: readonly string[]) => prefixes.some((p) => code.startsWith(p))

/** Gross amount of each line: the accounts on the side of the line, the most specific prefix choosing the line. */
function grossByLine(defs: readonly LineDef[], accounts: readonly AccountYear[], side: 'debit' | 'credit', excluded: readonly string[]) {
  const out = new Map<string, { cents: number; accounts: string[] }>(defs.map((d) => [d.id, { cents: 0, accounts: [] }]))
  for (const a of accounts) {
    const b = side === 'debit' ? balanceOf(a) : -balanceOf(a)
    if (b <= 0 || matches(a.code, excluded)) continue
    let best: LineDef | null = null
    let length = -1
    for (const d of defs) {
      for (const p of d.prefixes) {
        if (a.code.startsWith(p) && p.length > length) {
          best = d
          length = p.length
        }
      }
    }
    if (!best) continue
    const line = out.get(best.id)!
    line.cents += b
    line.accounts.push(a.code)
  }
  return out
}

export interface Form2057Input {
  /** Opening balance and movements of the year of every account (validated entries, closing entry excluded). */
  accounts: readonly AccountYear[]
  /** Answers of the annexe: part of the receivables at more than one year, of the debts at more than one and five years. */
  receivableMaturities: { overOneYearCents: number } | null
  debtMaturities: { overOneYearCents: number; overFiveYearsCents: number } | null
  /** "Dettes" of the complete balance sheet (box EC), null when the layout has none. */
  balanceSheetDebtsCents: number | null
}

const ASK_RECEIVABLES = "Indiquez la part des créances à plus d'un an dans l'annexe (état des créances)."
const ASK_DEBTS = "Indiquez la part des dettes à plus d'un an et à plus de cinq ans dans l'annexe (état des dettes)."
const SPLIT_BY_HAND = "La part à plus d'un an répondue dans l'annexe n'est pas nulle : ventilez-la ligne par ligne."

export function buildForm2057(input: Form2057Input): LiasseForm {
  const euro = formatCentsFr
  const rm = input.receivableMaturities
  const dm = input.debtMaturities
  const sumOf = (list: readonly AccountYear[], prefixes: string[], side: 'debit' | 'credit', except: string[] = []) =>
    list.filter((a) => matches(a.code, prefixes) && !matches(a.code, except)).reduce((s, a) => s + (side === 'debit' ? a.debitCents : a.creditCents), 0)

  // Cadre A
  const receivables = grossByLine(RECEIVABLES, input.accounts, 'debit', RECEIVABLE_EXCLUDED)
  const receivableRows: LiasseRow[] = []
  const receivableGross: LiasseCell[] = []
  for (const def of RECEIVABLES) {
    const g = receivables.get(def.id)!
    const gross = cell(def.box, 'Montant brut', amount(g.cents), 'books', { accounts: g.accounts })
    receivableGross.push(gross)
    const [shortBox, longBox] = def.split ?? [null, null]
    const split: LiasseCell[] =
      rm === null
        ? [manual(shortBox, 'À 1 an au plus', ASK_RECEIVABLES), manual(longBox, "À plus d'un an", ASK_RECEIVABLES)]
        : rm.overOneYearCents === 0
          ? [cell(shortBox, 'À 1 an au plus', amount(g.cents), 'answer', { note: "Aucune créance à plus d'un an (réponse de l'annexe)." }), cell(longBox, "À plus d'un an", amount(0), 'answer')]
          : [manual(shortBox, 'À 1 an au plus', SPLIT_BY_HAND), manual(longBox, "À plus d'un an", SPLIT_BY_HAND)]
    receivableRows.push({ id: `receivable-${def.id}`, label: def.label, cells: [gross, ...split] })
    if (def.id === 'customers') {
      const lent = manual('Z1', 'Montant brut', "Créance représentative de titres prêtés ou remis en garantie : Kledg ne suit pas les prêts de titres. La dépréciation antérieurement constituée va en case UO.")
      receivableGross.push(lent)
      receivableRows.push({ id: 'receivable-lent', label: 'Créance représentative de titres prêtés ou remis en garantie', cells: [lent, manual(null, 'À 1 an au plus', 'Voir la case Z1.'), manual(null, "À plus d'un an", 'Voir la case Z1.')] })
    }
  }
  const vt = sumCells('VT', 'Montant brut', receivableGross)
  const vtCents = vt.value?.kind === 'amount' ? vt.value.cents : 0
  receivableRows.push({
    id: 'receivable-total',
    label: 'Totaux',
    total: true,
    cells: [
      vt,
      rm === null ? manual('VU', 'À 1 an au plus', ASK_RECEIVABLES) : { ...cell('VU', 'À 1 an au plus', amount(vtCents - rm.overOneYearCents), 'answer'), ...(vt.pending ? { pending: vt.pending } : {}) },
      rm === null ? manual('VV', "À plus d'un an", ASK_RECEIVABLES) : cell('VV', "À plus d'un an", amount(rm.overOneYearCents), 'answer', { note: "Part répondue dans l'annexe." }),
    ],
  })
  const loansGranted = sumOf(input.accounts, ['274'], 'debit')
  const loansRepaid = sumOf(input.accounts, ['274'], 'credit')
  const associatesDebit = input.accounts.filter((a) => a.code.startsWith('455')).reduce((s, a) => s + Math.max(balanceOf(a), 0), 0)
  const receivableNotes = [
    cell('VD', 'Montant des prêts accordés en cours d\'exercice', amount(loansGranted), 'books', { accounts: ['274'] }),
    cell('VE', 'Montant des remboursements obtenus en cours d\'exercice', amount(loansRepaid), 'books', { accounts: ['274'] }),
    manual('VF', 'Prêts et avances consentis aux associés (personnes physiques)', "Kledg ne distingue pas les associés personnes physiques dans le compte 455.", associatesDebit > 0 ? amount(associatesDebit) : undefined),
  ]

  // Cadre B
  const debts = grossByLine(DEBTS, input.accounts, 'credit', DEBT_EXCLUDED)
  const debtSplit = (g: number): LiasseCell[] =>
    dm === null
      ? [manual(null, 'À 1 an au plus', ASK_DEBTS), manual(null, "À plus d'1 an et 5 ans au plus", ASK_DEBTS), manual(null, 'À plus de 5 ans', ASK_DEBTS)]
      : dm.overOneYearCents === 0
        ? [cell(null, 'À 1 an au plus', amount(g), 'answer', { note: "Aucune dette à plus d'un an (réponse de l'annexe)." }), cell(null, "À plus d'1 an et 5 ans au plus", amount(0), 'answer'), cell(null, 'À plus de 5 ans', amount(0), 'answer')]
        : [manual(null, 'À 1 an au plus', SPLIT_BY_HAND), manual(null, "À plus d'1 an et 5 ans au plus", SPLIT_BY_HAND), manual(null, 'À plus de 5 ans', SPLIT_BY_HAND)]
  const debtRows: LiasseRow[] = []
  const debtGross: LiasseCell[] = []
  for (const def of DEBTS) {
    const g = debts.get(def.id)!
    if (def.id === 'bank') {
      const loanAccounts = g.accounts.filter((code) => code.startsWith('164'))
      const loanCents = input.accounts.filter((a) => loanAccounts.includes(a.code)).reduce((s, a) => s - balanceOf(a), 0)
      const why = "Kledg ne connaît pas la durée à l'origine des emprunts du compte 164 : répartissez-les entre ces deux lignes."
      const short = loanCents === 0 ? cell('VG', 'Montant brut', amount(g.cents), 'books', { accounts: g.accounts, note: 'Découverts et concours bancaires, à un an au plus à l\'origine.' }) : manual('VG', 'Montant brut', why, amount(g.cents - loanCents))
      const long = loanCents === 0 ? cell('VH', 'Montant brut', amount(0), 'books') : manual('VH', 'Montant brut', why, amount(loanCents))
      debtGross.push(short, long)
      const byHand = (list: LiasseCell[]) => (loanCents === 0 ? list : list.map((c) => ({ ...c, value: null, source: 'manual' as const, note: why })))
      debtRows.push({ id: 'debt-bank-short', label: "Emprunts et dettes auprès des établissements de crédit : à 1 an maximum à l'origine", cells: [short, ...byHand(debtSplit(g.cents))] })
      debtRows.push({ id: 'debt-bank-long', label: "Emprunts et dettes auprès des établissements de crédit : à plus d'1 an à l'origine", cells: [long, ...byHand(debtSplit(0))] })
      continue
    }
    const gross = cell(def.box, 'Montant brut', amount(g.cents), 'books', { accounts: g.accounts })
    debtGross.push(gross)
    debtRows.push({ id: `debt-${def.id}`, label: def.label, cells: [gross, ...debtSplit(g.cents)] })
    if (def.id === 'vat') {
      const guaranteed = manual('VX', 'Montant brut', 'Obligations cautionnées : Kledg ne les distingue pas.')
      debtGross.push(guaranteed)
      debtRows.push({ id: 'debt-guaranteed', label: 'État : obligations cautionnées', cells: [guaranteed, ...debtSplit(0).map((c) => ({ ...c, value: null, source: 'manual' as const, note: 'Voir la case VX.' }))] })
    }
    if (def.id === 'otherDebts') {
      const borrowed = manual('Z2', 'Montant brut', 'Dette représentative de titres empruntés ou remis en garantie : Kledg ne suit pas les prêts de titres.')
      debtGross.push(borrowed)
      debtRows.push({ id: 'debt-borrowed', label: 'Dette représentative de titres empruntés ou remis en garantie', cells: [borrowed, ...debtSplit(0).map((c) => ({ ...c, value: null, source: 'manual' as const, note: 'Voir la case Z2.' }))] })
    }
  }
  const vy = sumCells('VY', 'Montant brut', debtGross)
  const vyCents = vy.value?.kind === 'amount' ? vy.value.cents : 0
  debtRows.push({
    id: 'debt-total',
    label: 'Totaux',
    total: true,
    cells: [
      vy,
      dm === null ? manual('VZ', 'À 1 an au plus', ASK_DEBTS) : { ...cell('VZ', 'À 1 an au plus', amount(vyCents - dm.overOneYearCents), 'answer'), ...(vy.pending ? { pending: vy.pending } : {}) },
      dm === null ? manual(null, "À plus d'1 an et 5 ans au plus", ASK_DEBTS) : cell(null, "À plus d'1 an et 5 ans au plus", amount(dm.overOneYearCents - dm.overFiveYearsCents), 'answer'),
      dm === null ? manual(null, 'À plus de 5 ans', ASK_DEBTS) : cell(null, 'À plus de 5 ans', amount(dm.overFiveYearsCents), 'answer'),
    ],
  })
  const loanPrefixes = ['16']
  const loanExcept = ['1688', '169']
  const associatesCredit = input.accounts.filter((a) => a.code.startsWith('455')).reduce((s, a) => s + Math.max(-balanceOf(a), 0), 0)
  const debtNotes = [
    cell('VJ', "Emprunts souscrits en cours d'exercice", amount(sumOf(input.accounts, loanPrefixes, 'credit', loanExcept)), 'books', { accounts: ['16'], note: 'Crédits des comptes 16, intérêts courus (1688) exclus.' }),
    cell('VK', "Emprunts remboursés en cours d'exercice", amount(sumOf(input.accounts, loanPrefixes, 'debit', loanExcept)), 'books', { accounts: ['16'] }),
    manual('VL', 'Montant des divers emprunts et dettes contractés auprès des associés personnes physiques', "Kledg ne distingue pas les associés personnes physiques dans le compte 455.", associatesCredit > 0 ? amount(associatesCredit) : undefined),
  ]

  const checks: LiasseCheck[] = []
  const warnings: string[] = []
  if (input.balanceSheetDebtsCents !== null) {
    checks.push(
      check(
        'balance-sheet-debts',
        'Total des dettes (VY) et dettes du bilan (case EC)',
        vyCents === input.balanceSheetDebtsCents,
        `Le bilan montre ${euro(input.balanceSheetDebtsCents)} de dettes, l'état des échéances ${euro(vyCents)} : un compte de dettes est rangé ailleurs dans la présentation du bilan, ou un compte de la classe 4 a un solde inhabituel.`,
      ),
    )
  } else warnings.push("Le bilan n'a pas de ligne « Dettes » (case EC) : le rapprochement avec le bilan n'est pas fait.")
  if (rm && rm.overOneYearCents > vtCents) warnings.push(`La part des créances à plus d'un an répondue dans l'annexe (${euro(rm.overOneYearCents)}) dépasse le total des créances.`)
  if (dm && dm.overOneYearCents > vyCents) warnings.push(`La part des dettes à plus d'un an répondue dans l'annexe (${euro(dm.overOneYearCents)}) dépasse le total des dettes.`)

  return {
    id: '2057',
    number: '2057-SD',
    title: "État des échéances des créances et des dettes à la clôture de l'exercice",
    sections: [
      { id: 'receivables', title: 'Cadre A. État des créances', columns: ['Montant brut', 'À 1 an au plus', "À plus d'un an"], rows: receivableRows },
      { id: 'receivable-notes', title: 'Cadre A. Renvois', columns: null, rows: receivableNotes.map((c, i) => ({ id: `receivable-note-${i}`, label: c.label, cells: [c] })) },
      { id: 'debts', title: 'Cadre B. État des dettes', columns: ['Montant brut', 'À 1 an au plus', "À plus d'1 an et 5 ans au plus", 'À plus de 5 ans'], rows: debtRows },
      { id: 'debt-notes', title: 'Cadre B. Renvois', columns: null, rows: debtNotes.map((c, i) => ({ id: `debt-note-${i}`, label: c.label, cells: [c] })) },
    ],
    checks,
    warnings,
    required: { value: true, reason: null },
  }
}
