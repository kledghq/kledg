/**
 * The bytes of the receipts Kledg keeps (receipt_files, docs/justificatifs-
 * photo.md, Stockage), wherever they live (lib/storage):
 * - a new file goes to the instance's configured driver: an object under
 *   receipts/<companyId>/<random> (Vercel Blob private store, S3 bucket,
 *   directory), or the row's `content` when nothing is configured
 *   (postgres, as before);
 * - one row per content in a company (SHA-256) stays the deduplication: the
 *   same file staged again reuses the row and its object;
 * - a read goes through the row's own driver (a file written before a
 *   change of driver stays readable while that backend is configured) and
 *   checks the size and the SHA-256 of what comes back: an object changed
 *   or truncated in the bucket is refused, never served;
 * - deleting rows deletes their objects, after the rows (a row is never
 *   left pointing to a deleted object). An object whose deletion fails is
 *   logged and left behind: it is unreachable (random key, no row).
 *
 * Objects are never handed to a browser: the receipt proxy and get_file read
 * them here, after their own authorization.
 */

import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { NotFoundError } from '@/lib/accounting/errors'
import { configuredStorageDriver, newObjectKey, objectStorage, type ObjectStorageDriver, type StorageDriver } from '@/lib/storage'

export const RECEIPT_OBJECT_NAMESPACE = 'receipts'
export const RECEIPT_FILE_UNAVAILABLE = 'Le fichier de ce justificatif est introuvable dans le stockage de Kledg.'

type Db = Prisma.TransactionClient | typeof prisma

export const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Where a new receipt file goes: the configured driver, and its object key when it is not postgres. */
export interface PendingObject {
  driver: ObjectStorageDriver
  key: string
}

/**
 * Writes the bytes of a new file to the configured object storage, before
 * its row exists. Returns null for postgres (the bytes go in the row). The
 * caller creates the row with `receiptFileData`, then calls `discardObject`
 * if the row was not created (another call created it first, or the
 * transaction failed).
 */
export async function putReceiptObject(companyId: string, bytes: Uint8Array, contentType: string, sha256: string): Promise<PendingObject | null> {
  const driver = configuredStorageDriver()
  if (driver === 'postgres') return null
  const key = newObjectKey(RECEIPT_OBJECT_NAMESPACE, companyId)
  await objectStorage(driver).put(key, bytes, { contentType, sha256 })
  return { driver, key }
}

/** Columns of a new receipt_files row: the object's place, or the bytes themselves. */
export function receiptFileData(bytes: Uint8Array, pending: PendingObject | null): { storageDriver: StorageDriver; storageKey: string | null; content: Uint8Array<ArrayBuffer> | null } {
  return pending
    ? { storageDriver: pending.driver, storageKey: pending.key, content: null }
    : { storageDriver: 'postgres', storageKey: null, content: new Uint8Array(bytes) }
}

/** Deletes objects whose rows are gone (or were never created). Failures are logged, never thrown. */
export async function discardObjects(objects: Array<{ storageDriver: string; storageKey: string | null }>): Promise<void> {
  for (const { storageDriver, storageKey } of objects) {
    if (storageDriver === 'postgres' || !storageKey) continue
    try {
      await objectStorage(storageDriver as ObjectStorageDriver).delete(storageKey)
    } catch (error) {
      logger.error('[Receipts] Object left in storage after its row was deleted', { driver: storageDriver, error: error instanceof Error ? error.message : String(error) })
    }
  }
}

export function discardObject(pending: PendingObject | null): Promise<void> {
  return pending ? discardObjects([{ storageDriver: pending.driver, storageKey: pending.key }]) : Promise.resolve()
}

export const RECEIPT_FILE_SELECT = { id: true, sha256: true, size: true, contentType: true, storageDriver: true, storageKey: true, content: true } satisfies Prisma.ReceiptFileSelect
export type ReceiptFileRow = Prisma.ReceiptFileGetPayload<{ select: typeof RECEIPT_FILE_SELECT }>

/** The bytes of a row, from its own driver, checked against its size and SHA-256. */
export async function readReceiptFileBytes(row: ReceiptFileRow): Promise<Uint8Array> {
  let bytes: Uint8Array | null
  if (row.storageDriver === 'postgres') {
    bytes = row.content ? new Uint8Array(row.content) : null
  } else {
    if (!row.storageKey) throw new NotFoundError(RECEIPT_FILE_UNAVAILABLE)
    bytes = await objectStorage(row.storageDriver as ObjectStorageDriver).get(row.storageKey)
  }
  if (!bytes) throw new NotFoundError(RECEIPT_FILE_UNAVAILABLE)
  if (bytes.byteLength !== row.size || sha256Hex(bytes) !== row.sha256) {
    logger.error('[Receipts] Stored file does not match its SHA-256', { fileId: row.id, driver: row.storageDriver })
    throw new NotFoundError(RECEIPT_FILE_UNAVAILABLE)
  }
  return bytes
}

/** A receipt file of the company: its bytes and type, or "introuvable". */
export async function readReceiptFile(companyId: string, fileId: string, db: Db = prisma): Promise<{ bytes: Uint8Array; contentType: string; size: number }> {
  const row = await db.receiptFile.findFirst({ where: { id: fileId, companyId }, select: RECEIPT_FILE_SELECT })
  if (!row) throw new NotFoundError(RECEIPT_FILE_UNAVAILABLE)
  return { bytes: await readReceiptFileBytes(row), contentType: row.contentType, size: row.size }
}

/**
 * Deletes the company's receipt files that nothing refers to any more (no
 * staged receipt, no attachment), `onlyId` alone when given, then their
 * objects. One statement: a file that a concurrent staging re-uses is
 * either still referenced (kept) or already gone (that staging writes a new
 * object).
 */
export async function deleteUnreferencedReceiptFiles(companyId: string, onlyId?: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ storageDriver: string; storageKey: string | null }>>`
    DELETE FROM "receipt_files" f
    WHERE f."companyId" = ${companyId}
      ${onlyId ? Prisma.sql`AND f."id" = ${onlyId}` : Prisma.empty}
      AND NOT EXISTS (SELECT 1 FROM "staged_receipts" s WHERE s."fileId" = f."id")
      AND NOT EXISTS (SELECT 1 FROM "attachments" a WHERE a."receiptFileId" = f."id")
    RETURNING f."storageDriver", f."storageKey"`
  await discardObjects(rows)
  return rows.length
}

/** Object keys of a company's receipt files (read before the company is deleted, its rows going by cascade). */
export async function companyReceiptObjects(companyId: string, db: Db = prisma): Promise<Array<{ storageDriver: string; storageKey: string | null }>> {
  return db.receiptFile.findMany({ where: { companyId, storageKey: { not: null } }, select: { storageDriver: true, storageKey: true } })
}
