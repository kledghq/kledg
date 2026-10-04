/**
 * Benchmark dataset generator (not shipped in the app).
 *
 * Creates a throwaway PostgreSQL database, applies prisma/migrations and fills
 * it with realistic books: companies with several fiscal years (closed years
 * with their closing entry CL, opening entries AN), sales, purchases, bank and
 * payroll entries, bank transactions with provider payloads, attachments and
 * assignment rules. One user (an accountant, not an instance administrator) is
 * a member of every company.
 *
 * Generation is deterministic (seeded PRNG, stable ids): two runs of a profile
 * give the same rows, so measurements before and after a change compare the
 * same data. Rows are written in bulk with triggers disabled
 * (session_replication_role = replica): the data is consistent by
 * construction (balanced entries, closed years only receive their own rows).
 *
 * Usage:
 *   pnpm tsx scripts/bench/dataset.ts --profile large [--keep] [--url postgresql://...]
 * Without --keep the database is dropped at the end (useful to time generation).
 * KLEDG_BENCH_BASE_URL defaults to the kledg-verify-db container (localhost:55432).
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { PCG_ACCOUNTS } from '../../lib/accounting/pcg-data'

export interface CompanySpec {
  years: number
  entriesPerYear: number
  transactionsPerYear: number
}

export interface Profile {
  name: string
  /** Main company (the one measured). */
  main: CompanySpec
  /** Other companies of the same accountant (company list, multi-tenant selectivity). */
  others: { count: number } & CompanySpec
}

/**
 * small: a typical small company (3,000 entries and 5,000 transactions a year).
 * large: 5 years of 15,000 entries and 20,000 transactions a year, to expose
 * O(n) and N+1 paths; plus 20 other companies, the portfolio of an accountant.
 */
export const PROFILES: Record<string, Profile> = {
  tiny: {
    name: 'tiny',
    main: { years: 2, entriesPerYear: 300, transactionsPerYear: 400 },
    others: { count: 3, years: 1, entriesPerYear: 50, transactionsPerYear: 50 },
  },
  small: {
    name: 'small',
    main: { years: 3, entriesPerYear: 3000, transactionsPerYear: 5000 },
    others: { count: 20, years: 2, entriesPerYear: 500, transactionsPerYear: 1000 },
  },
  medium: {
    name: 'medium',
    main: { years: 5, entriesPerYear: 8000, transactionsPerYear: 10000 },
    others: { count: 20, years: 2, entriesPerYear: 1000, transactionsPerYear: 1500 },
  },
  large: {
    name: 'large',
    main: { years: 5, entriesPerYear: 15000, transactionsPerYear: 20000 },
    others: { count: 20, years: 2, entriesPerYear: 1000, transactionsPerYear: 1500 },
  },
}

export const BENCH_USER_ID = 'bench_user'
export const BENCH_USER_EMAIL = 'bench-accountant@kledg.test'
export const MAIN_COMPANY_ID = 'bench_c0'
/** First calendar year of every company. */
export const FIRST_YEAR = 2022

const BASE_URL = process.env.KLEDG_BENCH_BASE_URL ?? 'postgresql://kledg:kledg@localhost:55432/postgres'

export function databaseUrl(database: string, base = BASE_URL): string {
  const url = new URL(base)
  url.pathname = `/${database}`
  return url.toString()
}

/** mulberry32: small, fast, deterministic. */
function prng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
  }
}

