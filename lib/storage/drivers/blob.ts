/**
 * Vercel Blob driver, PRIVATE stores only (@vercel/blob >= 2.3,
 * https://vercel.com/docs/vercel-blob/private-storage, checked 2026-10-08).
 *
 * - Every call passes `access: 'private'`: on a public store the Blob API
 *   refuses it, so a receipt never lands at a public URL. The blob URL
 *   (`<store>.private.blob.vercel-storage.com`) needs the store's token: it is
 *   never given to a browser; Kledg's routes read the object with `get` and
 *   stream it after their own authorization.
 * - Credentials: the SDK reads them itself. On Vercel, a store connected to
 *   the project gives BLOB_STORE_ID and the project's OIDC token (short
 *   lived, rotated); elsewhere, or for a team store, BLOB_READ_WRITE_TOKEN.
 * - Keys are random (lib/storage/keys.ts): no random suffix, no overwrite.
 * - Reads bypass the CDN cache (`useCache: false`): a receipt is read
 *   rarely, and a read right after a write (the storage migration checks
 *   what it wrote) must see the object.
 * - The SDK has no server-side encryption option: encryption at rest is
 *   Vercel's, not configurable per object (https://vercel.com/docs/security).
 */

import * as sdk from '@vercel/blob'
import { MAX_OBJECT_BYTES, assertObjectKey, readStream, type ObjectStorage, type PutObjectOptions } from '../types'

/** The part of @vercel/blob the driver uses (a fake in the tests). */
export interface BlobSdk {
  put: typeof sdk.put
  get: typeof sdk.get
  head: typeof sdk.head
  del: typeof sdk.del
  BlobNotFoundError: typeof sdk.BlobNotFoundError
}

export function createBlobStorage(api: BlobSdk = sdk): ObjectStorage {
  const access = 'private' as const
  const isNotFound = (error: unknown) => error instanceof api.BlobNotFoundError

  async function open(key: string) {
    const result = await api.get(assertObjectKey(key), { access, useCache: false })
    return result && result.statusCode === 200 ? result.stream : null
  }

  return {
    driver: 'blob',
    async put(key: string, body: Uint8Array, options: PutObjectOptions) {
      await api.put(assertObjectKey(key), Buffer.from(body.buffer, body.byteOffset, body.byteLength), {
        access,
        contentType: options.contentType,
        addRandomSuffix: false,
        allowOverwrite: false,
      })
    },
    async get(key: string) {
      const stream = await open(key)
      return stream ? readStream(stream, MAX_OBJECT_BYTES) : null
    },
    getStream: open,
    async delete(key: string) {
      try {
        await api.del(assertObjectKey(key))
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
    },
    async exists(key: string) {
      try {
        await api.head(assertObjectKey(key))
        return true
      } catch (error) {
        if (isNotFound(error)) return false
        throw error
      }
    },
  }
}
