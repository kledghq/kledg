/**
 * Which object storage the instance uses (docs/configuration.md, Stockage
 * des justificatifs). KLEDG_STORAGE_DRIVER chooses explicitly; without it the
 * first configured backend wins:
 *
 * 1. `blob`: BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID (a Vercel Blob store
 *    connected to the project, or created by the deploy button);
 * 2. `s3`: KLEDG_S3_BUCKET;
 * 3. `fs`: KLEDG_STORAGE_DIR;
 * 4. `postgres`: nothing configured, the bytes stay in the database, as
 *    before object storage existed.
 *
 * The driver chosen here receives new files. A file keeps the driver it was
 * written with (receipt_files.storageDriver), so an instance that changes
 * driver still reads its older files as long as that backend stays
 * configured; `pnpm receipts:migrate-storage` moves them.
 */

import { STORAGE_DRIVERS, type ObjectStorage, type ObjectStorageDriver, type StorageDriver } from './types'
import { createBlobStorage } from './drivers/blob'
import { createFsStorage } from './drivers/fs'
import { createS3Storage, type S3Settings } from './drivers/s3'

type Env = Record<string, string | undefined>

export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageConfigError'
  }
}

const value = (env: Env, name: string): string | null => env[name]?.trim() || null

/** The driver that receives new files. Throws on an unknown KLEDG_STORAGE_DRIVER. */
export function configuredStorageDriver(env: Env = process.env): StorageDriver {
  const explicit = value(env, 'KLEDG_STORAGE_DRIVER')?.toLowerCase()
  if (explicit) {
    if (!(STORAGE_DRIVERS as readonly string[]).includes(explicit)) {
      throw new StorageConfigError(`KLEDG_STORAGE_DRIVER must be one of ${STORAGE_DRIVERS.join(', ')} (got "${explicit}")`)
    }
    return explicit as StorageDriver
  }
  if (value(env, 'BLOB_READ_WRITE_TOKEN') || value(env, 'BLOB_STORE_ID')) return 'blob'
  if (value(env, 'KLEDG_S3_BUCKET')) return 's3'
  if (value(env, 'KLEDG_STORAGE_DIR')) return 'fs'
  return 'postgres'
}

function flag(env: Env, name: string): boolean | null {
  const raw = value(env, name)?.toLowerCase()
  if (raw === null || raw === undefined) return null
  if (['1', 'true', 'on', 'yes'].includes(raw)) return true
  if (['0', 'false', 'off', 'no'].includes(raw)) return false
  throw new StorageConfigError(`${name} must be true or false`)
}

export function s3SettingsFrom(env: Env = process.env): S3Settings {
  const bucket = value(env, 'KLEDG_S3_BUCKET')
  const accessKeyId = value(env, 'KLEDG_S3_ACCESS_KEY_ID')
  const secretAccessKey = value(env, 'KLEDG_S3_SECRET_ACCESS_KEY')
  const missing = [!bucket && 'KLEDG_S3_BUCKET', !accessKeyId && 'KLEDG_S3_ACCESS_KEY_ID', !secretAccessKey && 'KLEDG_S3_SECRET_ACCESS_KEY'].filter(Boolean)
  if (missing.length > 0) throw new StorageConfigError(`S3 storage needs ${missing.join(', ')}`)
  const endpoint = value(env, 'KLEDG_S3_ENDPOINT')
  if (endpoint) {
    let url: URL
    try {
      url = new URL(endpoint)
    } catch {
      throw new StorageConfigError('KLEDG_S3_ENDPOINT must be a URL (https://...)')
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new StorageConfigError('KLEDG_S3_ENDPOINT must be an http(s) URL')
  }
  const region = value(env, 'KLEDG_S3_REGION') ?? (endpoint ? 'auto' : null)
  if (!region) throw new StorageConfigError('S3 storage on AWS needs KLEDG_S3_REGION')
  const sseRaw = value(env, 'KLEDG_S3_SSE')
  let sse: S3Settings['sse']
  if (sseRaw === null) sse = endpoint ? null : { algorithm: 'AES256' }
  else if (['off', 'none', 'false'].includes(sseRaw.toLowerCase())) sse = null
  else if (sseRaw === 'AES256') sse = { algorithm: 'AES256' }
  else if (sseRaw === 'aws:kms') sse = { algorithm: 'aws:kms', kmsKeyId: value(env, 'KLEDG_S3_SSE_KMS_KEY_ID') }
  else throw new StorageConfigError('KLEDG_S3_SSE must be AES256, aws:kms or off')
  return {
    endpoint,
    region,
    bucket: bucket!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    sessionToken: value(env, 'KLEDG_S3_SESSION_TOKEN'),
    forcePathStyle: flag(env, 'KLEDG_S3_FORCE_PATH_STYLE') ?? endpoint !== null,
    sse,
  }
}

/** The filesystem driver's directory; refused on serverless hosts, whose disk does not persist. */
export function storageDirFrom(env: Env = process.env): string {
  const dir = value(env, 'KLEDG_STORAGE_DIR')
  if (!dir) throw new StorageConfigError('Filesystem storage needs KLEDG_STORAGE_DIR')
  if (env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME || env.NETLIFY) {
    throw new StorageConfigError('Filesystem storage needs a persistent disk: use Vercel Blob or S3 on a serverless host')
  }
  return dir
}

const cache = new Map<ObjectStorageDriver, ObjectStorage>()

/** The object storage of a driver, built from the environment (once per process). */
export function objectStorage(driver: ObjectStorageDriver, env: Env = process.env): ObjectStorage {
  if (env !== process.env) return build(driver, env)
  let storage = cache.get(driver)
  if (!storage) {
    storage = build(driver, env)
    cache.set(driver, storage)
  }
  return storage
}

function build(driver: ObjectStorageDriver, env: Env): ObjectStorage {
  switch (driver) {
    case 'blob':
      return createBlobStorage()
    case 's3':
      return createS3Storage(s3SettingsFrom(env))
    case 'fs':
      return createFsStorage(storageDirFrom(env))
  }
}

/** Test hook: drivers built from a changed environment, or replaced by fakes. */
export function setObjectStorageForTests(driver: ObjectStorageDriver, storage: ObjectStorage | null): void {
  if (storage) cache.set(driver, storage)
  else cache.delete(driver)
}
