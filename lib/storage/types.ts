/**
 * Object storage of the files Kledg keeps itself (the receipts of
 * lib/receipts, docs/justificatifs-photo.md). One interface, one driver per
 * backend, chosen by the environment (lib/storage/config.ts):
 * - `blob`: Vercel Blob, private store only (lib/storage/drivers/blob.ts);
 * - `s3`: any S3 compatible service, AWS S3, Cloudflare R2, MinIO, Scaleway
 *   (lib/storage/drivers/s3.ts);
 * - `fs`: a directory of the server (lib/storage/drivers/fs.ts);
 * - `postgres`: no object storage, the bytes stay in the database row
 *   (receipt_files.content), the fallback when nothing is configured.
 *
 * Objects are never served to a browser by URL: every read goes through
 * Kledg's authorized routes (receipt proxy, get_file), which call `get`.
 */

export const STORAGE_DRIVERS = ['postgres', 'blob', 's3', 'fs'] as const
export type StorageDriver = (typeof STORAGE_DRIVERS)[number]
/** A driver that keeps objects outside the database. */
export type ObjectStorageDriver = Exclude<StorageDriver, 'postgres'>

export interface PutObjectOptions {
  /** Media type of the object (checked from the bytes by the caller). */
  contentType: string
  /** SHA-256 of the bytes, hex: stored as object metadata where the backend has some. */
  sha256: string
}

export interface ObjectStorage {
  readonly driver: ObjectStorageDriver
  /** Writes the object. A key is written once (keys are random): the drivers never overwrite. */
  put(key: string, body: Uint8Array, options: PutObjectOptions): Promise<void>
  /** The object's bytes, or null when it does not exist. */
  get(key: string): Promise<Uint8Array | null>
  /** The object as a stream, or null when it does not exist. */
  getStream(key: string): Promise<ReadableStream<Uint8Array> | null>
  /** Deletes the object; deleting a missing object is not an error. */
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}

/**
 * Object keys: `<namespace>/<companyId>/<random>`, nothing else. Letters,
 * digits, `_` and `-` in each of the three segments, so a key never holds a
 * path (`..`), a query or a scheme, whatever the driver does with it.
 */
const KEY = /^[a-z][a-z0-9-]{0,31}\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{16,128}$/

export function assertObjectKey(key: string): string {
  if (!KEY.test(key)) throw new Error('Invalid object key')
  return key
}

/** Reads a stream to the end, refusing more than `maxBytes`. */
export async function readStream(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new Error(`Stored object larger than ${maxBytes} bytes`)
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** Largest object a driver reads into memory (a receipt is 5 MB at most; room for other files later). */
export const MAX_OBJECT_BYTES = 25 * 1024 * 1024
