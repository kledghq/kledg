/**
 * Provisions of the liasse fiscale on plain values (pure, amounts in cents):
 * the relevé des provisions of form 2033-D-SD (cadre I A, régime simplifié),
 * the movements of the amortissements dérogatoires (cadre I B) and the
 * dotations of provisions that are not deductible (cadre I C).
 *
 * Every column comes from the validated entries of the year, like the
 * fixed asset forms (lib/annexe/movements.ts): the opening entry gives the
 * amount at the start, credits are dotations, debits are reprises, the
 * amount at the end is their algebraic sum, and an entry cancelled by a
 * contre-passation of the same year is left out. The closing entry never
 * touches these accounts.
 *
 * Accounts (PCG art. 932-1 as amended by règlement ANC 2022-06): 145
 * amortissements dérogatoires, other 14 provisions réglementées, 15
 * provisions pour risques et charges, 29 dépréciations des immobilisations,
 * 39 des stocks et en-cours, 491 des comptes clients, other 49 and 59 the
 * other dépréciations. The most specific prefix wins.
 *
 * Deductibility (CGI art. 39, 1-5°): Kledg knows it only for the provisions
 * of its register (lib/provisions, flag taxDeductible); the dotations of
 * those marked non deductible fill cadre I C (total 780, carried to line
 * 322 of 2033-B-SD). A dotation the register does not explain is flagged.
 *
 * Box codes: form n° 2033-D-SD 2026 (liasse 2033-SD, impots.gouv.fr) and
 * its notice n° 2033-NOT-SD.
 */

import { cancelledEntries, type LedgerLine } from '@/lib/annexe/movements'
import type { ProvisionCategory } from '@/lib/provisions/rules'
import { formatCentsFr } from '@/lib/utils/money'
import { amount, cell, check, manual, sumCells, type LiasseCheck, type LiasseRow, type LiasseSection } from './cells'

export type ProvisionColumn = 'opening' | 'increase' | 'decrease' | 'closing'
const COLUMNS: readonly ProvisionColumn[] = ['opening', 'increase', 'decrease', 'closing']

export const PROVISION_COLUMN_LABELS: Record<ProvisionColumn, string> = {
  opening: "Montant au début de l'exercice",
  increase: "Augmentations : dotations de l'exercice",
  decrease: "Diminutions : reprises de l'exercice",
  closing: "Montant à la fin de l'exercice",
}

export interface AccountMovement {
  code: string
  openingCents: number
  increaseCents: number
  decreaseCents: number
  closingCents: number
}

/** Accounts of provisions and dépréciations: 14, 15, 29, 39, 49, 59. */
export function isProvisionAccount(code: string): boolean {
  return /^(14|15|29|39|49|59)/.test(code)
}

/** Movements of every provision account in `lines` (credit-balance accounts: credits increase them). */
export function provisionMovements(lines: readonly LedgerLine[]): AccountMovement[] {
  const cancelled = cancelledEntries(lines)
  const by = new Map<string, AccountMovement>()
  for (const l of lines) {
    if (!isProvisionAccount(l.code) || cancelled.has(l.entryId)) continue
    const m = by.get(l.code) ?? { code: l.code, openingCents: 0, increaseCents: 0, decreaseCents: 0, closingCents: 0 }
    if (l.opening) m.openingCents += l.creditCents - l.debitCents
    else {
      m.increaseCents += l.creditCents
      m.decreaseCents += l.debitCents
    }
    m.closingCents = m.openingCents + m.increaseCents - m.decreaseCents
    by.set(l.code, m)
  }
  return [...by.values()].sort((a, b) => a.code.localeCompare(b.code))
}

export interface ProvisionLineDef {
  kind: 'line'
  id: string
  label: string
  prefixes: readonly string[]
  /** Box codes: start, dotations, reprises, end. */
  codes: Record<ProvisionColumn, string>
}
export interface ProvisionTotalDef {
  kind: 'total'
  id: string
  label: string
  of: readonly string[]
  codes: Record<ProvisionColumn, string>
}
export type ProvisionDef = ProvisionLineDef | ProvisionTotalDef

const c = (opening: string, increase: string, decrease: string, closing: string): Record<ProvisionColumn, string> => ({ opening, increase, decrease, closing })

