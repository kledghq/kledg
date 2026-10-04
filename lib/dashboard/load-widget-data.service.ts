/**
 * Data of the dashboard widgets (GET /api/dashboard/widgets?source=): one
 * loader per source of lib/dashboard/widgets.ts, so widgets load
 * independently and in parallel, and widgets of one source share one
 * request.
 *
 * Every loader is a bounded set of queries (aggregates, counts, `take`),
 * never a query per row. Amounts are integer cents. Indicators read the
 * account totals the income statement and the balance sheet are built from
 * (loadStatementAccounts: validated entries of the fiscal year, closing
 * entries excluded), so they match the statements to the cent.
 */

import { z } from 'zod'
import type { FiscalYear } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { transactionOfCompany } from '@/lib/api/resources'
import type { Permission } from '@/lib/rbac/authorize'
import { getAllAccountBalances } from '@/lib/reports/account-balances'
import { getDashboardWindow, getMonthlyData, resolveDashboardFiscalYear } from '@/lib/reports/dashboard'
import { loadStatementAccounts } from '@/lib/reports/statements/load'
import { addUtcDays, calendarDayOf, todayUtc, utcDaysInclusive } from '@/lib/utils/date'
import { parseCents, toCents } from '@/lib/utils/money'
import { loadDeadlinesWidget, type DeadlinesWidgetData } from '@/lib/deadlines/load-deadlines.service'
import { ledgerCashByMonth, type CashPoint } from './ledger-cash'
import { summarizeLedger, type LedgerSummary } from './ledger-summary'
import { WIDGET_SOURCES, type WidgetSource } from './widgets'

/** Sources served by GET /api/dashboard/widgets (the checklist has its own route). */
export const SERVED_SOURCES = WIDGET_SOURCES.filter((s): s is Exclude<WidgetSource, 'onboarding'> => s !== 'onboarding')
export type ServedSource = (typeof SERVED_SOURCES)[number]

/** ?companyId=&source=&fiscalYearId= ; a fiscal year of another company falls back to the active one. */
export const WidgetDataQuerySchema = z.object({
  source: z.enum(SERVED_SOURCES, { error: 'Source de widget inconnue' }),
  fiscalYearId: z.string().max(64).optional(),
})
export type WidgetDataQuery = z.infer<typeof WidgetDataQuerySchema>

/** Items listed by the list widgets. */
const LIST_SIZE = 5
/** Bank accounts shown at most (a small company has a handful). */
const MAX_BANK_ACCOUNTS = 20

export interface FiscalYearRef {
  id: string
  year: number
  startDate: string
  endDate: string
  isClosed: boolean
}

interface LoadContext {
  can: (permission: Permission) => boolean
  /** Injected by tests; the clock otherwise. */
  now?: Date
}

const fiscalYearRef = (fy: FiscalYear): FiscalYearRef => ({
  id: fy.id,
  year: fy.year,
  startDate: calendarDayOf(fy.startDate) as string,
  endDate: calendarDayOf(fy.endDate) as string,
  isClosed: fy.isClosed,
})

/** Today within the fiscal year: its first day before it starts, its last day once over. */
function referenceDay(fy: Pick<FiscalYear, 'startDate' | 'endDate'>, now?: Date): Date {
  const today = todayUtc(now)
  if (today < fy.startDate) return todayUtc(fy.startDate)
  if (today > fy.endDate) return todayUtc(fy.endDate)
  return today
}

function requireCents(euros: number): number {
  const cents = toCents(euros)
  if (cents === null) throw new RangeError(`Invalid account balance: ${euros}`)
  return cents
}

// ---------------------------------------------------------------- ledger

export interface PreviousPeriod {
  year: number
  /** The same span of the previous fiscal year: its first day to the same day count as today. */
  startDate: string
  endDate: string
  produitsCents: number
  chargesCents: number
  resultatCents: number
  chiffreAffairesCents: number
}

export interface LedgerData {
  fiscalYear: FiscalYearRef | null
  /** The day the comparison stops at (today within the fiscal year). */
  asOf?: string
  summary?: LedgerSummary
  previous?: PreviousPeriod | null
  /** Balances reported by the banks (accounts replaced by a direct connection excluded); null without banking:read. */
  bank?: { balanceCents: number; accounts: number; otherCurrencies: number } | null
}

