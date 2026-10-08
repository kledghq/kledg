/**
 * Moves receipt files to the configured storage (`pnpm receipts:migrate-
 * storage`, or KLEDG_STORAGE_MIGRATE=on at server start; docs/
 * configuration.md, Stockage des justificatifs). Typically the database
 * bytes of the files kept before object storage existed, to Vercel Blob,
 * S3 or a directory; it also moves files from one object storage to
 * another, or back into the database (KLEDG_STORAGE_DRIVER=postgres).
 *
 * For each file not on the target driver, one at a time:
 * 1. read its bytes from where they are and check them against the row's
 *    size and SHA-256 (a file that does not match is reported, never moved);
 * 2. write them to the target (a new random key under the company's prefix)
 *    and read them back, checked the same way;
 * 3. switch the row in one conditional update (only if it is still where it
 *    was read): the database bytes are cleared in the same statement;
 * 4. delete the old object, if it was one.
 * A failure leaves the row where it was (the new object is deleted), so the
 * move is resumable: run it again and it goes on with what is left. Running
 * it twice moves nothing twice (idempotent).
 *
 * Every company's files: the work runs in the system context (row level
 * security, docs/rls.md), reason `storage-migration`.
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { withSystemContext } from '@/lib/rls/context'
import { configuredStorageDriver, newObjectKey, objectStorage, type ObjectStorageDriver, type StorageDriver } from '@/lib/storage'
import { offloadExpenseReceiptsToQonto, qontoExpenseReceiptsEnabled } from './offload-to-qonto.service'
import { RECEIPT_FILE_SELECT, RECEIPT_OBJECT_NAMESPACE, discardObjects, readReceiptFileBytes, sha256Hex } from './receipt-file-store'

export interface MigrateReceiptStorageOptions {
  /** Count what would move, move nothing. */
  dryRun?: boolean
  /** Only this company. */
  companyId?: string
  /** Rows read per batch (default 25). */
  batchSize?: number
  /** Stop after this many files (default: all). */
  limit?: number
  /** Progress lines (the script prints them). */
  onProgress?: (line: string) => void
}

export interface MigrateReceiptStorageResult {
  target: StorageDriver
  /** Files on another driver before the run. */
  pending: number
  moved: number
  /** Files whose stored bytes do not match their SHA-256 or are missing: left as they are. */
  invalid: string[]
  /** Files the run could not move (storage error): left as they are, moved by a later run. */
  failed: string[]
}

export function migrateReceiptStorage(options: MigrateReceiptStorageOptions = {}): Promise<MigrateReceiptStorageResult> {
  return withSystemContext('storage-migration', () => run(options))
}

async function run(options: MigrateReceiptStorageOptions): Promise<MigrateReceiptStorageResult> {
  const target = configuredStorageDriver()
  const scope = { storageDriver: { not: target }, ...(options.companyId ? { companyId: options.companyId } : {}) }
  const pending = await prisma.receiptFile.count({ where: scope })
  const result: MigrateReceiptStorageResult = { target, pending, moved: 0, invalid: [], failed: [] }
  if (options.dryRun || pending === 0) return result

  // Rows that failed are skipped by id, so a batch never loops on them.
  const skipped: string[] = []
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 25, 200))
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  while (result.moved + skipped.length < Math.min(pending, limit)) {
    const rows = await prisma.receiptFile.findMany({
      where: { ...scope, id: { notIn: skipped } },
      select: { ...RECEIPT_FILE_SELECT, companyId: true },
      orderBy: { id: 'asc' },
      take: batchSize,
    })
    if (rows.length === 0) break
    for (const row of rows) {
      if (result.moved + skipped.length >= limit) break
      const outcome = await moveOne(row, target)
      if (outcome === 'moved') result.moved++
      else {
        skipped.push(row.id)
        ;(outcome === 'invalid' ? result.invalid : result.failed).push(row.id)
      }
    }
    options.onProgress?.(`${result.moved}/${pending} moved to ${target}${skipped.length ? `, ${skipped.length} skipped` : ''}`)
  }
  return result
}

