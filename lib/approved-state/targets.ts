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
import type { Prisma } from '@prisma/client'
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

/** Unique name of a target. */
export function targetKey(ref: TargetRef): string {
  return ref.kind === 'rules' ? `rules:${ref.companyId}` : `${ref.kind}:${ref.companyId}:${ref.id}`
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
  }
}
