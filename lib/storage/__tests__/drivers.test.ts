/**
 * Object storage drivers (lib/storage): one contract, run against each
 * driver: the filesystem in a temporary directory, S3 against an in-memory
 * S3 behind a fake fetch (signed requests checked), Vercel Blob against a
 * fake of the SDK (private access checked). Then the driver choice from the
 * environment.
 */

import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { BlobNotFoundError } from '@vercel/blob'
import { createFsStorage } from '../drivers/fs'
import { createS3Storage, type S3Settings } from '../drivers/s3'
import { createBlobStorage, type BlobSdk } from '../drivers/blob'
import { configuredStorageDriver, s3SettingsFrom, storageDirFrom, StorageConfigError } from '../config'
import { newObjectKey } from '../keys'
import { assertObjectKey, type ObjectStorage } from '../types'

const bytes = (text: string) => new TextEncoder().encode(text)
const sha = 'a'.repeat(64)

/** An in-memory S3: PUT, GET, HEAD, DELETE on path style URLs; records every request. */
function fakeS3() {
  const objects = new Map<string, { body: Uint8Array; headers: Record<string, string> }>()
  const requests: Request[] = []
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const request = input as Request
    requests.push(request)
    if (!request.headers.get('authorization')?.startsWith('AWS4-HMAC-SHA256 ')) return new Response('unsigned', { status: 403 })
    const key = new URL(request.url).pathname
    const found = objects.get(key)
    switch (request.method) {
      case 'PUT':
        objects.set(key, { body: new Uint8Array(await request.arrayBuffer()), headers: Object.fromEntries(request.headers) })
        return new Response(null, { status: 200 })
      case 'GET':
        return found ? new Response(found.body as BodyInit, { status: 200 }) : new Response('<Error/>', { status: 404 })
      case 'HEAD':
        return new Response(null, { status: found ? 200 : 404 })
      case 'DELETE':
        objects.delete(key)
        return new Response(null, { status: 204 })
      default:
        return new Response(null, { status: 405 })
    }
  }) as typeof fetch
  return { objects, requests, fetchImpl }
}

/** A fake @vercel/blob: refuses anything but private access, like a private store. */
function fakeBlobSdk() {
  const blobs = new Map<string, { body: Uint8Array; contentType: string }>()
  const calls: Array<{ op: string; pathname: string; options?: Record<string, unknown> }> = []
  const notFound = () => new BlobNotFoundError()
  const api = {
    BlobNotFoundError,
    put: async (pathname: string, body: Buffer, options: { access: string; contentType: string; allowOverwrite?: boolean }) => {
      calls.push({ op: 'put', pathname, options })
      if (options.access !== 'private') throw new Error('public access on a private store')
      if (blobs.has(pathname) && !options.allowOverwrite) throw new Error('exists')
      blobs.set(pathname, { body: new Uint8Array(body), contentType: options.contentType })
      return { url: `https://store.private.blob.vercel-storage.com/${pathname}`, pathname }
    },
    get: async (pathname: string, options: { access: string; useCache?: boolean }) => {
      calls.push({ op: 'get', pathname, options })
      if (options.access !== 'private') throw new Error('public access on a private store')
      const blob = blobs.get(pathname)
      if (!blob) return null
      return { statusCode: 200, stream: new Response(blob.body as BodyInit).body, headers: new Headers(), blob: { contentType: blob.contentType, size: blob.body.byteLength } }
    },
    head: async (pathname: string) => {
      calls.push({ op: 'head', pathname })
      if (!blobs.has(pathname)) throw notFound()
      return { pathname }
    },
    del: async (pathname: string) => {
      calls.push({ op: 'del', pathname })
      blobs.delete(pathname)
    },
  }
  return { blobs, calls, api: api as unknown as BlobSdk }
}

const dirs: string[] = []
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
})

const s3Settings: S3Settings = {
  endpoint: 'https://minio.example.test:9000',
  region: 'auto',
  bucket: 'kledg-receipts',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secret',
  forcePathStyle: true,
  sse: { algorithm: 'AES256' },
}

