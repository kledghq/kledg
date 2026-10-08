/**
 * The rows an approved action acts on (finding KLEDG-R3-MCP-01), read the
 * same way when the user approves the action and when it executes.
 *
 * A target is named by a reference (kind, company, id). Its state is every
 * column of the row with its children (entry lines, invoice lines and
 * payments, rule conditions and entry lines...), so any edit changes it.
 * Rules leave out the counters the rules engine updates itself when it
 * applies a rule (usageCount, lastUsedAt, updatedAt): applying a rule is
 * not an edit of it, and run_rules applies the same rule many times.
 *
 * With `lock`, the rows are locked first in the caller's transaction
 * (FOR UPDATE for the rows the action changes, FOR SHARE for the rules it
 * applies), so the state read is the one the action works on until its
 * transaction ends: an edit either commits before (and is seen) or waits
 * for the action to finish.
 */

import { createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { canonicalJson } from '@/lib/mcp/full-control/canonical-json'

export type Db = Prisma.TransactionClient | typeof prisma

export type TargetRef =
  | { kind: 'entry'; companyId: string; id: string }
  | { kind: 'invoice'; companyId: string; id: string }
  | { kind: 'expenseReport'; companyId: string; id: string }
  | { kind: 'rule'; companyId: string; id: string }
  /** Every assignment rule of the company: the set run_rules and the refresh apply. */
  | { kind: 'rules'; companyId: string }
  /** Any row of a table of TABLES, every column (its content is approved). */
  | { kind: 'row'; table: TargetTable; companyId: string; id: string }
  /**
   * A stable parent row locked only to serialize (the company, a fiscal
   * year, a bank account): its content is not approved, only its existence,
   * so unrelated edits of the parent (a setting, a sync date) do not refuse
   * the action. Used where the action creates rows that do not exist yet.
   */
  | { kind: 'lock'; table: TargetTable; companyId: string | null; id: string }
  /**
   * Every row of `table` under a parent (the entries of a fiscal year): a
   * digest of their content, the rows locked FOR SHARE so they cannot be
   * edited or deleted until the action ends.
   */
  | { kind: 'children'; table: TargetTable; companyId: string; column: string; id: string }

/**
 * Tables a generic target may name: the table (`from`), the condition that
 * keeps a row in its company, and the parent columns a `children` target
 * may name. Identifiers are only ever taken from here, never from a
 * request, and are literal SQL fragments; every value is a bind parameter.
 */
type CompanyScope = ((companyId: string) => Prisma.Sql) | null
interface TableSpec {
  from: Prisma.Sql
  company: CompanyScope
  columns: Readonly<Record<string, Prisma.Sql>>
}

const ID = { id: Prisma.sql`"id"` } as const
const byCompany: CompanyScope = (companyId) => Prisma.sql`"companyId" = ${companyId}`

export const TABLES = {
  companies: { from: Prisma.sql`"companies"`, company: (companyId) => Prisma.sql`"id" = ${companyId}`, columns: ID },
  user: { from: Prisma.sql`"user"`, company: null, columns: ID },
  fiscal_years: { from: Prisma.sql`"fiscal_years"`, company: byCompany, columns: ID },
  accounts: { from: Prisma.sql`"accounts"`, company: byCompany, columns: ID },
  journals: { from: Prisma.sql`"journals"`, company: byCompany, columns: ID },
  bank_connections: { from: Prisma.sql`"bank_connections"`, company: byCompany, columns: ID },
  bank_accounts: {
    from: Prisma.sql`"bank_accounts"`,
    company: (companyId) => Prisma.sql`"bankConnectionId" IN (SELECT "id" FROM "bank_connections" WHERE "companyId" = ${companyId})`,
    columns: ID,
  },
  bank_transactions: { from: Prisma.sql`"bank_transactions"`, company: byCompany, columns: ID },
  accounting_entries: { from: Prisma.sql`"accounting_entries"`, company: byCompany, columns: { ...ID, fiscalYearId: Prisma.sql`"fiscalYearId"` } },
  entry_lines: { from: Prisma.sql`"entry_lines"`, company: byCompany, columns: ID },
  tiers: { from: Prisma.sql`"tiers"`, company: byCompany, columns: ID },
  budgets: { from: Prisma.sql`"budgets"`, company: byCompany, columns: ID },
  budget_lines: {
    from: Prisma.sql`"budget_lines"`,
    company: (companyId) => Prisma.sql`"budgetId" IN (SELECT "id" FROM "budgets" WHERE "companyId" = ${companyId})`,
    columns: ID,
  },
  provisions: { from: Prisma.sql`"provisions"`, company: byCompany, columns: ID },
  investment_grants: { from: Prisma.sql`"investment_grants"`, company: byCompany, columns: ID },
  expense_claimants: { from: Prisma.sql`"expense_claimants"`, company: byCompany, columns: ID },
  expense_category_rules: { from: Prisma.sql`"expense_category_rules"`, company: byCompany, columns: ID },
  management_fee_conventions: { from: Prisma.sql`"management_fee_conventions"`, company: byCompany, columns: ID },
  fixed_assets: { from: Prisma.sql`"fixed_assets"`, company: byCompany, columns: ID },
  company_invitations: { from: Prisma.sql`"company_invitations"`, company: byCompany, columns: ID },
} as const satisfies Record<string, TableSpec>

export type TargetTable = keyof typeof TABLES

/** Generic targets (row, lock, children): their actions run in one transaction (lib/approved-state/ambient.ts). */
export function isGenericTarget(ref: TargetRef): boolean {
  return ref.kind === 'row' || ref.kind === 'lock' || ref.kind === 'children'
}

function scopeOf(spec: TableSpec, companyId: string | null): Prisma.Sql {
  if (spec.company === null) return Prisma.sql`TRUE`
  // A generic target of a company table always names its company.
  return companyId === null ? Prisma.sql`FALSE` : spec.company(companyId)
}

async function loadGeneric(db: Db, ref: Extract<TargetRef, { kind: 'row' | 'lock' | 'children' }>, lock: boolean): Promise<unknown> {
  if (!Object.hasOwn(TABLES, ref.table)) throw new Error(`Unknown target table ${ref.table}`)
  const spec: TableSpec = TABLES[ref.table]
  const where = scopeOf(spec, ref.companyId)
  if (ref.kind === 'children') {
    const column = Object.hasOwn(spec.columns, ref.column) ? spec.columns[ref.column] : undefined
    if (!column) throw new Error(`Unknown target column ${ref.column}`)
    const parent = Prisma.sql`${column} = ${ref.id} AND ${where}`
    if (lock) await db.$queryRaw`SELECT "id" FROM ${spec.from} WHERE ${parent} ORDER BY "id" FOR SHARE`
    const rows = await db.$queryRaw<Array<{ digest: string; count: bigint }>>`
      SELECT md5(coalesce(string_agg(to_jsonb(t)::text, ',' ORDER BY t."id"), '')) AS digest, count(*) AS count FROM ${spec.from} t WHERE ${parent}`
    return { digest: rows?.[0]?.digest ?? '', count: Number(rows?.[0]?.count ?? 0) }
  }
  // FOR NO KEY UPDATE: blocks edits of the row, not the inserts of rows that reference it.
  const rows = await db.$queryRaw<Array<{ row: unknown }>>`
    SELECT to_jsonb(t) AS row FROM ${spec.from} t WHERE "id" = ${ref.id} AND ${where}${lock ? Prisma.sql` FOR NO KEY UPDATE` : Prisma.empty}`
  if (ref.kind === 'lock') return (rows?.length ?? 0) > 0
  return rows?.[0]?.row ?? null
}

/** Unique name of a target. */
export function targetKey(ref: TargetRef): string {
  switch (ref.kind) {
    case 'rules':
      return `rules:${ref.companyId}`
    case 'row':
    case 'lock':
      return `${ref.kind}:${ref.table}:${ref.companyId ?? ''}:${ref.id}`
    case 'children':
      return `children:${ref.table}:${ref.column}:${ref.companyId}:${ref.id}`
    default:
      return `${ref.kind}:${ref.companyId}:${ref.id}`
  }
}

/** JSON as stored (Decimal, Date and other toJSON values serialized the same way). */
export function normalizeState(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null))
}

