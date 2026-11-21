/**
 * Integrity of the ledger (#147). The database refuses any change to a
 * validated entry or its lines (PCG art. 1031-3, triggers of migration
 * 20261003180000), and keeps evidence that no change went past it:
 *
 * - every validated entry carries the SHA-256 of its content and lines
 *   (contentHash, written by the database at validation: SQL function
 *   kledg_entry_hash);
 * - each period lock and each closing writes a seal of the fiscal year:
 *   the hash of the content hashes of its validated entries, in validation
 *   order (ledger_seals, append only); the order and the cut are the
 *   database's own clock at hashing (hashedAt), not validatedAt, which an
 *   imported FEC takes from the file.
 *
 * verifyLedger recomputes both. An entry whose content no longer matches
 * its hash, or a seal that no longer matches the entries it covered, was
 * changed in the database outside Kledg, by someone holding the database
 * itself. This is evidence, not a certification (docs/conformite.md).
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type Db = Pick<Prisma.TransactionClient, '$queryRaw' | 'ledgerSeal'>

/** Seals the validated entries of a fiscal year as they stand in the transaction. */
export async function sealFiscalYearInTx(
  tx: Db,
  input: { companyId: string; fiscalYearId: string; reason: 'period_lock' | 'closing'; throughDay?: Date | null; userId?: string | null },
): Promise<{ id: string; entryCount: number; sealHash: string }> {
  const [seal] = await tx.$queryRaw<Array<{ entry_count: number; last_hashed_at: Date | null; seal_hash: string }>>`
    SELECT entry_count, last_hashed_at, seal_hash FROM kledg_ledger_seal(${input.fiscalYearId}, NULL)`
  return tx.ledgerSeal.create({
    data: {
      companyId: input.companyId,
      fiscalYearId: input.fiscalYearId,
      reason: input.reason,
      throughDay: input.throughDay ?? null,
      entryCount: seal.entry_count,
      lastHashedAt: seal.last_hashed_at,
      sealHash: seal.seal_hash,
      createdById: input.userId ?? null,
    },
    select: { id: true, entryCount: true, sealHash: true },
  })
}

export interface LedgerVerification {
  /** Validated entries checked. */
  entriesChecked: number
  /** Validated entries whose content no longer matches their hash. */
  alteredEntries: string[]
  /** Validated entries without a hash (validated before the database wrote them, none since the migration). */
  unhashedEntries: number
  /** Seals checked, and those that no longer match the entries they covered. */
  sealsChecked: number
  brokenSeals: Array<{ createdAt: string; reason: string; entryCount: number }>
}

/** Recomputes the hashes of a fiscal year's validated entries and its seals. */
export async function verifyLedger(companyId: string, fiscalYearId: string, db: Pick<Prisma.TransactionClient, '$queryRaw' | 'ledgerSeal'> = prisma): Promise<LedgerVerification> {
  const entries = await db.$queryRaw<Array<{ entryNumber: string; stored: string | null; actual: string }>>`
    SELECT e."entryNumber", e."contentHash" AS stored,
      kledg_entry_hash(e."id", e."entryNumber", e."date", e."journalId", e."companyId", e."fiscalYearId",
        e."description", e."reference", e."pieceDate", e."reversalOfId") AS actual
    FROM "accounting_entries" e
    WHERE e."companyId" = ${companyId} AND e."fiscalYearId" = ${fiscalYearId} AND e."status" = 'validated'`
  const seals = await db.ledgerSeal.findMany({
    where: { companyId, fiscalYearId },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true, reason: true, entryCount: true, lastHashedAt: true, sealHash: true },
  })
  const brokenSeals: LedgerVerification['brokenSeals'] = []
  for (const seal of seals) {
    const [now] = await db.$queryRaw<Array<{ entry_count: number; seal_hash: string }>>`
      SELECT entry_count, seal_hash FROM kledg_ledger_seal(${fiscalYearId}, ${seal.lastHashedAt ?? new Date(0)}::timestamp)`
    const empty = seal.entryCount === 0 && now.entry_count === 0
    if (!empty && (now.entry_count !== seal.entryCount || now.seal_hash !== seal.sealHash)) {
      brokenSeals.push({ createdAt: seal.createdAt.toISOString(), reason: seal.reason, entryCount: seal.entryCount })
    }
  }
  return {
    entriesChecked: entries.length,
    alteredEntries: entries.filter((e) => e.stored !== null && e.stored !== e.actual).map((e) => e.entryNumber),
    unhashedEntries: entries.filter((e) => e.stored === null).length,
    sealsChecked: seals.length,
    brokenSeals,
  }
}

/** French lines for a report: empty when the ledger matches its hashes and seals. */
export function verificationProblems(v: LedgerVerification): string[] {
  const out: string[] = []
  if (v.alteredEntries.length > 0) {
    out.push(
      `${v.alteredEntries.length} écriture(s) validée(s) ne correspondent plus à leur empreinte (n° ${v.alteredEntries.slice(0, 10).join(', ')}${v.alteredEntries.length > 10 ? '...' : ''}) : elles ont été modifiées dans la base de données en dehors de Kledg.`,
    )
  }
  if (v.brokenSeals.length > 0) {
    out.push(
      `${v.brokenSeals.length} scellement(s) du grand livre ne correspondent plus aux écritures qu'ils couvraient (premier : ${v.brokenSeals[0].createdAt.slice(0, 10)}) : des écritures validées ont été modifiées, ajoutées ou supprimées dans la base de données en dehors de Kledg.`,
    )
  }
  return out
}