const drivers: Array<[string, () => Promise<ObjectStorage>]> = [
  [
    'fs',
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'kledg-storage-'))
      dirs.push(dir)
      return createFsStorage(dir)
    },
  ],
  ['s3', async () => createS3Storage(s3Settings, fakeS3().fetchImpl)],
  ['blob', async () => createBlobStorage(fakeBlobSdk().api)],
]

describe.each(drivers)('%s driver contract', (_name, make) => {
  it('puts, reads (buffer and stream), checks and deletes an object', async () => {
    const storage = await make()
    const key = newObjectKey('receipts', 'company1')
    expect(await storage.exists(key)).toBe(false)
    expect(await storage.get(key)).toBeNull()
    expect(await storage.getStream(key)).toBeNull()

    await storage.put(key, bytes('ticket'), { contentType: 'image/jpeg', sha256: sha })
    expect(await storage.exists(key)).toBe(true)
    expect(new TextDecoder().decode((await storage.get(key))!)).toBe('ticket')
    const stream = await storage.getStream(key)
    expect(await new Response(stream).text()).toBe('ticket')

    await storage.delete(key)
    expect(await storage.exists(key)).toBe(false)
    // Deleting a missing object is not an error.
    await storage.delete(key)
  })

  it('refuses keys that are not namespace/company/random', async () => {
    const storage = await make()
    for (const key of ['../etc/passwd', 'receipts/../../x/aaaaaaaaaaaaaaaa', 'receipts/c1/short', 'https://evil.test/a/bbbbbbbbbbbbbbbbbb', 'receipts/c1/aaaaaaaaaaaaaaaa?x=1']) {
      await expect(storage.put(key, bytes('x'), { contentType: 'image/png', sha256: sha })).rejects.toThrow('Invalid object key')
      await expect(storage.get(key)).rejects.toThrow('Invalid object key')
    }
  })
})

describe('object keys', () => {
  it('are namespaced per company, random and never the content hash', () => {
    const a = newObjectKey('receipts', 'cmp_1')
    const b = newObjectKey('receipts', 'cmp_1')
    expect(a).toMatch(/^receipts\/cmp_1\/[A-Za-z0-9_-]{32}$/)
    expect(a).not.toBe(b)
    expect(() => assertObjectKey(a)).not.toThrow()
  })
})

describe('fs driver', () => {
  it('writes files readable by the server user only, without temporary leftovers', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kledg-storage-'))
    dirs.push(dir)
    const storage = createFsStorage(dir)
    const key = newObjectKey('receipts', 'company1')
    await storage.put(key, bytes('ticket'), { contentType: 'image/jpeg', sha256: sha })
    expect((await stat(path.join(dir, key))).mode & 0o777).toBe(0o600)
    expect((await stat(path.join(dir, 'receipts/company1'))).mode & 0o777).toBe(0o700)
    expect(await readdir(path.join(dir, 'receipts/company1'))).toHaveLength(1)
    await expect(storage.put(key, bytes('other'), { contentType: 'image/jpeg', sha256: sha })).rejects.toThrow()
    expect(new TextDecoder().decode((await storage.get(key))!)).toBe('ticket')
  })
})

describe('s3 driver', () => {
  it('signs every request, asks for server-side encryption and stores the SHA-256 as metadata', async () => {
    const s3 = fakeS3()
    const storage = createS3Storage(s3Settings, s3.fetchImpl)
    const key = newObjectKey('receipts', 'company1')
    await storage.put(key, bytes('ticket'), { contentType: 'application/pdf', sha256: sha })
    const put = s3.requests[0]
    expect(put.url).toBe(`https://minio.example.test:9000/kledg-receipts/${key}`)
    expect(put.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request/)
    expect(put.headers.get('x-amz-server-side-encryption')).toBe('AES256')
    expect(put.headers.get('x-amz-meta-sha256')).toBe(sha)
    expect(put.headers.get('content-type')).toBe('application/pdf')
  })

  it('uses virtual host addressing on AWS and fails on refused calls', async () => {
    const requests: string[] = []
    const storage = createS3Storage({ ...s3Settings, endpoint: null, region: 'eu-west-3', forcePathStyle: false }, (async (request: Request) => {
      requests.push(request.url)
      return new Response('denied', { status: 403 })
    }) as unknown as typeof fetch)
    const key = newObjectKey('receipts', 'company1')
    await expect(storage.put(key, bytes('x'), { contentType: 'image/png', sha256: sha })).rejects.toThrow('PutObject failed (HTTP 403)')
    await expect(storage.get(key)).rejects.toThrow('GetObject failed (HTTP 403)')
    expect(requests[0]).toBe(`https://kledg-receipts.s3.eu-west-3.amazonaws.com/${key}`)
  })
})