/**
 * The previous fiscal year over the same span as the selected one: from its
 * first day to as many days as the selected year has run (its whole length
 * once the selected year is over), closing entries excluded.
 */
async function loadPreviousPeriod(companyId: string, fy: FiscalYear, reference: Date): Promise<PreviousPeriod | null> {
  const previous = await prisma.fiscalYear.findFirst({
    where: { companyId, startDate: { lt: fy.startDate } },
    orderBy: { startDate: 'desc' },
  })
  if (!previous) return null
  const elapsed = utcDaysInclusive(fy.startDate, reference)
  const sameDay = addUtcDays(previous.startDate, Math.max(elapsed, 1) - 1)
  const endDate = sameDay > previous.endDate ? todayUtc(previous.endDate) : sameDay
  const balances = await getAllAccountBalances(companyId, { startDate: previous.startDate, endDate }, previous.id, true)
  const summary = summarizeLedger(
    balances.map((b) => ({ code: b.code, debitCents: requireCents(b.debit), creditCents: requireCents(b.credit) })),
  )
  return {
    year: previous.year,
    startDate: calendarDayOf(previous.startDate) as string,
    endDate: calendarDayOf(endDate) as string,
    produitsCents: summary.produitsCents,
    chargesCents: summary.chargesCents,
    resultatCents: summary.resultatCents,
    chiffreAffairesCents: summary.chiffreAffairesCents,
  }
}

async function loadBankBalances(companyId: string): Promise<NonNullable<LedgerData['bank']>> {
  const accounts = await prisma.bankAccount.findMany({
    where: { bankConnection: { companyId }, supersededById: null },
    select: { balance: true, currency: true },
    take: 500,
  })
  let balanceCents = 0
  let euros = 0
  for (const account of accounts) {
    if (account.currency !== 'EUR') continue
    balanceCents += parseCents(account.balance) ?? 0
    euros++
  }
  return { balanceCents, accounts: euros, otherCurrencies: accounts.length - euros }
}

async function loadLedger(companyId: string, fy: FiscalYear, ctx: LoadContext): Promise<LedgerData> {
  const reference = referenceDay(fy, ctx.now)
  const [accounts, previous, bank] = await Promise.all([
    loadStatementAccounts(companyId, fy),
    loadPreviousPeriod(companyId, fy, reference),
    ctx.can({ banking: ['read'] }) ? loadBankBalances(companyId) : Promise.resolve(null),
  ])
  return {
    fiscalYear: fiscalYearRef(fy),
    asOf: calendarDayOf(reference) as string,
    summary: summarizeLedger(accounts),
    previous,
    bank,
  }
}

// ---------------------------------------------------------------- charts

export interface MonthlyData {
  fiscalYear: FiscalYearRef | null
  /** Euros per month (chart values), from cents summed by PostgreSQL. */
  months?: Array<{ month: string; revenue: number; expenses: number }>
}

async function loadMonthly(companyId: string, fy: FiscalYear): Promise<MonthlyData> {
  return { fiscalYear: fiscalYearRef(fy), months: await getMonthlyData(companyId, getDashboardWindow(fy, 12)) }
}

export interface TreasuryData {
  fiscalYear: FiscalYearRef | null
  openingCents?: number
  points?: CashPoint[]
}

async function loadTreasury(companyId: string, fy: FiscalYear): Promise<TreasuryData> {
  const window = getDashboardWindow(fy, 12)
  const { openingCents, points } = await ledgerCashByMonth({ companyId, fiscalYearId: fy.id, months: window.months })
  return { fiscalYear: fiscalYearRef(fy), openingCents, points }
}

// ---------------------------------------------------------------- lists

export interface ReconciliationData {
  /** Every unreconciled bank transaction of the company, as the header indicator counts them. */
  count: number
  recent: Array<{
    id: string
    date: string
    label: string | null
    counterpartyName: string | null
    /** Signed: negative for money going out. */
    amountCents: number
    bankAccount: { name: string; displayName: string | null; iban: string | null }
  }>
}

