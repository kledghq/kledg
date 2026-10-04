/**
 * What the group view reads in the books of one company of the group. Every
 * function reads the company of the current row level security scope: the
 * caller runs it inside inCompany (lib/management-fees/access.ts), after the
 * user's access to that company was checked, so a company out of reach is
 * never read, and the database itself refuses any other company.
 *
 * Same scope as the statements: validated entries of the fiscal year,
 * closing entries excluded, amounts in cents.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ledgerCashByMonth, type CashPoint } from '@/lib/dashboard/ledger-cash'
import { IS_CLOSING } from '@/lib/reports/ledger/aggregate'
import { computeBalanceIndicators } from '@/lib/reports/financial-indicators/balance-indicators'
import { computeSig } from '@/lib/reports/financial-indicators/sig'
import { buildBalanceSheet } from '@/lib/reports/statements/balance-sheet'
import { defaultBalanceSheetRules } from '@/lib/reports/statements/default-rules'
import { loadStatementAccounts } from '@/lib/reports/statements/load'
import type { AccountTotals } from '@/lib/reports/statements/allocation'
import { parseCents, toCents } from '@/lib/utils/money'
import type { FlowCategory, IntragroupObservation, KeyFigures } from './combine'
import { companyBySiren, companyNamedIn, type GroupCompanyRef } from './match'
import { percentToBp, pickFiscalYear, type YearSpan } from './periods'

export interface MemberFiscalYear extends YearSpan {
  year: number
  isClosed: boolean
}

/** The fiscal year of the company read for the holding's period [start, end], or null. */
export async function matchFiscalYear(companyId: string, start: Date, end: Date): Promise<MemberFiscalYear | null> {
  const years = await prisma.fiscalYear.findMany({
    where: { companyId, startDate: { lte: end }, endDate: { gte: start } },
    select: { id: true, year: true, startDate: true, endDate: true, isClosed: true },
    orderBy: { startDate: 'asc' },
    take: 5,
  })
  return pickFiscalYear(years, start, end)
}

const sumOf = (accounts: readonly AccountTotals[], prefix: string) =>
  accounts.filter((a) => a.code.startsWith(prefix)).reduce((sum, a) => sum + a.debitCents - a.creditCents, 0)

/**
 * The key figures of the year from its account totals, through the same
 * rules as the financial indicators (SIG, balance sheet lines) and the
 * default PCG balance sheet layout for the total.
 */
export function figuresOf(companyId: string, fiscalYearId: string, accounts: AccountTotals[]): KeyFigures {
  const sig = computeSig(accounts)
  const bilan = computeBalanceIndicators(accounts)
  const sheet = buildBalanceSheet({ companyId, fiscalYearId, reportVariant: 'complete', rules: defaultBalanceSheetRules('complete'), accounts })
  return {
    chiffreAffairesCents: sig.chiffreAffairesCents,
    ebeCents: sig.ebeCents,
    resultatCents: sig.resultatExerciceCents,
    tresorerieCents: sumOf(accounts, '512'),
    capitauxPropresCents: bilan.capitauxPropresCents,
    endettementCents: bilan.dettesFinancieresCents,
    totalBilanCents: toCents(sheet.actifTotal) ?? 0,
  }
}

export interface MemberBooks {
  fiscalYear: MemberFiscalYear
  accounts: AccountTotals[]
  figures: KeyFigures
  /** Balance of the 512 accounts at the end of each month of the window. */
  treasury: CashPoint[]
}

export async function readMemberBooks(companyId: string, fiscalYear: MemberFiscalYear, months: ReadonlyArray<{ year: number; month: number }>): Promise<MemberBooks> {
  const [accounts, cash] = await Promise.all([
    loadStatementAccounts(companyId, fiscalYear),
    ledgerCashByMonth({ companyId, fiscalYearId: fiscalYear.id, months }),
  ])
  return { fiscalYear, accounts, figures: figuresOf(companyId, fiscalYear.id, accounts), treasury: cash.points }
}

