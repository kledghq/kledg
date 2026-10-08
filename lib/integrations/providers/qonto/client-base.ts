/**
 * Base Qonto client: authentication, request and error handling.
 *
 * Calls go to the configured Qonto host only (getQontoApiUrl), with a
 * timeout and no redirect (lib/banking/http.ts). Ids sent in a path are
 * encoded as one segment (qontoPathSegment). A refused call becomes a typed
 * error with a French message; Qonto's own message is only logged
 * (lib/banking/errors.ts).
 */

import { providerError } from '@/lib/banking/errors'
import { bankFetch } from '@/lib/banking/http'
import { parseProviderResponse } from '@/lib/banking/provider-response'
import type { z } from 'zod'

/** Qonto's sandbox, reached with a sandbox API key plus the staging token. */
export const QONTO_SANDBOX_API_URL = 'https://thirdparty-sandbox.staging.qonto.co/v2'

function isQontoSandbox(): boolean {
  return process.env.QONTO_ENVIRONMENT?.trim().toLowerCase() === 'sandbox'
}

/**
 * Qonto API base URL. QONTO_API_URL overrides it; QONTO_ENVIRONMENT=sandbox
 * selects Qonto's sandbox.
 */
export function getQontoApiUrl(): string {
  if (process.env.QONTO_API_URL) return process.env.QONTO_API_URL.replace(/\/$/, '')
  if (isQontoSandbox()) return QONTO_SANDBOX_API_URL
  return 'https://thirdparty.qonto.com/v2'
}

/**
 * Extra headers for every Qonto call. The sandbox requires the staging token
 * from the Qonto developer portal (Sandbox access) on top of the API key:
 * https://docs.qonto.com/get-started/business-api/sandbox
 */
export function getQontoExtraHeaders(): Record<string, string> {
  const token = process.env.QONTO_STAGING_TOKEN?.trim()
  return token ? { 'X-Qonto-Staging-Token': token } : {}
}

/** A Qonto id (uuid) or IBAN as one path segment: a value never adds a path or a query. */
export function qontoPathSegment(value: string): string {
  return encodeURIComponent(value)
}

/** Message of a Qonto error body (`errors[]`, `error.message` or `message`), for the log only. */
function qontoErrorDetail(text: string, fallback: string): string {
  try {
    const body = JSON.parse(text) as {
      errors?: Array<{ detail?: string; title?: string; message?: string }>
      message?: string
      error?: { message?: string }
    }
    if (Array.isArray(body.errors)) return body.errors.map((e) => e.detail ?? e.title ?? e.message).filter(Boolean).join(' · ')
    return body.message ?? body.error?.message ?? fallback
  } catch {
    return text || fallback
  }
}

export class QontoClientBase {
  protected login: string
  protected secretKey: string
  protected baseUrl: string

  constructor(login: string, secretKey: string) {
    this.login = login
    this.secretKey = secretKey
    this.baseUrl = getQontoApiUrl()
  }

  protected getAuthHeader(): string {
    // Qonto Business API: "login:secretKey", without Base64
    // https://docs.qonto.com/get-started/business-api/authentication/api-key
    return `${this.login}:${this.secretKey}`
  }

  /**
   * Sends a request to `endpoint` (a path whose ids went through
   * qontoPathSegment) and throws a typed error when Qonto refuses it.
   * `json: false` lets fetch set the content type (multipart uploads).
   */
  protected async send(endpoint: string, options: RequestInit = {}, json = true): Promise<Response> {
    const response = await bankFetch('Qonto', (...args) => fetch(...args), `${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        Authorization: this.getAuthHeader(),
        ...(json ? { 'Content-Type': 'application/json' } : {}),
        ...getQontoExtraHeaders(),
        ...options.headers,
      },
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw providerError({
        provider: 'Qonto',
        status: response.status,
        detail: qontoErrorDetail(text, response.statusText),
        operation: `${options.method ?? 'GET'} ${endpoint.split('?')[0]}`,
      })
    }
    return response
  }

  /** JSON of a request; checked against `schema` when given (lib/banking/provider-response.ts). */
  protected async request<T>(endpoint: string, options: RequestInit = {}, schema?: z.ZodType): Promise<T> {
    const response = await this.send(endpoint, options)
    const body: unknown = await response.json()
    return schema ? parseProviderResponse<T>('Qonto', `${options.method ?? 'GET'} ${endpoint.split('?')[0]}`, schema, body) : (body as T)
  }

  /** Request without a JSON response (DELETE...). */
  protected async requestEmpty(endpoint: string, options: RequestInit = {}): Promise<void> {
    await this.send(endpoint, options)
  }
}