type Row = Awaited<ReturnType<typeof prisma.receiptFile.findMany<{ select: typeof RECEIPT_FILE_SELECT & { companyId: true } }>>>[number]

async function moveOne(row: Row, target: StorageDriver): Promise<'moved' | 'invalid' | 'failed'> {
  let bytes: Uint8Array
  try {
    bytes = await readReceiptFileBytes(row)
  } catch (error) {
    logger.error('[Receipts] Storage migration: file unreadable or not matching its SHA-256, left in place', { fileId: row.id, driver: row.storageDriver, error: message(error) })
    return 'invalid'
  }

  let key: string | null = null
  try {
    if (target !== 'postgres') {
      key = newObjectKey(RECEIPT_OBJECT_NAMESPACE, row.companyId)
      const storage = objectStorage(target as ObjectStorageDriver)
      await storage.put(key, bytes, { contentType: row.contentType, sha256: row.sha256 })
      const back = await storage.get(key)
      if (!back || back.byteLength !== row.size || sha256Hex(back) !== row.sha256) throw new Error('Read back does not match the SHA-256')
    }
    const switched = await prisma.receiptFile.updateMany({
      where: { id: row.id, storageDriver: row.storageDriver, storageKey: row.storageKey },
      data: key ? { storageDriver: target, storageKey: key, content: null } : { storageDriver: 'postgres', storageKey: null, content: new Uint8Array(bytes) },
    })
    if (switched.count === 0) throw new Error('The file changed during the move')
  } catch (error) {
    logger.error('[Receipts] Storage migration: file not moved', { fileId: row.id, target, error: message(error) })
    if (key) await discardObjects([{ storageDriver: target, storageKey: key }])
    return 'failed'
  }
  await discardObjects([{ storageDriver: row.storageDriver, storageKey: row.storageKey }])
  return 'moved'
}

/**
 * `--qonto`: the expense receipts of every company connected to Qonto handed
 * to Qonto (lib/receipts/offload-to-qonto.service.ts), each company narrowed
 * to itself, all of them (not the cron's batch).
 */
export async function offloadAllExpenseReceiptsToQonto(): Promise<{ enabled: boolean; sent: number; kept: number }> {
  if (!qontoExpenseReceiptsEnabled()) return { enabled: false, sent: 0, kept: 0 }
  const companies = await withSystemContext('storage-migration', () =>
    prisma.integration.findMany({ where: { provider: 'QONTO', status: 'active', type: 'BANKING' }, select: { companyId: true }, distinct: ['companyId'] }),
  )
  let sent = 0
  let kept = 0
  for (const { companyId } of companies) {
    const counts = await withSystemContext('storage-migration', () => offloadExpenseReceiptsToQonto(companyId, { limit: 10_000 }), { companyIds: [companyId] })
    sent += counts.sent
    kept += counts.refused + counts.not_readable_yet + counts.mismatch
  }
  return { enabled: true, sent, kept }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * KLEDG_STORAGE_MIGRATE=on: the move runs in the background at server start
 * (instrumentation.ts), for hosts where the operator cannot run the script
 * (the Docker image has no pnpm). It logs its result and never blocks the
 * start; several instances starting together each skip what another moved.
 */
export async function migrateReceiptStorageOnStart(env: Record<string, string | undefined> = process.env): Promise<void> {
  if (!['on', 'true', '1'].includes(env.KLEDG_STORAGE_MIGRATE?.trim().toLowerCase() ?? '')) return
  const result = await migrateReceiptStorage()
  if (result.pending === 0) return
  const log = result.invalid.length || result.failed.length ? logger.warn : logger.info
  log(`[Receipts] Storage migration to ${result.target}: ${result.moved} of ${result.pending} files moved`, { invalid: result.invalid.length, failed: result.failed.length })
}