/** Accounts read for intragroup balances, and their category. */
const BALANCE_CATEGORIES: Array<[string, FlowCategory]> = [
  ['401', 'trade'],
  ['403', 'trade'],
  ['404', 'trade'],
  ['408', 'trade'],
  ['409', 'trade'],
  ['411', 'trade'],
  ['413', 'trade'],
  ['418', 'trade'],
  ['419', 'trade'],
  ['451', 'current_account'],
  ['455', 'current_account'],
  ['267', 'loan'],
  ['168', 'loan'],
]

export function balanceCategoryOf(code: string): FlowCategory | null {
  return BALANCE_CATEGORIES.find(([prefix]) => code.startsWith(prefix))?.[1] ?? null
}

const BALANCE_FILTER = Prisma.join(
  BALANCE_CATEGORIES.map(([prefix]) => Prisma.sql`a."code" LIKE ${`${prefix}%`}`),
  ' OR ',
)

interface LedgerRow {
  code: string
  label: string
  aux: string | null
  lineDescription: string | null
  entryDescription: string | null
  balance: bigint | null
}

/** Rows of the fiscal year's validated lines (closing entries excluded), grouped as asked. */
async function ledgerRows(companyId: string, fiscalYearId: string, filter: Prisma.Sql, withDescriptions: boolean): Promise<LedgerRow[]> {
  const descriptions = withDescriptions ? Prisma.sql`l."description"` : Prisma.sql`NULL::text`
  const entryDescriptions = withDescriptions ? Prisma.sql`e."description"` : Prisma.sql`NULL::text`
  return prisma.$queryRaw<LedgerRow[]>`
    SELECT a."code" AS code, a."label" AS label, l."auxiliaryAccountNumber" AS aux,
           ${descriptions} AS "lineDescription", ${entryDescriptions} AS "entryDescription",
           SUM((l."debit" - l."credit") * 100)::bigint AS balance
    FROM "entry_lines" l
    JOIN "accounting_entries" e ON e."id" = l."accountingEntryId"
    JOIN "journals" j ON j."id" = e."journalId"
    JOIN "accounts" a ON a."id" = l."accountId"
    WHERE l."accountFiscalYearId" = ${fiscalYearId}
      AND e."companyId" = ${companyId}
      AND e."fiscalYearId" = ${fiscalYearId}
      AND e."status" = 'validated'
      AND NOT ${IS_CLOSING}
      AND (${filter})
    GROUP BY 1, 2, 3, 4, 5
    ORDER BY 1, 3
    LIMIT 5000
  `
}

/** SIREN of the tiers of each auxiliary account number of the company. */
async function sirenByAux(companyId: string, auxes: string[]): Promise<Map<string, string | null>> {
  if (auxes.length === 0) return new Map()
  const tiers = await prisma.tiers.findMany({
    where: { companyId, auxiliaryAccountNumber: { in: auxes } },
    select: { auxiliaryAccountNumber: true, siren: true },
  })
  return new Map(tiers.map((t) => [t.auxiliaryAccountNumber, t.siren]))
}

/**
 * Balances at the end of the year on the accounts of another company of the
 * group: clients and fournisseurs (40, 41), comptes courants (451, 455),
 * prêts (267, 168). The counterparty is the tiers of the auxiliary account
 * (by SIREN), else the company named by the account label.
 */
export async function readBalanceObservations(
  companyId: string,
  fiscalYearId: string,
  group: readonly GroupCompanyRef[],
): Promise<IntragroupObservation[]> {
  const others = group.filter((c) => c.id !== companyId)
  if (others.length === 0) return []
  const rows = await ledgerRows(companyId, fiscalYearId, BALANCE_FILTER, false)
  const sirens = await sirenByAux(companyId, [...new Set(rows.flatMap((r) => (r.aux ? [r.aux] : [])))])
  const byKey = new Map<string, IntragroupObservation>()
  for (const row of rows) {
    const category = balanceCategoryOf(row.code)
    const cents = Number(row.balance ?? 0)
    if (!category || cents === 0) continue
    const byTiers = row.aux ? companyBySiren(others, sirens.get(row.aux)) : null
    const counterparty = byTiers ?? companyNamedIn(others, row.label)
    if (!counterparty) continue
    const key = `${row.code}\u0000${counterparty.id}`
    const current = byKey.get(key)
    byKey.set(key, {
      companyId,
      counterpartyId: counterparty.id,
      category,
      accountCode: row.code,
      cents: (current?.cents ?? 0) + cents,
      source: current?.source === 'tiers' || byTiers ? 'tiers' : 'label',
      reference: `${row.code} ${row.label}`,
      inBooks: true,
    })
  }
  return [...byKey.values()].filter((o) => o.cents !== 0)
}