function centsToDecimal(cents: number): string {
  const negative = cents < 0
  const abs = Math.abs(cents)
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

function utcDay(year: number, dayOfYear: number): Date {
  return new Date(Date.UTC(year, 0, 1 + dayOfYear))
}

function daysInYear(year: number): number {
  return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000
}

/** Accounts used by the generated entries, on top of the PCG (4 digits and fewer). */
const WORKING_ACCOUNTS: Array<{ code: string; label: string }> = [
  { code: '101000', label: 'Capital social' },
  { code: '120000', label: "Résultat de l'exercice (bénéfice)" },
  { code: '129000', label: "Résultat de l'exercice (perte)" },
  { code: '401000', label: 'Fournisseurs' },
  { code: '411000', label: 'Clients' },
  { code: '421000', label: 'Personnel, rémunérations dues' },
  { code: '431000', label: 'Sécurité sociale' },
  { code: '445660', label: 'TVA déductible sur autres biens et services' },
  { code: '445710', label: 'TVA collectée' },
  { code: '512000', label: 'Banque' },
  { code: '606100', label: 'Fournitures non stockables' },
  { code: '607000', label: 'Achats de marchandises' },
  { code: '613200', label: 'Locations immobilières' },
  { code: '622600', label: 'Honoraires' },
  { code: '625100', label: 'Voyages et déplacements' },
  { code: '626000', label: 'Frais postaux et télécommunications' },
  { code: '627000', label: 'Services bancaires' },
  { code: '641000', label: 'Rémunérations du personnel' },
  { code: '645000', label: 'Charges de sécurité sociale' },
  { code: '706000', label: 'Prestations de services' },
  { code: '707000', label: 'Ventes de marchandises' },
]

const EXPENSE_ACCOUNTS = ['606100', '607000', '613200', '622600', '625100', '626000']
const REVENUE_ACCOUNTS = ['706000', '707000']
const COUNTERPARTIES = [
  'EDF', 'ORANGE', 'AMAZON', 'OVH', 'SNCF', 'AIR FRANCE', 'URSSAF', 'DGFIP', 'BOUYGUES', 'FREE',
  'LEROY MERLIN', 'METRO', 'CLIENT DUPONT', 'CLIENT MARTIN', 'CLIENT BERNARD', 'CLIENT PETIT',
  'GOOGLE', 'MICROSOFT', 'ADOBE', 'SLACK', 'NOTION', 'TOTAL', 'AXA', 'MAIF', 'LA POSTE',
]
const CATEGORIES = ['utility', 'telecom', 'online_service', 'transport', 'tax', 'supplier', 'customer', 'insurance', 'fees']
const OPERATION_TYPES = ['card', 'transfer', 'direct_debit', 'income']

interface Row {
  [column: string]: string | number | boolean | Date | null
}

/** Bulk insert through unnest: one statement per chunk, columns typed explicitly. */
async function insertRows(client: Client, table: string, columns: Array<[string, string]>, rows: Row[]): Promise<void> {
  const CHUNK = 5000
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const params = columns.map(([name]) => chunk.map((row) => {
      const value = row[name]
      // timestamp(3) columns hold UTC (Prisma's convention): never let pg
      // serialize a Date in the local timezone.
      if (value instanceof Date) return value.toISOString().replace('Z', '')
      return value === undefined ? null : value
    }))
    const select = columns.map(([, type], index) => `$${index + 1}::${type}[]`).join(', ')
    const names = columns.map(([name]) => `"${name}"`).join(', ')
    await client.query(`INSERT INTO "${table}" (${names}) SELECT * FROM unnest(${select})`, params)
  }
}

interface CompanyResult {
  companyId: string
  entries: number
  lines: number
  transactions: number
}

interface GenLine {
  accountCode: string
  debit: number
  credit: number
  description: string | null
}