async function loadReconciliation(companyId: string): Promise<ReconciliationData> {
  const where = { ...transactionOfCompany(companyId), reconciled: false }
  const [count, rows] = await Promise.all([
    prisma.bankTransaction.count({ where }),
    prisma.bankTransaction.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: LIST_SIZE,
      select: {
        id: true,
        date: true,
        label: true,
        counterpartyName: true,
        amount: true,
        side: true,
        bankAccount: { select: { name: true, displayName: true, iban: true } },
      },
    }),
  ])
  return {
    count,
    recent: rows.map((t) => {
      const cents = Math.abs(parseCents(t.amount) ?? 0)
      return {
        id: t.id,
        date: calendarDayOf(t.date) as string,
        label: t.label,
        counterpartyName: t.counterpartyName,
        amountCents: t.side === 'debit' ? -cents : cents,
        bankAccount: t.bankAccount,
      }
    }),
  }
}

export interface EntrySummary {
  id: string
  entryNumber: string
  date: string
  description: string | null
  reference: string | null
  status: string
  journalCode: string
  journalLabel: string
  /** Total of the debit lines (equal to the credits once the entry balances). */
  totalCents: number
}

export interface EntriesData {
  fiscalYear: FiscalYearRef | null
  count?: number
  entries?: EntrySummary[]
}

/** The most recent entries matching `where`, with their totals from one grouped query. */
async function recentEntries(where: { companyId: string; fiscalYearId: string; status?: string }): Promise<EntrySummary[]> {
  const entries = await prisma.accountingEntry.findMany({
    where,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: LIST_SIZE,
    select: {
      id: true,
      entryNumber: true,
      date: true,
      description: true,
      reference: true,
      status: true,
      journal: { select: { code: true, label: true } },
    },
  })
  const totals = entries.length
    ? await prisma.entryLine.groupBy({
        by: ['accountingEntryId'],
        where: { accountingEntryId: { in: entries.map((e) => e.id) } },
        _sum: { debit: true },
      })
    : []
  const totalOf = new Map(totals.map((t) => [t.accountingEntryId, parseCents(t._sum.debit) ?? 0]))
  return entries.map((e) => ({
    id: e.id,
    entryNumber: e.entryNumber,
    date: calendarDayOf(e.date) as string,
    description: e.description,
    reference: e.reference,
    status: e.status,
    journalCode: e.journal.code,
    journalLabel: e.journal.label,
    totalCents: totalOf.get(e.id) ?? 0,
  }))
}

async function loadDrafts(companyId: string, fy: FiscalYear): Promise<EntriesData> {
  const where = { companyId, fiscalYearId: fy.id, status: 'draft' }
  const [count, entries] = await Promise.all([prisma.accountingEntry.count({ where }), recentEntries(where)])
  return { fiscalYear: fiscalYearRef(fy), count, entries }
}

async function loadRecentEntries(companyId: string, fy: FiscalYear): Promise<EntriesData> {
  const where = { companyId, fiscalYearId: fy.id }
  const [count, entries] = await Promise.all([prisma.accountingEntry.count({ where }), recentEntries(where)])
  return { fiscalYear: fiscalYearRef(fy), count, entries }
}

export interface BankAccountsData {
  accounts: Array<{
    id: string
    name: string
    displayName: string | null
    iban: string | null
    provider: string
    balanceCents: number
    currency: string
    shouldSync: boolean
    lastSyncedAt: string | null
    hasSyncError: boolean
    consentExpiresAt: string | null
  }>
}

/**
 * Bank accounts of the company with their state. Credentials are never
 * selected (lib/banking/list-bank-connections.service.ts has the same
 * invariant); the sync error is reduced to a flag.
 */