/**
 * Dividends received (761, produits de participations) from another company
 * of the group: the tiers of the line, else the company named by the account
 * label, the line or the entry description.
 */
export async function readDividendObservations(
  companyId: string,
  fiscalYearId: string,
  group: readonly GroupCompanyRef[],
): Promise<IntragroupObservation[]> {
  const others = group.filter((c) => c.id !== companyId)
  if (others.length === 0) return []
  const rows = await ledgerRows(companyId, fiscalYearId, Prisma.sql`a."code" LIKE '761%'`, true)
  const sirens = await sirenByAux(companyId, [...new Set(rows.flatMap((r) => (r.aux ? [r.aux] : [])))])
  const byKey = new Map<string, IntragroupObservation>()
  for (const row of rows) {
    // A produit: credit minus debit.
    const cents = -Number(row.balance ?? 0)
    if (cents === 0) continue
    const byTiers = row.aux ? companyBySiren(others, sirens.get(row.aux)) : null
    const counterparty = byTiers ?? companyNamedIn(others, row.label, row.lineDescription, row.entryDescription)
    if (!counterparty) continue
    const key = `${row.code}\u0000${counterparty.id}`
    const current = byKey.get(key)
    byKey.set(key, {
      companyId,
      counterpartyId: counterparty.id,
      category: 'dividend',
      accountCode: row.code,
      cents: (current?.cents ?? 0) + cents,
      source: current?.source === 'tiers' || byTiers ? 'tiers' : 'label',
      reference: `${row.code} ${row.label}`,
      inBooks: true,
    })
  }
  return [...byKey.values()].filter((o) => o.cents !== 0)
}

/** Most invoices a company exchanges with its group in a year that the view reads (bounded list). */
const MAX_INVOICES = 2000

/**
 * Invoices of the year between the company and another company of the
 * group, recognised by the SIREN of the other party (as printed on the
 * invoice, else the tiers'), whose entry is validated in this fiscal year:
 * the produits (seller) or charges (buyer) their entry booked. A credit
 * note books the opposite sides, so its amounts come out negative.
 */
export async function readInvoiceObservations(
  companyId: string,
  fiscalYearId: string,
  group: readonly GroupCompanyRef[],
): Promise<IntragroupObservation[]> {
  const others = group.filter((c) => c.id !== companyId)
  const sirens = others.flatMap((c) => (c.siren ? [c.siren] : []))
  if (sirens.length === 0) return []
  const invoices = await prisma.invoice.findMany({
    where: {
      companyId,
      entry: { status: 'validated', fiscalYearId },
      OR: [{ tiers: { siren: { in: sirens } } }, { buyerSiren: { in: sirens } }, { sellerSiren: { in: sirens } }],
    },
    select: {
      number: true,
      direction: true,
      buyerSiren: true,
      sellerSiren: true,
      tiers: { select: { siren: true } },
      managementFeeSale: { select: { id: true } },
      managementFeePurchase: { select: { id: true } },
      entry: { select: { lines: { select: { debit: true, credit: true, account: { select: { code: true } } } } } },
    },
    orderBy: { issueDate: 'asc' },
    take: MAX_INVOICES,
  })
  const observations: IntragroupObservation[] = []
  for (const invoice of invoices) {
    const printed = invoice.direction === 'SALE' ? invoice.buyerSiren : invoice.sellerSiren
    const counterparty = companyBySiren(others, printed) ?? companyBySiren(others, invoice.tiers.siren)
    if (!counterparty || !invoice.entry) continue
    const category: FlowCategory = invoice.managementFeeSale || invoice.managementFeePurchase ? 'management_fee' : 'invoice'
    const byAccount = new Map<string, number>()
    for (const line of invoice.entry.lines) {
      const code = line.account.code
      if (!code.startsWith('6') && !code.startsWith('7')) continue
      const debit = parseCents(line.debit) ?? 0
      const credit = parseCents(line.credit) ?? 0
      byAccount.set(code, (byAccount.get(code) ?? 0) + (code.startsWith('7') ? credit - debit : debit - credit))
    }
    for (const [accountCode, cents] of byAccount) {
      if (cents === 0) continue
      observations.push({ companyId, counterpartyId: counterparty.id, category, accountCode, cents, source: 'invoice', reference: `Facture ${invoice.number}`, inBooks: true })
    }
  }
  return observations
}