async function generateCompany(
  client: Client,
  index: number,
  spec: CompanySpec,
  now: Date,
): Promise<CompanyResult> {
  const rand = prng(1000 + index)
  const companyId = `bench_c${index}`
  const name = index === 0 ? 'Atelier Benchmark' : `Société Bench ${String(index).padStart(2, '0')}`
  const lastYear = FIRST_YEAR + spec.years - 1

  await insertRows(client, 'companies', [
    ['id', 'text'], ['name', 'text'], ['slug', 'text'], ['siren', 'text'], ['closingDay', 'int'], ['closingMonth', 'int'],
    ['vatRegime', 'text'], ['legalType', '"CompanyLegalType"'], ['defaultBankAccountCode', 'text'], ['createdAt', 'timestamp'], ['updatedAt', 'timestamp'],
  ], [{
    id: companyId, name, slug: `bench-${index}`, siren: String(800000000 + index), closingDay: 31, closingMonth: 12,
    vatRegime: 'normal', legalType: 'SAS', defaultBankAccountCode: '512000', createdAt: now, updatedAt: now,
  }])
  await insertRows(client, 'organization', [['id', 'text'], ['name', 'text'], ['slug', 'text'], ['companyId', 'text'], ['createdAt', 'timestamp']], [
    { id: `bench_o${index}`, name, slug: `bench-org-${index}`, companyId, createdAt: now },
  ])
  await insertRows(client, 'member', [['id', 'text'], ['organizationId', 'text'], ['userId', 'text'], ['role', 'text'], ['createdAt', 'timestamp']], [
    { id: `bench_m${index}`, organizationId: `bench_o${index}`, userId: BENCH_USER_ID, role: 'accountant', createdAt: now },
  ])

  const journals = ['AC', 'VE', 'BQ', 'OD', 'AN', 'CL']
  const journalLabels: Record<string, string> = {
    AC: 'Achats', VE: 'Ventes', BQ: 'Banque', OD: 'Opérations diverses', AN: 'À-nouveaux', CL: 'Journal de clôture',
  }
  await insertRows(client, 'journals', [['id', 'text'], ['code', 'text'], ['label', 'text'], ['companyId', 'text'], ['createdAt', 'timestamp'], ['updatedAt', 'timestamp']],
    journals.map((code) => ({ id: `${companyId}_j${code}`, code, label: journalLabels[code], companyId, createdAt: now, updatedAt: now })))

  // Fiscal years and their charts of accounts
  const fiscalYears: Row[] = []
  const accounts: Row[] = []
  const accountIds = new Map<string, string>() // `${year}:${code}` -> id
  const pcg = PCG_ACCOUNTS.filter((a) => !a.code.startsWith('8') && a.code.length <= 4)
  for (let year = FIRST_YEAR; year <= lastYear; year++) {
    const fyId = `${companyId}_fy${year}`
    const closed = year < lastYear
    fiscalYears.push({
      id: fyId, companyId, year, closingDay: 31, closingMonth: 12,
      startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)),
      isClosed: closed, closedAt: closed ? new Date(Date.UTC(year + 1, 3, 15)) : null, createdAt: now, updatedAt: now,
    })
    const byCode = new Map<string, { code: string; label: string; parentCode?: string }>()
    for (const a of pcg) byCode.set(a.code, { code: a.code, label: a.label, parentCode: a.parentCode })
    for (const a of WORKING_ACCOUNTS) byCode.set(a.code, { ...a, parentCode: a.code.slice(0, 3) })
    const all = [...byCode.values()]
    for (const account of all) accountIds.set(`${year}:${account.code}`, `${fyId}_a${account.code}`)
    for (const account of all) {
      accounts.push({
        id: `${fyId}_a${account.code}`, code: account.code, label: account.label,
        parentId: account.parentCode ? accountIds.get(`${year}:${account.parentCode}`) ?? null : null,
        companyId, fiscalYearId: fyId, isPCG: true, createdAt: now, updatedAt: now,
      })
    }
  }
  await insertRows(client, 'fiscal_years', [
    ['id', 'text'], ['companyId', 'text'], ['year', 'int'], ['closingDay', 'int'], ['closingMonth', 'int'], ['startDate', 'timestamp'],
    ['endDate', 'timestamp'], ['isClosed', 'boolean'], ['closedAt', 'timestamp'], ['createdAt', 'timestamp'], ['updatedAt', 'timestamp'],
  ], fiscalYears)
  await insertRows(client, 'accounts', [
    ['id', 'text'], ['code', 'text'], ['label', 'text'], ['parentId', 'text'], ['companyId', 'text'], ['fiscalYearId', 'text'],
    ['isPCG', 'boolean'], ['createdAt', 'timestamp'], ['updatedAt', 'timestamp'],
  ], accounts)

  // Entries
  const entryRows: Row[] = []
  const lineRows: Row[] = []
  let carried = new Map<string, number>() // balance sheet balances brought forward (cents, debit - credit)

  for (let year = FIRST_YEAR; year <= lastYear; year++) {
    const fyId = `${companyId}_fy${year}`
    const closed = year < lastYear
    const days = daysInYear(year)
    type GenEntry = { day: number; journal: string; description: string; reference: string | null; lines: GenLine[] }
    const generated: GenEntry[] = []

    for (let n = 0; n < spec.entriesPerYear; n++) {
      const day = rand.int(0, days - 1)
      const kind = rand.next()
      const party = rand.pick(COUNTERPARTIES)
      if (kind < 0.3) {
        const ht = rand.int(5_000, 500_000)
        const vat = Math.round(ht * 0.2)
        generated.push({ day, journal: 'VE', description: `Facture ${party}`, reference: `FA${year}-${n}`, lines: [
          { accountCode: '411000', debit: ht + vat, credit: 0, description: null },
          { accountCode: rand.pick(REVENUE_ACCOUNTS), debit: 0, credit: ht, description: null },
          { accountCode: '445710', debit: 0, credit: vat, description: 'TVA collectée 20 %' },
        ] })
      } else if (kind < 0.65) {
        const ht = rand.int(1_000, 300_000)
        const vat = Math.round(ht * 0.2)
        generated.push({ day, journal: 'AC', description: `Facture fournisseur ${party}`, reference: `F-${party.slice(0, 3)}-${n}`, lines: [
          { accountCode: rand.pick(EXPENSE_ACCOUNTS), debit: ht, credit: 0, description: null },
          { accountCode: '445660', debit: vat, credit: 0, description: 'TVA déductible 20 %' },
          { accountCode: '401000', debit: 0, credit: ht + vat, description: null },
        ] })
      } else if (kind < 0.95) {
        const amount = rand.int(500, 400_000)
        const sub = rand.next()
        const lines: GenLine[] = sub < 0.45
          ? [{ accountCode: '512000', debit: amount, credit: 0, description: null }, { accountCode: '411000', debit: 0, credit: amount, description: null }]
          : sub < 0.9
            ? [{ accountCode: '401000', debit: amount, credit: 0, description: null }, { accountCode: '512000', debit: 0, credit: amount, description: null }]
            : [{ accountCode: '627000', debit: Math.min(amount, 5_000), credit: 0, description: null }, { accountCode: '512000', debit: 0, credit: Math.min(amount, 5_000), description: null }]
        generated.push({ day, journal: 'BQ', description: `Règlement ${party}`, reference: null, lines })
      } else {
        const gross = rand.int(150_000, 600_000)
        const social = Math.round(gross * 0.42)
        generated.push({ day, journal: 'OD', description: `Paie ${year}-${Math.floor(day / 31) + 1}`, reference: null, lines: [
          { accountCode: '641000', debit: gross, credit: 0, description: null },
          { accountCode: '421000', debit: 0, credit: gross, description: null },
          { accountCode: '645000', debit: social, credit: 0, description: null },
          { accountCode: '431000', debit: 0, credit: social, description: null },
        ] })
      }
    }
    generated.sort((a, b) => a.day - b.day)

    // Opening entry (AN) on the first day, from the previous year's balance sheet accounts
    const ordered: Array<GenEntry & { status: 'validated' | 'draft' }> = []
    if (carried.size > 0) {
      const lines: GenLine[] = []
      for (const [code, balance] of [...carried.entries()].sort()) {
        if (balance === 0) continue
        lines.push({ accountCode: code, debit: Math.max(balance, 0), credit: Math.max(-balance, 0), description: 'Report à nouveau' })
      }
      ordered.push({ day: 0, journal: 'AN', description: `À-nouveaux ${year}`, reference: `AN-${year}`, lines, status: 'validated' })
    }
    // The open year keeps a few drafts (the most recent entries)
    const draftFrom = closed ? generated.length : Math.floor(generated.length * 0.97)
    generated.forEach((entry, i) => ordered.push({ ...entry, status: i >= draftFrom ? 'draft' : 'validated' }))

    // Balances of the year (validated entries), for the closing and the next opening
    const balances = new Map<string, number>()
    for (const entry of ordered) {
      if (entry.status !== 'validated') continue
      for (const line of entry.lines) balances.set(line.accountCode, (balances.get(line.accountCode) ?? 0) + line.debit - line.credit)
    }
    if (closed) {
      // Closing entry (CL): classes 6 and 7 to zero, result in 120 or 129
      const lines: GenLine[] = []
      let result = 0
      for (const [code, balance] of [...balances.entries()].sort()) {
        if (!/^[67]/.test(code) || balance === 0) continue
        lines.push({ accountCode: code, debit: Math.max(-balance, 0), credit: Math.max(balance, 0), description: 'Solde de clôture' })
        result -= balance
      }
      const resultAccount = result >= 0 ? '120000' : '129000'
      lines.push({ accountCode: resultAccount, debit: Math.max(-result, 0), credit: Math.max(result, 0), description: "Résultat de l'exercice" })
      ordered.push({ day: days - 1, journal: 'CL', description: `Clôture ${year}`, reference: `CL-${year}`, lines, status: 'validated' })
      for (const line of lines) balances.set(line.accountCode, (balances.get(line.accountCode) ?? 0) + line.debit - line.credit)
    }
    carried = new Map([...balances.entries()].filter(([code]) => /^[1-5]/.test(code)))

    let number = 0
    ordered.forEach((entry, i) => {
      const id = `${fyId}_e${i}`
      const entryNumber = entry.status === 'validated' ? String(++number) : `BR-${year}${String(i).padStart(6, '0')}`
      const date = utcDay(year, entry.day)
      entryRows.push({
        id, entryNumber, date, journalId: `${companyId}_j${entry.journal}`, companyId, fiscalYearId: fyId,
        description: entry.description, reference: entry.reference, status: entry.status,
        validatedAt: entry.status === 'validated' ? new Date(date.getTime() + 36 * 3_600_000) : null,
        pieceDate: date, createdAt: date, updatedAt: date,
      })
      entry.lines.forEach((line, l) => {
        const accountId = accountIds.get(`${year}:${line.accountCode}`)
        if (!accountId) throw new Error(`Unknown account ${line.accountCode}`)
        lineRows.push({
          id: `${id}_l${l}`, accountingEntryId: id, accountingEntryNumber: entryNumber, accountId, accountFiscalYearId: fyId,
          debit: centsToDecimal(line.debit), credit: centsToDecimal(line.credit), description: line.description,
          createdAt: new Date(date.getTime() + l), updatedAt: date,
        })
      })
    })
  }
  await insertRows(client, 'accounting_entries', [
    ['id', 'text'], ['entryNumber', 'text'], ['date', 'timestamp'], ['journalId', 'text'], ['companyId', 'text'], ['fiscalYearId', 'text'],
    ['description', 'text'], ['reference', 'text'], ['status', 'text'], ['validatedAt', 'timestamp'], ['pieceDate', 'timestamp'],
    ['createdAt', 'timestamp'], ['updatedAt', 'timestamp'],
  ], entryRows)
  await insertRows(client, 'entry_lines', [
    ['id', 'text'], ['accountingEntryId', 'text'], ['accountingEntryNumber', 'text'], ['accountId', 'text'], ['accountFiscalYearId', 'text'],
    ['debit', 'numeric'], ['credit', 'numeric'], ['description', 'text'], ['createdAt', 'timestamp'], ['updatedAt', 'timestamp'],
  ], lineRows)

  // Bank connection, account and transactions
  const connectionId = `${companyId}_bc`
  const bankAccountId = `${companyId}_ba`
  await insertRows(client, 'bank_connections', [['id', 'text'], ['companyId', 'text'], ['provider', '"BankingProvider"'], ['status', 'text'], ['createdAt', 'timestamp'], ['updatedAt', 'timestamp']], [
    { id: connectionId, companyId, provider: 'MANUAL', status: 'active', createdAt: now, updatedAt: now },
  ])
  await insertRows(client, 'bank_accounts', [
    ['id', 'text'], ['bankConnectionId', 'text'], ['externalAccountId', 'text'], ['iban', 'text'], ['name', 'text'], ['balance', 'numeric'],
    ['currency', 'text'], ['ledgerAccountCode', 'text'], ['createdAt', 'timestamp'], ['updatedAt', 'timestamp'],
  ], [{
    id: bankAccountId, bankConnectionId: connectionId, externalAccountId: `FR76300040000${String(index).padStart(10, '0')}`,
    iban: `FR76300040000${String(index).padStart(10, '0')}`, name: 'Compte courant', balance: '0.00', currency: 'EUR',
    ledgerAccountCode: '512000', createdAt: now, updatedAt: now,
  }])

  const transactions: Row[] = []
  const attachments: Row[] = []
  for (let year = FIRST_YEAR; year <= lastYear; year++) {
    const days = daysInYear(year)
    const open = year === lastYear
    for (let n = 0; n < spec.transactionsPerYear; n++) {
      const id = `${companyId}_t${year}_${n}`
      const party = rand.pick(COUNTERPARTIES)
      const side = rand.next() < 0.55 ? 'debit' : 'credit'
      const cents = rand.int(500, 300_000)
      const date = utcDay(year, rand.int(0, days - 1))
      const category = rand.pick(CATEGORIES)
      const operationType = side === 'credit' ? 'income' : rand.pick(OPERATION_TYPES)
      const label = `${side === 'debit' ? (operationType === 'card' ? 'CB' : 'PRLV SEPA') : 'VIR SEPA'} ${party} ${n}`
      const reconciled = open ? rand.next() < 0.6 : true
      transactions.push({
        id, bankAccountId, externalTransactionId: `ext_${id}`, amount: centsToDecimal(cents), date, label,
        reference: `REF${year}${n}`, side, reconciled, reconciledAt: reconciled ? date : null,
        counterpartyName: party, category, cashflowCategory: side === 'debit' ? 'Dépenses' : 'Revenus',
        operationType, status: 'completed',
        providerData: JSON.stringify({
          id: `uuid-${id}`, transaction_id: `ext_${id}`, amount: cents / 100, amount_cents: cents, side, operation_type: operationType,
          currency: 'EUR', label, clean_counterparty_name: party, settled_at: date.toISOString(), emitted_at: date.toISOString(),
          status: 'completed', reference: `REF${year}${n}`, category, note: null, vat_rate: side === 'debit' ? 20 : null,
          vat_amount_cents: side === 'debit' ? Math.round(cents / 6) : null, logo: { small: `https://logo.example/${party}.png`, medium: null },
          cashflow_category: { name: side === 'debit' ? 'Dépenses' : 'Revenus' }, cashflow_subcategory: { name: category },
          card_last_digits: operationType === 'card' ? '4242' : null, initiator_id: 'bench', label_ids: [], attachment_ids: [],
        }),
        imported: true, createdAt: date, updatedAt: date,
      })
      if (rand.next() < 0.3) {
        attachments.push({
          id: `${id}_att`, companyId, bankTransactionId: id, fileName: `facture-${party}-${n}.pdf`, fileSize: 120_000,
          fileContentType: 'application/pdf', createdAt: date, updatedAt: date,
        })
      }
    }
  }
  await insertRows(client, 'bank_transactions', [
    ['id', 'text'], ['bankAccountId', 'text'], ['externalTransactionId', 'text'], ['amount', 'numeric'], ['date', 'timestamp'], ['label', 'text'],
    ['reference', 'text'], ['side', 'text'], ['reconciled', 'boolean'], ['reconciledAt', 'timestamp'], ['counterpartyName', 'text'],
    ['category', 'text'], ['cashflowCategory', 'text'], ['operationType', 'text'], ['status', 'text'], ['providerData', 'jsonb'],
    ['imported', 'boolean'], ['createdAt', 'timestamp'], ['updatedAt', 'timestamp'],
  ], transactions)
  await insertRows(client, 'attachments', [
    ['id', 'text'], ['companyId', 'text'], ['bankTransactionId', 'text'], ['fileName', 'text'], ['fileSize', 'int'],
    ['fileContentType', 'text'], ['createdAt', 'timestamp'], ['updatedAt', 'timestamp'],
  ], attachments)

  // Assignment rules: one per usual counterparty
  const rules: Row[] = []
  const conditions: Row[] = []
  const ruleLines: Row[] = []
  COUNTERPARTIES.forEach((party, r) => {
    const ruleId = `${companyId}_r${r}`
    const isCustomer = party.startsWith('CLIENT')
    rules.push({ id: ruleId, companyId, name: `Règle ${party}`, enabled: true, priority: r, journalCode: 'BQ', defaultVatAccountCode: '445660', createdAt: now, updatedAt: now })
    conditions.push({ id: `${ruleId}_c0`, ruleId, conditionType: 'counterparty', operator: 'contains', value: party })
    conditions.push({ id: `${ruleId}_c1`, ruleId, conditionType: 'side', operator: 'equals', value: isCustomer ? 'credit' : 'debit' })
    ruleLines.push({
      id: `${ruleId}_l0`, ruleId, accountCode: isCustomer ? '411000' : rand.pick(EXPENSE_ACCOUNTS), lineType: 'auto', amountType: 'full',
      order: 0, vatType: isCustomer ? 'none' : 'deductible', vatRateSource: 'fixed', vatRate: isCustomer ? null : '20.00',
      vatAccountCode: isCustomer ? null : '445660',
    })
  })
  await insertRows(client, 'transaction_rules', [
    ['id', 'text'], ['companyId', 'text'], ['name', 'text'], ['enabled', 'boolean'], ['priority', 'int'], ['journalCode', 'text'],
    ['defaultVatAccountCode', 'text'], ['createdAt', 'timestamp'], ['updatedAt', 'timestamp'],
  ], rules)
  await insertRows(client, 'transaction_rule_conditions', [['id', 'text'], ['ruleId', 'text'], ['conditionType', 'text'], ['operator', 'text'], ['value', 'text']], conditions)
  await insertRows(client, 'transaction_rule_entry_lines', [
    ['id', 'text'], ['ruleId', 'text'], ['accountCode', 'text'], ['lineType', 'text'], ['amountType', 'text'], ['order', 'int'],
    ['vatType', 'text'], ['vatRateSource', 'text'], ['vatRate', 'numeric'], ['vatAccountCode', 'text'],
  ], ruleLines)

  return { companyId, entries: entryRows.length, lines: lineRows.length, transactions: transactions.length }
}