async function loadBankAccounts(companyId: string): Promise<BankAccountsData> {
  const accounts = await prisma.bankAccount.findMany({
    where: { bankConnection: { companyId }, supersededById: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_BANK_ACCOUNTS,
    select: {
      id: true,
      name: true,
      displayName: true,
      iban: true,
      balance: true,
      currency: true,
      shouldSync: true,
      lastSyncedAt: true,
      lastSyncError: true,
      consentExpiresAt: true,
      bankConnection: { select: { provider: true, lastSyncAt: true, lastSyncError: true, consentExpiresAt: true } },
    },
  })
  return {
    accounts: accounts.map((a) => {
      const manual = a.bankConnection.provider === 'MANUAL'
      const consent = a.consentExpiresAt ?? a.bankConnection.consentExpiresAt
      const synced = a.lastSyncedAt ?? a.bankConnection.lastSyncAt
      return {
        id: a.id,
        name: a.name,
        displayName: a.displayName,
        iban: a.iban,
        provider: a.bankConnection.provider,
        balanceCents: parseCents(a.balance) ?? 0,
        currency: a.currency,
        shouldSync: a.shouldSync,
        lastSyncedAt: manual ? null : (synced?.toISOString() ?? null),
        hasSyncError: !manual && Boolean(a.lastSyncError ?? a.bankConnection.lastSyncError),
        consentExpiresAt: manual ? null : (consent?.toISOString() ?? null),
      }
    }),
  }
}

export interface RulesData {
  /** Every rule of the company. */
  total: number
  rules: Array<{ id: string; name: string; usageCount: number; lastUsedAt: string | null; enabled: boolean }>
}

async function loadRules(companyId: string): Promise<RulesData> {
  const [total, rules] = await Promise.all([
    prisma.transactionRule.count({ where: { companyId } }),
    prisma.transactionRule.findMany({
      where: { companyId, usageCount: { gt: 0 } },
      orderBy: [{ usageCount: 'desc' }, { name: 'asc' }],
      take: LIST_SIZE,
      select: { id: true, name: true, usageCount: true, lastUsedAt: true, enabled: true },
    }),
  ])
  return { total, rules: rules.map((r) => ({ ...r, lastUsedAt: r.lastUsedAt?.toISOString() ?? null })) }
}

// ---------------------------------------------------------------- dispatch

export interface WidgetDataBySource {
  ledger: LedgerData
  monthly: MonthlyData
  treasury: TreasuryData
  reconciliation: ReconciliationData
  drafts: EntriesData
  'recent-entries': EntriesData
  'bank-accounts': BankAccountsData
  rules: RulesData
  deadlines: DeadlinesWidgetData
}

type FiscalYearLoader<S extends ServedSource> = (companyId: string, fy: FiscalYear, ctx: LoadContext) => Promise<WidgetDataBySource[S]>
type CompanyLoader<S extends ServedSource> = (companyId: string, ctx: LoadContext) => Promise<WidgetDataBySource[S]>

/** Loaders of the sources that read one fiscal year (null fiscal year: the company has none). */
const FISCAL_YEAR_LOADERS: { [S in ServedSource]?: FiscalYearLoader<S> } = {
  ledger: loadLedger,
  monthly: loadMonthly,
  treasury: loadTreasury,
  drafts: loadDrafts,
  'recent-entries': loadRecentEntries,
}

const COMPANY_LOADERS: { [S in ServedSource]?: CompanyLoader<S> } = {
  reconciliation: loadReconciliation,
  'bank-accounts': loadBankAccounts,
  rules: loadRules,
  // Not tied to the selected fiscal year: the next 60 days from today.
  deadlines: (companyId, ctx) => loadDeadlinesWidget(companyId, ctx.now),
}

/** The data of one source. The caller checked SOURCE_PERMISSIONS[source]. */
export async function loadWidgetSource<S extends ServedSource>(
  companyId: string,
  query: { source: S; fiscalYearId?: string },
  ctx: LoadContext,
): Promise<WidgetDataBySource[S]> {
  const companyLoader = COMPANY_LOADERS[query.source] as CompanyLoader<S> | undefined
  if (companyLoader) return companyLoader(companyId, ctx)
  const loader = FISCAL_YEAR_LOADERS[query.source] as FiscalYearLoader<S>
  const fy = await resolveDashboardFiscalYear(companyId, query.fiscalYearId ?? null)
  if (!fy) return { fiscalYear: null } as WidgetDataBySource[S]
  return loader(companyId, fy, ctx)
}
