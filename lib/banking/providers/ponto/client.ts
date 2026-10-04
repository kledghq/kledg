/**
 * Ponto API client for a custom integration (one organization, its own
 * client id and secret, no certificate).
 *
 * - API reference: https://documentation.myponto.com/api
 *   (formerly https://documentation.ibanity.com/ponto-connect/api)
 * - Custom integrations: https://documentation.myponto.com/custom-integrations
 *
 * Access tokens come from the client credentials grant (POST /oauth2/token,
 * HTTP Basic client_id:client_secret) and live 30 minutes; they are cached
 * on the client and renewed one minute before expiry. Responses follow
 * JSON:API with cursor pagination (page[limit] up to 100, page[before],
 * page[after], links.next).
 */

import { ExternalServiceError } from '@/lib/accounting/errors'
import { providerError } from '@/lib/banking/errors'
import { bankFetch } from '@/lib/banking/http'

export const PONTO_API_URL = 'https://api.myponto.com'
export const PONTO_DASHBOARD_URL = 'https://dashboard.myponto.com/'

export function getPontoApiUrl(): string {
  return (process.env.PONTO_API_URL || PONTO_API_URL).replace(/\/$/, '')
}

export interface JsonApiResource<A> {
  id: string
  type: string
  attributes: A
  meta?: Record<string, unknown>
  relationships?: Record<string, { data?: { id: string; type: string } | null }>
}

export interface JsonApiList<A> {
  data: JsonApiResource<A>[]
  links?: { first?: string; next?: string | null; prev?: string | null }
  meta?: { paging?: { after?: string | null; before?: string | null; limit?: number }; synchronizedAt?: string }
}

export interface PontoAccountAttributes {
  reference: string
  referenceType: string
  description: string | null
  product: string | null
  currency: string
  subtype?: string | null
  holderName?: string | null
  currentBalance: number
  availableBalance: number | null
  authorizedAt?: string | null
  authorizationExpirationExpectedAt?: string | null
  deprecated?: boolean
  internalReference?: string | null
}

export interface PontoSynchronizationAttributes {
  status: 'pending' | 'running' | 'success' | 'error' | string
  subtype: string
  resourceId: string
  resourceType: string
  errors: Array<{ code?: string; detail?: string }>
  createdAt: string
  updatedAt: string
}

export interface PontoAccountMeta {
  availability?: string
  synchronizedAt?: string | null
  latestSynchronization?: JsonApiResource<PontoSynchronizationAttributes> | null
}

export interface PontoTransactionAttributes {
  amount: number
  currency: string
  description: string | null
  remittanceInformation: string | null
  remittanceInformationType: string | null
  counterpartName: string | null
  counterpartReference: string | null
  executionDate: string | null
  valueDate: string | null
  additionalInformation: string | null
  bankTransactionCode: string | null
  proprietaryBankTransactionCode: string | null
  endToEndId: string | null
  purposeCode: string | null
  internalReference: string | null
  digest?: string | null
  fee?: number | null
  cardReference?: string | null
}

export interface PontoInstitutionAttributes {
  name: string
  country: string
  status: string
  deprecated: boolean
  logoUrl: string | null
  primaryColor: string | null
  secondaryColor?: string | null
  bic?: string | null
  expectedAuthorizationLifetime?: number | null
  pendingTransactionsAvailable?: boolean
  sharedBrandName?: string | null
}

type FetchLike = typeof fetch

/**
 * Maps a failed Ponto response (JSON:API `errors`) to an application error
 * with a French message; Ponto's own detail is only logged.
 */
export async function pontoError(response: Response): Promise<Error> {
  const text = await response.text().catch(() => '')
  let detail = response.statusText
  let code: string | undefined
  try {
    const body = JSON.parse(text) as { errors?: Array<{ code?: string; detail?: string }>; error_description?: string; error?: string }
    if (Array.isArray(body.errors) && body.errors.length > 0) {
      code = body.errors[0].code
      detail = body.errors.map((e) => e.detail || e.code).filter(Boolean).join(' · ')
    } else if (body.error_description || body.error) {
      code = body.error
      detail = body.error_description || body.error || detail
    }
  } catch {
    if (text) detail = text
  }
  return providerError({ provider: 'Ponto', status: response.status, code, detail })
}

export interface PontoClientOptions {
  clientId: string
  clientSecret: string
  apiUrl?: string
  fetch?: FetchLike
  now?: () => Date
}

/** Largest page Ponto accepts. */
export const PONTO_PAGE_LIMIT = 100

export class PontoClient {
  private readonly apiUrl: string
  private readonly fetchImpl: FetchLike
  private token: { value: string; expiresAt: number } | null = null