function migrationsSql(): string[] {
  const dir = path.resolve(__dirname, '../../prisma/migrations')
  return readdirSync(dir)
    .filter((name) => /^\d+_/.test(name))
    .sort()
    .map((name) => readFileSync(path.join(dir, name, 'migration.sql'), 'utf8'))
}

export async function createDatabase(database: string): Promise<string> {
  if (!/^kledg_bench_[a-z0-9_]+$/.test(database)) throw new Error(`Invalid bench database name: ${database}`)
  const admin = new Client({ connectionString: databaseUrl('postgres') })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
    await admin.query(`CREATE DATABASE "${database}"`)
  } finally {
    await admin.end()
  }
  const url = databaseUrl(database)
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    for (const sql of migrationsSql()) await client.query(sql)
  } finally {
    await client.end()
  }
  return url
}

export async function dropDatabase(database: string): Promise<void> {
  const admin = new Client({ connectionString: databaseUrl('postgres') })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
  } finally {
    await admin.end()
  }
}

export interface DatasetSummary {
  profile: string
  companies: number
  entries: number
  lines: number
  transactions: number
  seconds: number
}

/** Fills a migrated database with the profile's data. */
export async function seedDataset(url: string, profile: Profile): Promise<DatasetSummary> {
  const started = Date.now()
  const now = new Date(Date.UTC(FIRST_YEAR + profile.main.years - 1, 9, 1))
  const client = new Client({ connectionString: url })
  await client.connect()
  const totals = { companies: 0, entries: 0, lines: 0, transactions: 0 }
  try {
    await client.query('SET session_replication_role = replica')
    await insertRows(client, 'user', [['id', 'text'], ['name', 'text'], ['email', 'text'], ['emailVerified', 'boolean'], ['createdAt', 'timestamp'], ['updatedAt', 'timestamp']], [
      { id: BENCH_USER_ID, name: 'Comptable Bench', email: BENCH_USER_EMAIL, emailVerified: true, createdAt: now, updatedAt: now },
    ])
    const specs: CompanySpec[] = [profile.main, ...Array.from({ length: profile.others.count }, () => profile.others)]
    for (const [index, spec] of specs.entries()) {
      const result = await generateCompany(client, index, spec, now)
      totals.companies++
      totals.entries += result.entries
      totals.lines += result.lines
      totals.transactions += result.transactions
    }
    // Triggers are off while seeding: set the company of lines and bank
    // transactions that the row level security triggers maintain (docs/rls.md).
    await client.query(`UPDATE "entry_lines" l SET "companyId" = e."companyId" FROM "accounting_entries" e WHERE e."id" = l."accountingEntryId"`)
    await client.query(`UPDATE "bank_transactions" t SET "companyId" = c."companyId"
      FROM "bank_accounts" a JOIN "bank_connections" c ON c."id" = a."bankConnectionId" WHERE a."id" = t."bankAccountId"`)
    await client.query('SET session_replication_role = origin')
    await client.query('ANALYZE')
  } finally {
    await client.end()
  }
  return { profile: profile.name, ...totals, seconds: Math.round((Date.now() - started) / 100) / 10 }
}

async function main() {
  const args = process.argv.slice(2)
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? args[i + 1] : undefined
  }
  const profile = PROFILES[flag('profile') ?? 'small']
  if (!profile) throw new Error(`Unknown profile; use one of ${Object.keys(PROFILES).join(', ')}`)
  const database = flag('db') ?? `kledg_bench_${profile.name}_${Date.now()}`
  const url = await createDatabase(database)
  try {
    const summary = await seedDataset(url, profile)
    process.stdout.write(`${JSON.stringify({ database, url: url.replace(/:[^:@/]+@/, ':***@'), ...summary })}\n`)
  } finally {
    if (!args.includes('--keep')) await dropDatabase(database)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    process.exit(1)
  })
}
