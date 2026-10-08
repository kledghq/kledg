/**
 * Entry numbering.
 *
 * Definitive numbers are assigned at validation, never at draft creation:
 * the FEC field EcritureNum is "le numéro sur une séquence continue de
 * l'écriture comptable" (LPF art. A47 A-1) and the numbering "doit être
 * croissante dans le temps et ne pas comporter de rupture" (BOI-CF-IOR-60-40-20
 * § 100), the validation date being the moment a draft becomes definitive by
 * receiving its identifier (same BOFiP, § 250). A draft that is deleted
 * therefore never leaves a gap.
 *
 * Kledg numbers entries with one sequence per fiscal year shared by all
 * journals (1, 2, 3, ...), which BOI-CF-IOR-60-40-20 § 100 allows as well as
 * one sequence per journal. The sequence restarts at 1 each fiscal year
 * (entryNumber is unique per fiscal year). Numbers are assigned under a
 * transaction-scoped advisory lock per fiscal year, so concurrent validations
 * never collide nor skip a number.
 *
 * Drafts carry a provisional number "BR-<random>". The next definitive
 * number reads the largest sequence number of the validated entries with
 * one indexed query (kledg_entry_sequence, the SQL twin of sequentialPartOf,
 * migration 20261125100000_entry_number_sequence), not every entry of the
 * year: bulk validation stays linear.
 */

import { randomBytes } from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Largest sequence number a fiscal year can reach. Longer numbers are not part
 * of the sequence: legacy rule entries were numbered "TR-<timestamp>"
 * (13 digits), and counting them made the next number jump to the timestamp.
 */
const MAX_SEQUENTIAL_DIGITS = 9

/** Prefix of provisional draft numbers. */
export const PROVISIONAL_PREFIX = 'BR-'

/** Whether an entry number is a provisional draft number. */
export function isProvisionalEntryNumber(entryNumber: string): boolean {
  return entryNumber.startsWith(PROVISIONAL_PREFIX)
}

/** A new provisional number for a draft (unique per fiscal year in practice: 48 random bits). */
export function provisionalEntryNumber(): string {
  return `${PROVISIONAL_PREFIX}${randomBytes(6).toString('hex').toUpperCase()}`
}

/**
 * Sequence number of an entry number: the whole number ("42"), or its last
 * group of digits for composed formats ("2026-2" -> 2, "OD-42" -> 42).
 * Null when there is none, it is not sequential (timestamps) or provisional.
 */
export function sequentialPartOf(entryNumber: string): number | null {
  if (isProvisionalEntryNumber(entryNumber)) return null
  const groups = entryNumber.match(/\d+/g)
  const last = groups?.[groups.length - 1]
  if (!last) return null
  const digits = last.replace(/^0+(?=\d)/, '')
  if (digits.length > MAX_SEQUENTIAL_DIGITS) return null
  return parseInt(digits, 10)
}

type EntryReader = Pick<Prisma.TransactionClient, '$queryRaw'>

/**
 * Serializes numbering in a fiscal year until the end of the transaction.
 * Same key as lib/reconciliation, so reconciliation drafts and validations
 * wait for each other.
 */
export async function lockEntryNumbering(
  db: Pick<Prisma.TransactionClient, '$executeRaw'>,
  fiscalYearId: string,
): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:entry-number:${fiscalYearId}`}))`
}

/**
 * Next definitive number of a fiscal year: one more than the largest
 * sequence number of its validated entries (index
 * accounting_entries_validated_sequence_idx). Call under lockEntryNumbering
 * when the number is assigned.
 */
export async function nextDefinitiveEntryNumber(fiscalYearId: string, db: EntryReader = prisma): Promise<string> {
  const [row] = await db.$queryRaw<Array<{ max: bigint | null }>>`
    SELECT max(kledg_entry_sequence("entryNumber")) AS max
    FROM "accounting_entries"
    WHERE "fiscalYearId" = ${fiscalYearId} AND "status" = 'validated'`
  return String(Number(row?.max ?? 0) + 1)
}