describe('blob driver', () => {
  it('uses private access only, no random suffix, no overwrite, reads from origin', async () => {
    const blob = fakeBlobSdk()
    const storage = createBlobStorage(blob.api)
    const key = newObjectKey('receipts', 'company1')
    await storage.put(key, bytes('ticket'), { contentType: 'image/jpeg', sha256: sha })
    await storage.get(key)
    expect(blob.calls[0]).toMatchObject({ op: 'put', pathname: key, options: { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'image/jpeg' } })
    expect(blob.calls[1]).toMatchObject({ op: 'get', pathname: key, options: { access: 'private', useCache: false } })
  })
})

describe('driver choice', () => {
  it('follows KLEDG_STORAGE_DRIVER, else the first configured backend, else postgres', () => {
    expect(configuredStorageDriver({})).toBe('postgres')
    expect(configuredStorageDriver({ KLEDG_STORAGE_DIR: '/data' })).toBe('fs')
    expect(configuredStorageDriver({ KLEDG_STORAGE_DIR: '/data', KLEDG_S3_BUCKET: 'b' })).toBe('s3')
    expect(configuredStorageDriver({ KLEDG_S3_BUCKET: 'b', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_x' })).toBe('blob')
    expect(configuredStorageDriver({ BLOB_STORE_ID: 'store_1' })).toBe('blob')
    expect(configuredStorageDriver({ BLOB_READ_WRITE_TOKEN: 'x', KLEDG_STORAGE_DRIVER: 'postgres' })).toBe('postgres')
    expect(() => configuredStorageDriver({ KLEDG_STORAGE_DRIVER: 'ftp' })).toThrow(StorageConfigError)
  })

  it('reads the S3 settings, with encryption on AWS by default and off with an endpoint', () => {
    const keys = { KLEDG_S3_BUCKET: 'b', KLEDG_S3_ACCESS_KEY_ID: 'id', KLEDG_S3_SECRET_ACCESS_KEY: 's' }
    expect(s3SettingsFrom({ ...keys, KLEDG_S3_REGION: 'eu-west-3' })).toMatchObject({ endpoint: null, forcePathStyle: false, sse: { algorithm: 'AES256' } })
    expect(s3SettingsFrom({ ...keys, KLEDG_S3_ENDPOINT: 'http://minio:9000' })).toMatchObject({ region: 'auto', forcePathStyle: true, sse: null })
    expect(s3SettingsFrom({ ...keys, KLEDG_S3_ENDPOINT: 'https://x.r2.cloudflarestorage.com', KLEDG_S3_SSE: 'aws:kms', KLEDG_S3_SSE_KMS_KEY_ID: 'k' })).toMatchObject({ sse: { algorithm: 'aws:kms', kmsKeyId: 'k' } })
    expect(() => s3SettingsFrom({ KLEDG_S3_BUCKET: 'b' })).toThrow('KLEDG_S3_ACCESS_KEY_ID, KLEDG_S3_SECRET_ACCESS_KEY')
    expect(() => s3SettingsFrom({ ...keys })).toThrow('KLEDG_S3_REGION')
    expect(() => s3SettingsFrom({ ...keys, KLEDG_S3_ENDPOINT: 'ftp://x' })).toThrow(StorageConfigError)
    expect(() => s3SettingsFrom({ ...keys, KLEDG_S3_REGION: 'r', KLEDG_S3_SSE: 'rot13' })).toThrow(StorageConfigError)
  })

  it('refuses the filesystem on a serverless host', () => {
    expect(storageDirFrom({ KLEDG_STORAGE_DIR: '/data' })).toBe('/data')
    expect(() => storageDirFrom({ KLEDG_STORAGE_DIR: '/data', VERCEL: '1' })).toThrow(StorageConfigError)
  })
})
