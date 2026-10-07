/**
 * Revolut Business API client (read only, scope READ).
 *
 * Reference: https://developer.revolut.com/docs/business/business-api
 * OpenAPI: https://github.com/revolut-engineering/revolut-openapi (json/business.json)
 * Auth guide: https://developer.revolut.com/docs/guides/manage-accounts/get-started/make-your-first-api-request
 *
 * Access tokens last about 40 minutes and are obtained from the refresh token
 * with a fresh client assertion (POST /auth/token, form encoded).
 */

import { BankAuthorizationError, providerError } from '@/lib/banking/errors'
import { bankFetch } from '@/lib/banking/http'
import { buildClientAssertion, CLIENT_ASSERTION_TYPE } from './jwt'

export interface RevolutAccount {
  id: string
  name?: string
  balance: number
  currency: string
  state: 'active' | 'inactive'
  public: boolean
  created_at: string
  updated_at: string
  account_type?: string
}

export interface RevolutBankDetails {
  iban?: string
  bic?: string
  account_no?: string
  beneficiary?: string
}

export interface RevolutTransactionLeg {
  leg_id: string
  account_id: string
  amount: number
  fee?: number
  currency: string
  bill_amount?: number
  bill_currency?: string
  description?: string
  balance?: number
  counterparty?: { id?: string; account_id?: string; account_type?: string; name?: string }
}

export interface RevolutTransaction {
  id: string
  type: string
  request_id?: string
  state: 'created' | 'pending' | 'completed' | 'declined' | 'failed' | 'reverted'
  reason_code?: string
  created_at: string
  updated_at: string
  completed_at?: string
  reference?: string
  merchant?: { name?: string; city?: string; category_code?: string; country?: string }
  legs: RevolutTransactionLeg[]
}

export interface RevolutTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
}

type FetchLike = typeof fetch

export interface RevolutClientOptions {
  apiUrl: string
  clientId: string
  /** Domain of the redirect URI (JWT issuer). */
  issuer: string
  privateKeyPem: string
  refreshToken?: string
  fetch?: FetchLike
  now?: () => Date
}

/** Largest page the transactions endpoint accepts. */
const REVOLUT_PAGE_SIZE = 1000

async function errorDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  try {
    const body = JSON.parse(text) as { message?: string; error_description?: string; error?: string }
    return body.message || body.error_description || body.error || response.statusText
  } catch {
    return text || response.statusText
  }
}

/** Maps a failed Revolut response to an application error with a French message (detail logged only). */
export async function revolutError(response: Response): Promise<Error> {
  const detail = await errorDetail(response)
  return providerError({ provider: 'Revolut', status: response.status, detail })
}

export class RevolutClient {
  private readonly options: RevolutClientOptions
  private readonly fetchImpl: FetchLike
  private accessToken: { value: string; expiresAt: number } | null = null

  constructor(options: RevolutClientOptions) {
    this.options = options
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args))
  }

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }

  private assertion(): string {
    return buildClientAssertion({
      clientId: this.options.clientId,
      issuer: this.options.issuer,
      privateKeyPem: this.options.privateKeyPem,
      now: this.now(),
    })
  }

  private async token(params: Record<string, string>): Promise<RevolutTokenResponse> {
    const body = new URLSearchParams({
      ...params,
      client_id: this.options.clientId,
      client_assertion_type: CLIENT_ASSERTION_TYPE,
      client_assertion: this.assertion(),
    })
    const response = await bankFetch('Revolut', this.fetchImpl, `${this.options.apiUrl}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    })
    if (!response.ok) throw await revolutError(response)
    const data = (await response.json()) as RevolutTokenResponse
    this.accessToken = {
      value: data.access_token,
      expiresAt: this.now().getTime() + (data.expires_in ?? 2400) * 1000,
    }
    return data
  }

  /** Exchanges the authorization code from the consent redirect for tokens. */
  async exchangeCode(code: string): Promise<RevolutTokenResponse> {
    const tokens = await this.token({ grant_type: 'authorization_code', code })
    if (tokens.refresh_token) this.options.refreshToken = tokens.refresh_token
    return tokens
  }

  /** A valid access token, refreshed one minute before it expires. */
  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt - 60_000 > this.now().getTime()) {
      return this.accessToken.value
    }
    if (!this.options.refreshToken) {
      throw new BankAuthorizationError("Revolut n'est pas encore autorisé : terminez l'autorisation dans Revolut Business.")
    }
    const tokens = await this.token({ grant_type: 'refresh_token', refresh_token: this.options.refreshToken })
    if (tokens.refresh_token) this.options.refreshToken = tokens.refresh_token
    return tokens.access_token
  }

  private async get<T>(path: string, query?: URLSearchParams): Promise<T> {
    const url = `${this.options.apiUrl}${path}${query && [...query.keys()].length ? `?${query}` : ''}`
    const response = await bankFetch('Revolut', this.fetchImpl, url, {
      headers: { Authorization: `Bearer ${await this.getAccessToken()}`, Accept: 'application/json' },
    })
    if (!response.ok) throw await revolutError(response)
    return (await response.json()) as T
  }

  /** GET /accounts */
  getAccounts(): Promise<RevolutAccount[]> {
    return this.get('/accounts')
  }

  /** GET /accounts/{id}/bank-details: IBAN and BIC of an account (one entry per scheme). */
  getBankDetails(accountId: string): Promise<RevolutBankDetails[]> {
    return this.get(`/accounts/${encodeURIComponent(accountId)}/bank-details`)
  }

  /** GET /transactions: one page, newest first. */
  getTransactions(params: { account?: string; from?: string; to?: string; count?: number }): Promise<RevolutTransaction[]> {
    const query = new URLSearchParams()
    if (params.account) query.set('account', params.account)
    if (params.from) query.set('from', params.from)
    if (params.to) query.set('to', params.to)
    query.set('count', String(params.count ?? REVOLUT_PAGE_SIZE))
    return this.get('/transactions', query)
  }

  /**
   * Every transaction of an account created since `from`. Pages are newest
   * first; the next page ends (`to`, exclusive) at the created_at of the
   * last item, moved 1 ms later so that items sharing that instant are not
   * skipped (they come back twice and are deduplicated by id).
   */
  async getAllTransactions(account: string, from?: Date, pageSize = REVOLUT_PAGE_SIZE): Promise<RevolutTransaction[]> {
    const seen = new Map<string, RevolutTransaction>()
    let to: string | undefined
    for (;;) {
      const page = await this.getTransactions({ account, from: from?.toISOString(), to, count: pageSize })
      let fresh = 0
      for (const tx of page) {
        if (!seen.has(tx.id)) {
          seen.set(tx.id, tx)
          fresh++
        }
      }
      if (page.length < pageSize || fresh === 0) break
      const last = new Date(page[page.length - 1].created_at)
      to = new Date(last.getTime() + 1).toISOString()
    }
    return [...seen.values()]
  }

  get refreshToken(): string | undefined {
    return this.options.refreshToken
  }
}