/** Form 2033-D-SD 2026, cadre I A. "Dont majorations exceptionnelles de 30 %" (601 to 607) is added by the builder. */
export const PROVISIONS_2033D: readonly ProvisionDef[] = [
  { kind: 'line', id: 'derogatory', label: 'Amortissements dérogatoires', prefixes: ['145'], codes: c('600', '602', '604', '606') },
  { kind: 'line', id: 'otherRegulated', label: 'Autres provisions réglementées', prefixes: ['14'], codes: c('610', '612', '614', '616') },
  { kind: 'line', id: 'riskCharges', label: 'Provisions pour risques et charges', prefixes: ['15'], codes: c('620', '622', '624', '626') },
  { kind: 'line', id: 'fixedAssets', label: 'Provisions pour dépréciation sur immobilisations', prefixes: ['29'], codes: c('630', '632', '634', '636') },
  { kind: 'line', id: 'inventory', label: 'Provisions pour dépréciation sur stocks et en cours', prefixes: ['39'], codes: c('640', '642', '644', '646') },
  { kind: 'line', id: 'customers', label: 'Provisions pour dépréciation sur comptes clients', prefixes: ['491'], codes: c('650', '652', '654', '656') },
  { kind: 'line', id: 'otherImpairment', label: 'Autres provisions pour dépréciation', prefixes: ['49', '59'], codes: c('660', '662', '664', '666') },
  {
    kind: 'total',
    id: 'total',
    label: 'Total',
    of: ['derogatory', 'otherRegulated', 'riskCharges', 'fixedAssets', 'inventory', 'customers', 'otherImpairment'],
    codes: c('680', '682', '684', '686'),
  },
]

/** The line of `defs` an account belongs to: the most specific matching prefix. */
export function provisionLineOf(defs: readonly ProvisionDef[], code: string): ProvisionLineDef | null {
  let best: ProvisionLineDef | null = null
  let bestLength = -1
  for (const def of defs) {
    if (def.kind !== 'line') continue
    for (const prefix of def.prefixes) {
      if (code.startsWith(prefix) && prefix.length > bestLength) {
        best = def
        bestLength = prefix.length
      }
    }
  }
  return best
}

export type LineTotals = Record<ProvisionColumn, number>

/** Totals of each line and total of `defs`, by id. */
export function provisionTotals(defs: readonly ProvisionDef[], movements: readonly AccountMovement[]): Map<string, LineTotals & { accounts: string[] }> {
  const out = new Map<string, LineTotals & { accounts: string[] }>()
  for (const def of defs) if (def.kind === 'line') out.set(def.id, { opening: 0, increase: 0, decrease: 0, closing: 0, accounts: [] })
  for (const m of movements) {
    const def = provisionLineOf(defs, m.code)
    if (!def) continue
    const t = out.get(def.id)!
    t.opening += m.openingCents
    t.increase += m.increaseCents
    t.decrease += m.decreaseCents
    t.closing += m.closingCents
    t.accounts.push(m.code)
  }
  for (const def of defs) {
    if (def.kind !== 'total') continue
    const t = { opening: 0, increase: 0, decrease: 0, closing: 0, accounts: [] as string[] }
    for (const id of def.of) {
      const part = out.get(id)
      if (!part) continue
      for (const col of COLUMNS) t[col] += part[col]
    }
    out.set(def.id, t)
  }
  return out
}

function gridRow(def: ProvisionDef, totals: LineTotals & { accounts: string[] }): LiasseRow {
  return {
    id: def.id,
    label: def.label,
    total: def.kind === 'total',
    cells: COLUMNS.map((col) => cell(def.codes[col], PROVISION_COLUMN_LABELS[col], amount(totals[col]), 'books', def.kind === 'line' ? { accounts: totals.accounts } : {})),
  }
}

export interface ProvisionRegisterItem {
  label: string
  category: ProvisionCategory
  accountCode: string
  taxDeductible: boolean
  /** Validated movement of the year booked for this provision: positive dotation, negative reprise. */
  movementCents: number
  /** Balance at the end of the year from the register (validated movements only). */
  closingCents: number
}

/** Line of the relevé (2033-D) a provision of the register belongs to, by its allowance account. */
function registerLine(defs: readonly ProvisionDef[], item: ProvisionRegisterItem): string | null {
  return provisionLineOf(defs, item.accountCode)?.id ?? null
}

const euro = formatCentsFr

export interface ProvisionsInput {
  movements: readonly AccountMovement[]
  register: readonly ProvisionRegisterItem[]
  /** Balance sheet lines of the company's layout: provisions réglementées and provisions pour risques et charges, with their box; null when the layout has none. */
  balanceSheet: { regulated: { box: string; cents: number } | null; riskCharges: { box: string; cents: number } | null }
}

