/**
 * S3 compatible driver: AWS S3, Cloudflare R2, MinIO, Scaleway Object
 * Storage, any service speaking the S3 REST API with Signature V4.
 *
 * Client: aws4fetch (one file, no dependency, Web Crypto) signs each request
 * and fetch sends it. The four calls used (PutObject, GetObject, HeadObject,
 * DeleteObject) are plain HTTP; @aws-sdk/client-s3 would add a few MB of
 * modules and its own HTTP stack to the server bundle for the same calls.
 *
 * - Addressing: path style (`<endpoint>/<bucket>/<key>`) with a custom
 *   endpoint (MinIO needs it, R2 and Scaleway accept it), virtual host
 *   (`<bucket>.s3.<region>.amazonaws.com`) on AWS; KLEDG_S3_FORCE_PATH_STYLE
 *   overrides.
 * - Server-side encryption: `x-amz-server-side-encryption` when configured
 *   (KLEDG_S3_SSE: AES256, or aws:kms with KLEDG_S3_SSE_KMS_KEY_ID). Default
 *   AES256 on AWS; off with a custom endpoint, because MinIO refuses the
 *   header without a KMS (R2 and Scaleway encrypt at rest anyway).
 * - The object's SHA-256 is sent as metadata (x-amz-meta-sha256).
 * - Calls time out after 30 seconds and never follow a redirect.
 */

import { AwsClient } from 'aws4fetch'
import { MAX_OBJECT_BYTES, assertObjectKey, readStream, type ObjectStorage, type PutObjectOptions } from '../types'

export interface S3Settings {
  endpoint: string | null
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string | null
  forcePathStyle: boolean
  sse: { algorithm: 'AES256' } | { algorithm: 'aws:kms'; kmsKeyId: string | null } | null
}

const TIMEOUT_MS = 30_000

export class S3StorageError extends Error {
  constructor(operation: string, status: number) {
    super(`Object storage ${operation} failed (HTTP ${status})`)
    this.name = 'S3StorageError'
  }
}

export function createS3Storage(settings: S3Settings, fetchImpl: typeof fetch = (...args) => fetch(...args)): ObjectStorage {
  const client = new AwsClient({
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    sessionToken: settings.sessionToken ?? undefined,
    service: 's3',
    region: settings.region,
    retries: 0,
  })

  function urlOf(key: string): string {
    const path = assertObjectKey(key).split('/').map(encodeURIComponent).join('/')
    const bucket = encodeURIComponent(settings.bucket)
    if (settings.endpoint) {
      const endpoint = new URL(settings.endpoint)
      if (settings.forcePathStyle) return `${endpoint.origin}/${bucket}/${path}`
      return `${endpoint.protocol}//${bucket}.${endpoint.host}/${path}`
    }
    return settings.forcePathStyle
      ? `https://s3.${settings.region}.amazonaws.com/${bucket}/${path}`
      : `https://${bucket}.s3.${settings.region}.amazonaws.com/${path}`
  }

  async function call(method: string, key: string, init: { body?: Uint8Array; headers?: Record<string, string> } = {}): Promise<Response> {
    const request = await client.sign(urlOf(key), {
      method,
      headers: init.headers,
      body: init.body ? (init.body as BodyInit) : undefined,
    })
    return fetchImpl(request, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
  }

  async function fail(operation: string, response: Response): Promise<never> {
    await response.body?.cancel().catch(() => undefined)
    throw new S3StorageError(operation, response.status)
  }

  async function open(key: string): Promise<ReadableStream<Uint8Array> | null> {
    const response = await call('GET', key)
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined)
      return null
    }
    if (!response.ok || !response.body) return fail('GetObject', response)
    return response.body
  }

  return {
    driver: 's3',
    async put(key: string, body: Uint8Array, options: PutObjectOptions) {
      const headers: Record<string, string> = {
        'content-type': options.contentType,
        'x-amz-meta-sha256': options.sha256,
      }
      if (settings.sse) {
        headers['x-amz-server-side-encryption'] = settings.sse.algorithm
        if (settings.sse.algorithm === 'aws:kms' && settings.sse.kmsKeyId) headers['x-amz-server-side-encryption-aws-kms-key-id'] = settings.sse.kmsKeyId
      }
      const response = await call('PUT', key, { body, headers })
      if (!response.ok) return fail('PutObject', response)
      await response.body?.cancel().catch(() => undefined)
    },
    async get(key: string) {
      const stream = await open(key)
      return stream ? readStream(stream, MAX_OBJECT_BYTES) : null
    },
    getStream: open,
    async delete(key: string) {
      const response = await call('DELETE', key)
      // 204 (deleted, or missing on AWS), 404 on some compatible services.
      if (!response.ok && response.status !== 404) return fail('DeleteObject', response)
      await response.body?.cancel().catch(() => undefined)
    },
    async exists(key: string) {
      const response = await call('HEAD', key)
      await response.body?.cancel().catch(() => undefined)
      if (response.status === 404) return false
      if (!response.ok) return fail('HeadObject', response)
      return true
    },
  }
}
