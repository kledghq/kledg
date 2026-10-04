/**
 * Guards every wrapped route applies to a state-changing request (POST, PUT,
 * PATCH, DELETE) before anything else (lib/api/route.ts):
 *
 * 1. Body size: the body is read once as a stream and counted, with a hard
 *    cap (DEFAULT_MAX_JSON_BODY_BYTES for JSON, MAX_UPLOAD_BYTES plus the
 *    multipart overhead for file routes, or the route's own maxBodyBytes).
 *    Content-Length is only a fast path: a missing or false value (chunked
 *    upload) cannot get past the count. 413 beyond. The handler then gets a
 *    request rebuilt from the bytes read, so nothing is read twice.
 *
 * 2. CSRF, for requests carrying a cookie (the session is the only ambient
 *    credential; MCP bearer tokens, API keys and the cron secret go to their
 *    own unwrapped routes, and a request without a cookie gets 401 anyway):
 *    - Sec-Fetch-Site must be same-origin or none, and Origin, when sent,
 *      this instance or a trusted origin (assertSameOrigin);
 *    - a body must be application/json, or multipart/form-data on file
 *      routes: text/plain, form-encoded and other bodies are what a
 *      cross-site HTML form sends without a CORS preflight. 415 otherwise.
 *    SameSite=Lax cookies already stop most cross-site posts; this covers
 *    sibling subdomains (same site, other origin) and older browsers.
 */

import { NextRequest } from 'next/server'
import { PayloadTooLargeError, UnsupportedMediaTypeError } from '@/lib/accounting/errors'
import { assertSameOrigin } from '@/lib/api/same-origin'
import { MAX_UPLOAD_BYTES } from '@/lib/api/files'

/** Largest JSON body a route accepts unless it declares more (maxBodyBytes). */
export const DEFAULT_MAX_JSON_BODY_BYTES = 1024 * 1024

/** Boundaries and fields around the file of a multipart upload. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024

export interface BodyOptions {
  /** File route: multipart/form-data body, up to MAX_UPLOAD_BYTES. */
  multipart?: boolean
  /** Largest accepted body in bytes (default: 1 MB for JSON, the upload limit for multipart). */
  maxBodyBytes?: number
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function limitOf(options: BodyOptions): number {
  if (options.maxBodyBytes) return options.maxBodyBytes
  return options.multipart ? MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES : DEFAULT_MAX_JSON_BODY_BYTES
}

function tooLarge(options: BodyOptions, limit: number): PayloadTooLargeError {
  const bytes = options.multipart ? limit - MULTIPART_OVERHEAD_BYTES : limit
  const megabytes = Math.round(bytes / (1024 * 1024) * 10) / 10
  // Small JSON routes (a few kilobytes) would read "maximum 0 Mo".
  const size = bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} Ko` : `${String(megabytes).replace('.', ',')} Mo`
  return new PayloadTooLargeError(
    options.multipart ? `Fichier trop volumineux (maximum ${size}).` : `Requête trop volumineuse (maximum ${size}).`,
  )
}

/** Reads the whole body, counting bytes; throws 413 as soon as it exceeds `limit`. */
async function readCapped(request: Request, limit: number, error: () => Error): Promise<Uint8Array<ArrayBuffer>> {
  const declared = request.headers.get('content-length')
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > limit) throw error()
  if (!request.body) return new Uint8Array(new ArrayBuffer(0))
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      throw error()
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(new ArrayBuffer(total))
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function mediaType(request: Request): string {
  return (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
}

/**
 * Applies the size and CSRF guards to a state-changing request and returns
 * the request the handler should read (rebuilt from the bytes read). Safe
 * methods are returned unchanged.
 */
export async function guardRequest(request: NextRequest, options: BodyOptions = {}): Promise<NextRequest> {
  if (!STATE_CHANGING.has(request.method)) return request

  const limit = limitOf(options)
  const bytes = await readCapped(request, limit, () => tooLarge(options, limit))

  if (request.headers.get('cookie')) {
    assertSameOrigin(request)
    if (bytes.byteLength > 0) {
      const type = mediaType(request)
      const expected = options.multipart ? 'multipart/form-data' : 'application/json'
      if (type !== expected) {
        throw new UnsupportedMediaTypeError(
          options.multipart
            ? 'Type de contenu refusé : envoyez le fichier dans un formulaire multipart/form-data.'
            : 'Type de contenu refusé : envoyez du JSON (Content-Type: application/json).',
        )
      }
    }
  }

  return new NextRequest(request.url, {
    method: request.method,
    headers: request.headers,
    body: bytes.byteLength > 0 ? bytes : undefined,
  })
}