/** SHA-256 of a state (canonical JSON). */
export function stateHash(state: unknown): string {
  return createHash('sha256').update(canonicalJson(normalizeState(state))).digest('hex')
}

/** Columns of a rule the engine changes when it applies it: not part of its state. */
const RULE_COUNTERS = { usageCount: true, lastUsedAt: true, updatedAt: true } as const

type RuleRow = Record<string, unknown> & { id: string }

function ruleContent(rule: RuleRow): Record<string, unknown> {
  return Object.fromEntries(Object.entries(rule).filter(([key]) => !(key in RULE_COUNTERS)))
}

const RULE_INCLUDE = { conditions: { orderBy: { id: 'asc' } }, entryLines: { orderBy: { id: 'asc' } } } as const

async function loadRules(db: Db, companyId: string, ruleId: string | undefined, lock: boolean) {
  if (lock) {
    const rules = ruleId
      ? await db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "transaction_rules" WHERE "id" = ${ruleId} AND "companyId" = ${companyId} ORDER BY "id" FOR SHARE`
      : await db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "transaction_rules" WHERE "companyId" = ${companyId} ORDER BY "id" FOR SHARE`
    const ids = rules.map((r) => r.id)
    if (ids.length > 0) {
      await db.$queryRaw`SELECT "id" FROM "transaction_rule_conditions" WHERE "ruleId" = ANY(${ids}) ORDER BY "id" FOR SHARE`
      await db.$queryRaw`SELECT "id" FROM "transaction_rule_entry_lines" WHERE "ruleId" = ANY(${ids}) ORDER BY "id" FOR SHARE`
    }
  }
  const rows = await db.transactionRule.findMany({
    where: { companyId, ...(ruleId && { id: ruleId }) },
    include: RULE_INCLUDE,
    orderBy: { id: 'asc' },
  })
  return rows.map((row) => ruleContent(row as unknown as RuleRow))
}

