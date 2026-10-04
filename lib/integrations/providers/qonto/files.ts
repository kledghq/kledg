/**
 * Download of the files Qonto links to (receipts, statement PDFs), for the
 * proxy routes.
 *
 * Invariant: Kledg only fetches a URL taken from a Qonto payload (the URL
 * Qonto returned for that attachment or statement, never one from the
 * request) when it points to a host Qonto serves files from: https on the
 * default port, never an IP address or credentials, and a host name that is
 * either Qonto's own domain or a Qonto S3 bucket. Qonto documents its file
 * URLs as pre-signed S3 links valid 30 minutes, its example being the bucket
 * "qonto-dev" (https://qonto-dev.s3.eu-central-1.amazonaws.com/..., Retrieve
 * a transaction, docs.qonto.com); it publishes no fixed production host, so
 * a bucket is accepted when its name starts with "qonto", in the
 * virtual-hosted form <bucket>.s3[.<region>].amazonaws.com only. Any other
 * AWS name (another company's bucket, ec2-*.compute.amazonaws.com) is
 * refused (KLEDG-SEC-005).
 *
 * The connection is then opened only to a public address, checked when the
 * socket connects (lib/integrations/public-https-fetch.ts), so a host that
 * resolves or rebinds to loopback, a private range or the cloud metadata
 * address is refused. Redirects are refused, the call has a timeout and the
 * body is read with a byte budget, aborted as soon as it passes the limit
 * (KLEDG-SEC-006).
 *
 * The origin of the configured Qonto API (QONTO_API_URL, for a local or
 * simulated API) is trusted as configured by the operator: it may be http
 * and private, and is fetched without the public address check.
 */

import { ExternalServiceError, NotFoundError } from '@/lib/accounting/errors'
import { bankFetch } from '@/lib/banking/http'
import { publicFetch } from '@/lib/integrations/public-https-fetch'
import { logger } from '@/lib/logger'
import { getQontoApiUrl } from './client-base'

/** Qonto's own domains, and Qonto S3 buckets in the virtual-hosted form (see the module header). */
const QONTO_FILE_HOSTS = [
  /(^|\.)qonto\.com$/,
  /(^|\.)qonto\.co$/,
  /(^|\.)qonto\.eu$/,
  /^qonto[a-z0-9-]*\.s3(\.dualstack)?(\.[a-z]{2}(-gov)?-[a-z]+-\d)?\.amazonaws\.com$/,
]

/** Receipts and statements are a few MB; anything larger is refused. */
export const MAX_PROVIDER_FILE_BYTES = 25 * 1024 * 1024

const FILE_TIMEOUT_MS = 30_000

export const FILE_UNAVAILABLE_MESSAGE = "Ce fichier n'est pas disponible chez Qonto pour le moment. Réessayez dans quelques minutes."

const FILE_TOO_LARGE_MESSAGE = 'Ce fichier dépasse la taille maximale acceptée (25 Mo).'

const isIpLiteral = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')

function isQontoApiOrigin(url: string, apiUrl: string = getQontoApiUrl()): boolean {
  try {
    return new URL(url).origin === new URL(apiUrl).origin
  } catch {
    // An invalid QONTO_API_URL allows nothing more
    return false
  }
}

/** Whether `value` is a URL Kledg may fetch for a Qonto file (see the module header). */
export function isAllowedQontoFileUrl(value: string, apiUrl: string = getQontoApiUrl()): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.username || url.password) return false
  if (isQontoApiOrigin(value, apiUrl)) return true
  if (url.protocol !== 'https:' || url.port !== '') return false
  const host = url.hostname.toLowerCase()
  if (isIpLiteral(host)) return false
  return QONTO_FILE_HOSTS.some((pattern) => pattern.test(host))
}

/**
 * Downloads a file Qonto links to. Throws NotFoundError for a URL outside
 * the allowed hosts (logged: Qonto should never send one) and
 * ExternalServiceError when the download fails, is refused (non-public
 * address) or passes MAX_PROVIDER_FILE_BYTES. `fetchImpl` replaces the
 * public-address fetch in tests.
 */
export async function fetchQontoFile(url: string, fetchImpl?: typeof fetch): Promise<ArrayBuffer> {
  if (!isAllowedQontoFileUrl(url)) {
    logger.error('[Qonto] Refused a file URL outside the allowed hosts', { host: safeHost(url) })
    throw new NotFoundError(FILE_UNAVAILABLE_MESSAGE)
  }
  const doFetch = fetchImpl ?? (isQontoApiOrigin(url) ? (...args: Parameters<typeof fetch>) => fetch(...args) : publicFetch)
  const controller = new AbortController()
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(FILE_TIMEOUT_MS)])
  const response = await bankFetch('Qonto', doFetch, url, { signal }, FILE_TIMEOUT_MS)
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    logger.error('[Qonto] File download failed', { status: response.status, host: safeHost(url) })
    throw new ExternalServiceError(FILE_UNAVAILABLE_MESSAGE)
  }
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > MAX_PROVIDER_FILE_BYTES) {
    controller.abort()
    await response.body?.cancel().catch(() => undefined)
    throw new ExternalServiceError(FILE_TOO_LARGE_MESSAGE)
  }
  try {
    return await readWithBudget(response, MAX_PROVIDER_FILE_BYTES)
  } catch (error) {
    controller.abort()
    if (error instanceof ExternalServiceError) throw error
    logger.error('[Qonto] File download interrupted', { host: safeHost(url), error })
    throw new ExternalServiceError(FILE_UNAVAILABLE_MESSAGE)
  }
}

/**
 * Reads a response body chunk by chunk and stops, cancelling the stream, as
 * soon as it passes `maxBytes`: a body without content-length (or lying
 * about it) is never buffered beyond the limit.
 */
async function readWithBudget(response: Response, maxBytes: number): Promise<ArrayBuffer> {
  if (!response.body) return new ArrayBuffer(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new ExternalServiceError(FILE_TOO_LARGE_MESSAGE)
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body.buffer
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}