export interface ProvisionsResult {
  sections: LiasseSection[]
  checks: LiasseCheck[]
  warnings: string[]
  /** Total of the non-deductible dotations (computed part of 780). */
  nonDeductibleCents: number
}

/** Form 2033-D-SD cadre I: A (relevé), B (amortissements dérogatoires), C (non deductible). */
export function provisions2033D(input: ProvisionsInput): ProvisionsResult {
  const totals = provisionTotals(PROVISIONS_2033D, input.movements)
  const derogatory = totals.get('derogatory')!
  const noDerogatory = COLUMNS.every((col) => derogatory[col] === 0)

  // A. The relevé, with the "dont 30 %" line after the derogatory depreciation.
  const rows: LiasseRow[] = []
  for (const def of PROVISIONS_2033D) {
    rows.push(gridRow(def, totals.get(def.id)!))
    if (def.id === 'derogatory') {
      const codes = c('601', '603', '605', '607')
      rows.push({
        id: 'exceptional30',
        label: 'Dont majorations exceptionnelles de 30 %',
        cells: COLUMNS.map((col) =>
          noDerogatory
            ? cell(codes[col], PROVISION_COLUMN_LABELS[col], amount(0), 'books', { note: "Aucun amortissement dérogatoire dans les écritures (compte 145)." })
            : manual(codes[col], PROVISION_COLUMN_LABELS[col], "Kledg ne distingue pas les majorations exceptionnelles de 30 % dans le compte 145 : indiquez la part qui en relève."),
        ),
      })
    }
  }

  // B. Derogatory depreciation by line of fixed assets: only the totals are in the books.
  const derogatoryLines: Array<[string, string, string]> = [
    ['Fonds commercial', '681', '683'],
    ['Autres immobilisations incorporelles', '700', '705'],
    ['Terrains', '710', '715'],
    ['Constructions', '720', '725'],
    ['Installations techniques, matériel et outillage', '730', '735'],
    ['Installations générales, agencements et aménagements divers', '740', '745'],
    ['Matériel de transport', '750', '755'],
    ['Autres immobilisations corporelles', '760', '765'],
  ]
  const byAsset = (label: string, box: string) =>
    noDerogatory
      ? cell(box, label, amount(0), 'books')
      : manual(box, label, "Kledg ne suit pas les amortissements dérogatoires immobilisation par immobilisation : ventilez les mouvements du compte 145.")
  const derogatoryRows: LiasseRow[] = [
    ...derogatoryLines.map(([label, dotation, reprise], i) => ({ id: `derogatory-${i}`, label, cells: [byAsset('Dotations', dotation), byAsset('Reprises', reprise)] })),
    {
      id: 'derogatory-total',
      label: 'Total',
      total: true,
      cells: [
        cell('770', 'Dotations', amount(derogatory.increase), 'books', { accounts: derogatory.accounts }),
        cell('775', 'Reprises', amount(derogatory.decrease), 'books', { accounts: derogatory.accounts }),
      ],
    },
  ]

  // C. Dotations not deductible: the register's provisions marked so.
  const nonDeductible = input.register.filter((p) => !p.taxDeductible && p.movementCents > 0)
  const nonDeductibleCells = nonDeductible.map((p) => cell(null, p.label, amount(p.movementCents), 'record', { accounts: [p.accountCode], note: 'Provision marquée non déductible dans le registre des provisions.' }))
  const paidLeave = manual(
    null,
    'Indemnités pour congés à payer, charges sociales et fiscales correspondantes',
    "Ligne 1 : seulement pour les entreprises placées sous le régime optionnel de l'article 39-1-1° bis, 2e alinéa du CGI (notice 2033-NOT-SD).",
  )
  const accrued = manual(null, 'Charges à payer non déductibles', "Kledg ne sait pas quelles charges à payer ne sont pas déductibles : ajoutez-les s'il y en a.")
  const total780 = sumCells('780', 'Total à reporter ligne 322 du tableau n° 2033-B-SD', [paidLeave, ...nonDeductibleCells, accrued], 'record')
  const nonDeductibleCents = nonDeductible.reduce((s, p) => s + p.movementCents, 0)

  const sections: LiasseSection[] = [
    { id: 'provisions', title: 'I A. Relevé des provisions, amortissements dérogatoires', columns: COLUMNS.map((col) => PROVISION_COLUMN_LABELS[col]), rows },
    {
      id: 'derogatory',
      title: 'I B. Mouvements affectant la provision pour amortissements dérogatoires',
      columns: ['Dotations', 'Reprises'],
      rows: derogatoryRows,
    },
    {
      id: 'non-deductible',
      title: "I C. Ventilation des dotations aux provisions et charges à payer non déductibles pour l'assiette de l'impôt",
      columns: null,
      rows: [
        ...[paidLeave, ...nonDeductibleCells, accrued].map((x, i): LiasseRow => ({ id: `non-deductible-${i}`, label: x.label, cells: [x] })),
        { id: 'non-deductible-total', label: total780.label, total: true, cells: [total780] },
      ],
    },
  ]

  return { sections, ...provisionChecks(PROVISIONS_2033D, totals, input), nonDeductibleCents }
}

