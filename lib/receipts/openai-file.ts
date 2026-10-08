/**
 * Download of a file ChatGPT hands to a tool (Apps SDK file params,
 * `_meta["openai/fileParams"]`): the tool receives `{ download_url,
 * file_id }` for a file the user attached in the conversation, and Kledg
 * fetches it server side (docs/justificatifs-photo.md).
 *
 * The URL comes from the tool arguments, so it is treated as untrusted
 * (docs/conventions.md, Security): Kledg only fetches it when it is https
 * on the default port, without credentials nor an IP address, on a host
 * OpenAI serves files from (OPENAI_FILE_HOSTS; OpenAI publishes no list, the
 * files of conversations come from *.oaiusercontent.com; an operator may add
 * exact host names with KLEDG_OPENAI_FILE_HOSTS). The connection is opened
 * only to a public address, checked when the socket connects
 * (lib/integrations/public-https-fetch.ts: no loopback, private range or
 * cloud metadata address, even after a DNS rebinding); redirects are
 * refused, the call has a timeout and the body is read with a byte budget
 * (RECEIPT_MAX_BYTES), cut as soon as it passes it. What the bytes are is
 * decided by their magic numbers when the receipt is staged, never by the
 * content type of the answer.
 */

import { ExternalServiceError, ValidationError } from '@/lib/accounting/errors'
import { publicFetch } from '@/lib/integrations/public-https-fetch'
import { logger } from '@/lib/logger'
import { RECEIPT_FILE_MESSAGES, RECEIPT_MAX_BYTES } from './file-type'

/** Hosts of the files of ChatGPT conversations. */
const OPENAI_FILE_HOSTS = [/^([a-z0-9-]+\.)*oaiusercontent\.com$/]

const TIMEOUT_MS = 20_000

export const OPENAI_FILE_MESSAGES = {
  refused: 'Ce lien de fichier n’est pas un fichier de ChatGPT : joignez la photo dans ChatGPT, ou utilisez la vue de dépôt.',
  unavailable: 'Le fichier n’a pas pu être lu chez ChatGPT (lien expiré ou indisponible) : joignez-le de nouveau, ou utilisez la vue de dépôt.',
} as const

/** Exact host names an operator adds (KLEDG_OPENAI_FILE_HOSTS, comma separated). */
function extraHosts(env: Record<string, string | undefined>): string[] {
  return (env.KLEDG_OPENAI_FILE_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h))
}

const isIpLiteral = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || host.includes(':')

/** Whether Kledg may fetch `value` as a ChatGPT file (see the module header). */
export function isAllowedOpenAiFileUrl(value: string, env: Record<string, string | undefined> = process.env): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  if (isIpLiteral(host)) return false
  return OPENAI_FILE_HOSTS.some((pattern) => pattern.test(host)) || extraHosts(env).includes(host)
}

function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname
  } catch {
    return null
  }
}

class TooLarge extends Error {}

async function readWithBudget(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new TooLarge()
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

export interface OpenAiFileOptions {
  /** Replaces the public-address fetch (tests). */
  fetchImpl?: typeof fetch
  env?: Record<string, string | undefined>
  maxBytes?: number
  timeoutMs?: number
}

/**
 * The bytes of a file ChatGPT passed to a tool. Throws a French
 * ValidationError for a URL outside OpenAI's file hosts or a file above the
 * budget, ExternalServiceError when the download fails, is redirected or
 * times out.
 */
export async function fetchOpenAiFile(downloadUrl: string, options: OpenAiFileOptions = {}): Promise<Uint8Array> {
  const maxBytes = options.maxBytes ?? RECEIPT_MAX_BYTES
  if (!isAllowedOpenAiFileUrl(downloadUrl, options.env)) {
    logger.warn('[ChatGPT file] Refused a download URL outside the OpenAI file hosts', { host: hostOf(downloadUrl) })
    throw new ValidationError(OPENAI_FILE_MESSAGES.refused)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS)
  try {
    let response: Response
    try {
      response = await (options.fetchImpl ?? publicFetch)(downloadUrl, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { accept: '*/*' } })
    } catch (error) {
      logger.warn('[ChatGPT file] Download failed', { host: hostOf(downloadUrl), error })
      throw new ExternalServiceError(OPENAI_FILE_MESSAGES.unavailable)
    }
    if (response.status >= 300 && response.status < 400) {
      // A redirect could lead anywhere: never followed.
      await response.body?.cancel().catch(() => undefined)
      logger.warn('[ChatGPT file] Refused a redirect', { host: hostOf(downloadUrl), status: response.status })
      throw new ExternalServiceError(OPENAI_FILE_MESSAGES.unavailable)
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      logger.warn('[ChatGPT file] Download refused', { host: hostOf(downloadUrl), status: response.status })
      throw new ExternalServiceError(OPENAI_FILE_MESSAGES.unavailable)
    }
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > maxBytes) {
      controller.abort()
      await response.body?.cancel().catch(() => undefined)
      throw new ValidationError(RECEIPT_FILE_MESSAGES.tooLarge)
    }
    try {
      return await readWithBudget(response, maxBytes)
    } catch (error) {
      controller.abort()
      if (error instanceof TooLarge) throw new ValidationError(RECEIPT_FILE_MESSAGES.tooLarge)
      logger.warn('[ChatGPT file] Download interrupted', { host: hostOf(downloadUrl), error })
      throw new ExternalServiceError(OPENAI_FILE_MESSAGES.unavailable)
    }
  } finally {
    clearTimeout(timer)
  }
}