/**
 * The state of a target: null when the row does not exist (or belongs to
 * another company). In a transaction with `lock`, the rows are locked
 * before they are read.
 */
export async function loadTargetState(db: Db, ref: TargetRef, options: { lock?: boolean } = {}): Promise<unknown> {
  const lock = options.lock ?? false
  switch (ref.kind) {
    case 'entry': {
      if (lock) {
        await db.$queryRaw`SELECT "id" FROM "accounting_entries" WHERE "id" = ${ref.id} AND "companyId" = ${ref.companyId} FOR UPDATE`
        await db.$queryRaw`SELECT "id" FROM "entry_lines" WHERE "accountingEntryId" = ${ref.id} ORDER BY "id" FOR UPDATE`
      }
      return db.accountingEntry.findFirst({
        where: { id: ref.id, companyId: ref.companyId },
        include: { lines: { orderBy: { id: 'asc' } } },
      })
    }
    case 'invoice': {
      // Edits, posting and payments of an invoice all lock its row first (lockInvoice).
      if (lock) await db.$queryRaw`SELECT "id" FROM "invoices" WHERE "id" = ${ref.id} AND "companyId" = ${ref.companyId} FOR UPDATE`
      return db.invoice.findFirst({
        where: { id: ref.id, companyId: ref.companyId },
        include: { lines: { orderBy: { id: 'asc' } }, vatBreakdown: { orderBy: { id: 'asc' } }, payments: { orderBy: { id: 'asc' } } },
      })
    }
    case 'expenseReport': {
      // Edits, workflow and posting of a report all lock its row first (lockExpenseReport).
      if (lock) await db.$queryRaw`SELECT "id" FROM "expense_reports" WHERE "id" = ${ref.id} AND "companyId" = ${ref.companyId} FOR UPDATE`
      return db.expenseReport.findFirst({
        where: { id: ref.id, companyId: ref.companyId },
        include: { lines: { orderBy: { id: 'asc' } } },
      })
    }
    case 'rule':
      return (await loadRules(db, ref.companyId, ref.id, lock))[0] ?? null
    case 'rules':
      return loadRules(db, ref.companyId, undefined, lock)
    case 'row':
    case 'lock':
    case 'children':
      return loadGeneric(db, ref, lock)
  }
}