/**
 * Management fee billings of the holding for periods ending in the fiscal
 * year whose sales invoice is not in the validated books yet (draft
 * invoice, entry not validated): shown so the user knows a flow is coming,
 * never eliminated. Posted ones are read as invoices.
 */
export async function readPendingManagementFees(
  holdingId: string,
  fiscalYear: { id: string; startDate: Date; endDate: Date },
  group: readonly GroupCompanyRef[],
): Promise<IntragroupObservation[]> {
  const ids = group.filter((c) => c.id !== holdingId).map((c) => c.id)
  if (ids.length === 0) return []
  const billings = await prisma.managementFeeBilling.findMany({
    where: { companyId: holdingId, subsidiaryId: { in: ids }, periodEnd: { gte: fiscalYear.startDate, lte: fiscalYear.endDate } },
    select: {
      subsidiaryId: true,
      amountExclTax: true,
      convention: { select: { label: true, revenueAccountCode: true } },
      salesInvoice: { select: { number: true, entry: { select: { status: true, fiscalYearId: true } } } },
    },
    orderBy: { periodEnd: 'asc' },
    take: 500,
  })
  return billings
    .filter((b) => !(b.salesInvoice?.entry?.status === 'validated' && b.salesInvoice.entry.fiscalYearId === fiscalYear.id))
    .map((b) => ({
      companyId: holdingId,
      counterpartyId: b.subsidiaryId,
      category: 'management_fee' as const,
      accountCode: b.convention.revenueAccountCode,
      cents: parseCents(b.amountExclTax) ?? 0,
      source: 'invoice' as const,
      reference: b.salesInvoice ? `Facture ${b.salesInvoice.number} (non comptabilisée)` : `${b.convention.label} (facture non préparée)`,
      inBooks: false,
    }))
}

export interface Stake {
  /** Percentage of the subsidiary's capital the holding holds, in basis points (6000 = 60 %), summed over its shareholder rows. */
  percentBp: number
  numberOfShares: number | null
  /** Capital held, as recorded on the shareholder row, in cents. */
  capitalHeldCents: number | null
}

/** The holding's stake in the company of the scope, from its shareholders (Informations page of the subsidiary). */
export async function readStake(subsidiaryId: string, holdingId: string): Promise<Stake> {
  const rows = await prisma.shareholder.findMany({
    where: { companyId: subsidiaryId, companyShareholderId: holdingId },
    select: { sharePercentage: true, numberOfShares: true, capitalAmount: true },
    take: 20,
  })
  let bp = 0
  let shares: number | null = null
  let capital: number | null = null
  for (const row of rows) {
    bp += percentToBp(row.sharePercentage.toString())
    if (row.numberOfShares !== null) shares = (shares ?? 0) + row.numberOfShares
    if (row.capitalAmount !== null) capital = (capital ?? 0) + (parseCents(row.capitalAmount) ?? 0)
  }
  return { percentBp: bp, numberOfShares: shares, capitalHeldCents: capital }
}