  constructor(private readonly options: PontoClientOptions) {
    this.apiUrl = (options.apiUrl ?? getPontoApiUrl()).replace(/\/$/, '')
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args))
  }

  private now(): number {
    return (this.options.now?.() ?? new Date()).getTime()
  }

  /** POST /oauth2/token (client credentials), cached until one minute before expiry. */
  async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value
    const basic = Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString('base64')
    const response = await bankFetch('Ponto', this.fetchImpl, `${this.apiUrl}/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    })
    if (!response.ok) throw await pontoError(response)
    const data = (await response.json()) as { access_token: string; expires_in?: number }
    this.token = { value: data.access_token, expiresAt: this.now() + (data.expires_in ?? 1800) * 1000 }
    return data.access_token
  }

  private async request<T>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${this.apiUrl}${pathOrUrl}`
    if (!url.startsWith(`${this.apiUrl}/`)) throw new ExternalServiceError('Lien de pagination Ponto inattendu')
    const response = await bankFetch('Ponto', this.fetchImpl, url, {
      ...init,
      headers: {
        Authorization: `Bearer ${await this.getAccessToken()}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
    if (!response.ok) throw await pontoError(response)
    return (await response.json()) as T
  }

  /**
   * Follows `links.next` from `path`. `stop` sees each page and returns true
   * to end early (e.g. once transactions are older than the sync window).
   */
  async listAll<A>(
    path: string,
    stop?: (page: JsonApiList<A>) => boolean,
    maxPages = 100,
  ): Promise<JsonApiResource<A>[]> {
    const items: JsonApiResource<A>[] = []
    let next: string | null | undefined = path
    for (let pages = 0; next && pages < maxPages; pages++) {
      const page: JsonApiList<A> = await this.request<JsonApiList<A>>(next)
      items.push(...page.data)
      if (stop?.(page)) break
      next = page.data.length > 0 ? page.links?.next : null
    }
    return items
  }

  /** GET /financial-institutions/{id}: name and logo of an account's bank. */
  async getFinancialInstitution(id: string): Promise<JsonApiResource<PontoInstitutionAttributes>> {
    const body = await this.request<{ data: JsonApiResource<PontoInstitutionAttributes> }>(
      `/financial-institutions/${encodeURIComponent(id)}`,
    )
    return body.data
  }

  /** GET /accounts */
  listAccounts(): Promise<JsonApiResource<PontoAccountAttributes>[]> {
    return this.listAll<PontoAccountAttributes>(`/accounts?page%5Blimit%5D=${PONTO_PAGE_LIMIT}`)
  }

  /**
   * GET /accounts/{id}/transactions, booked transactions only (newest first).
   * Stops after the first page whose transactions are all older than `since`.
   */
  listTransactions(accountId: string, since?: Date): Promise<JsonApiResource<PontoTransactionAttributes>[]> {
    const path = `/accounts/${encodeURIComponent(accountId)}/transactions?page%5Blimit%5D=${PONTO_PAGE_LIMIT}`
    return this.listAll<PontoTransactionAttributes>(path, (page) => {
      if (!since) return false
      return (
        page.data.length > 0 &&
        page.data.every((t) => {
          const date = t.attributes.executionDate ?? t.attributes.valueDate
          return date ? new Date(date) < since : false
        })
      )
    })
  }

  /**
   * POST /synchronizations: asks Ponto to refresh an account from the bank.
   * Only while the Ponto user is present, with their real IP address
   * (custom integrations documentation, "manual synchronizations").
   */
  createSynchronization(
    accountId: string,
    subtype: 'accountDetails' | 'accountTransactions',
    customerIpAddress: string,
  ): Promise<{ data: JsonApiResource<PontoSynchronizationAttributes> }> {
    return this.request('/synchronizations', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'synchronization',
          attributes: { resourceType: 'account', resourceId: accountId, subtype, customerIpAddress },
        },
      }),
    })
  }
}

/**
 * GET /financial-institutions: public list, no token needed.
 * Filtered by country (ISO 3166 alpha-2), all pages.
 */
export async function fetchPontoInstitutions(
  country: string,
  options: { apiUrl?: string; fetch?: FetchLike } = {},
): Promise<JsonApiResource<PontoInstitutionAttributes>[]> {
  const apiUrl = (options.apiUrl ?? getPontoApiUrl()).replace(/\/$/, '')
  const fetchImpl = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const items: JsonApiResource<PontoInstitutionAttributes>[] = []
  let next: string | null | undefined =
    `${apiUrl}/financial-institutions?filter%5Bcountry%5D%5Beq%5D=${encodeURIComponent(country)}&page%5Blimit%5D=${PONTO_PAGE_LIMIT}`
  for (let pages = 0; next && pages < 20; pages++) {
    if (!next.startsWith(`${apiUrl}/`)) break
    const response: Response = await bankFetch('Ponto', fetchImpl, next, { headers: { Accept: 'application/json' } })
    if (!response.ok) throw await pontoError(response)
    const page = (await response.json()) as JsonApiList<PontoInstitutionAttributes>
    items.push(...page.data)
    next = page.data.length > 0 ? page.links?.next : null
  }
  return items
}