/** Checks of a relevé des provisions against the register and the balance sheet, and the warnings on deductibility. */
export function provisionChecks(
  defs: readonly ProvisionDef[],
  totals: Map<string, LineTotals & { accounts: string[] }>,
  input: ProvisionsInput,
): { checks: LiasseCheck[]; warnings: string[] } {
  const checks: LiasseCheck[] = []
  const warnings: string[] = []

  // Register, line by line where it follows something.
  const registerByLine = new Map<string, number>()
  for (const item of input.register) {
    const line = registerLine(defs, item)
    if (line) registerByLine.set(line, (registerByLine.get(line) ?? 0) + item.closingCents)
  }
  for (const def of defs) {
    if (def.kind !== 'line' || !registerByLine.has(def.id)) continue
    const books = totals.get(def.id)!.closing
    const register = registerByLine.get(def.id)!
    checks.push(
      check(
        `register-${def.id}`,
        `${def.label} : montant à la fin, écritures et registre des provisions`,
        books === register,
        `Les écritures donnent ${euro(books)} à la fin, le registre des provisions ${euro(register)} (écart de ${euro(Math.abs(books - register))}) : une provision comptabilisée n'est pas au registre, ou un mouvement du registre n'est pas validé.`,
      ),
    )
  }

  // Balance sheet: regulated provisions (14) and provisions for risks and charges (15).
  const regulated = defs.filter((d) => d.kind === 'line' && d.prefixes.some((p) => p.startsWith('14'))).reduce((s, d) => s + totals.get(d.id)!.closing, 0)
  const risks = defs.filter((d) => d.kind === 'line' && d.prefixes.some((p) => p.startsWith('15'))).reduce((s, d) => s + totals.get(d.id)!.closing, 0)
  const sheet = input.balanceSheet
  if (sheet.regulated) {
    checks.push(
      check(
        'balance-sheet-regulated',
        `Provisions réglementées à la fin et bilan (case ${sheet.regulated.box})`,
        regulated === sheet.regulated.cents,
        `Le bilan montre ${euro(sheet.regulated.cents)} de provisions réglementées, le relevé ${euro(regulated)} : un compte 14 est rangé ailleurs dans la présentation du bilan.`,
      ),
    )
  }
  if (sheet.riskCharges) {
    checks.push(
      check(
        'balance-sheet-risk-charges',
        `Provisions pour risques et charges à la fin et bilan (case ${sheet.riskCharges.box})`,
        risks === sheet.riskCharges.cents,
        `Le bilan montre ${euro(sheet.riskCharges.cents)} de provisions pour risques et charges, le relevé ${euro(risks)} : un compte 15 est rangé ailleurs dans la présentation du bilan.`,
      ),
    )
  }
  if (!sheet.regulated || !sheet.riskCharges) warnings.push("La présentation du bilan n'a pas de ligne de provisions avec sa case officielle : le rapprochement avec le bilan n'est pas complet.")

  // Deductibility: dotations the register does not explain.
  const booksDotations = defs.filter((d) => d.kind === 'line' && !d.prefixes.some((p) => p.startsWith('14'))).reduce((s, d) => s + totals.get(d.id)!.increase, 0)
  const registerDotations = input.register.filter((p) => p.movementCents > 0).reduce((s, p) => s + p.movementCents, 0)
  if (booksDotations > registerDotations) {
    warnings.push(
      `${euro(booksDotations - registerDotations)} de dotations aux provisions et dépréciations ne correspondent à aucune provision du registre : Kledg ne sait pas si elles sont déductibles. Enregistrez-les dans Risques et charges ou Dépréciations.`,
    )
  }
  const taxedReprises = input.register.filter((p) => !p.taxDeductible && p.movementCents < 0).reduce((s, p) => s - p.movementCents, 0)
  if (taxedReprises > 0) {
    warnings.push(`Reprises de provisions non déductibles de l'exercice : ${euro(taxedReprises)}. Déjà taxées lors de leur dotation, elles se déduisent du résultat fiscal.`)
  }
  return { checks, warnings }
}
