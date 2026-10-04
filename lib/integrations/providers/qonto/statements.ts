/**
 * Qonto statements API methods
 * Documentation: https://docs.qonto.com/api-reference/business-api/transactions-statements/statements
 */

import { QontoClientBase, qontoPathSegment } from './client-base'
import type { QontoStatement, QontoStatementsResponse } from './types'

/** Upper bound on statement pages read in one call (100 statements a page). */
const MAX_STATEMENT_PAGES = 200

/**
 * Statement-related methods for Qonto API
 */
export class QontoStatements extends QontoClientBase {
  /**
   * Récupère les relevés bancaires (statements)
   * Documentation: https://docs.qonto.com/api-reference/business-api/transactions-statements/statements/list-statements
   */
  async getStatements(options?: {
    page?: number
    perPage?: number
    sortBy?: 'period:asc' | 'period:desc'
    bankAccountIds?: string[]
    ibans?: string[]
    periodFrom?: string
    periodTo?: string
  }): Promise<QontoStatementsResponse> {
    const params = new URLSearchParams()
    if (options?.page) {
      params.append('page', options.page.toString())
    }
    if (options?.perPage) {
      params.append('per_page', options.perPage.toString())
    }
    if (options?.sortBy) {
      params.append('sort_by', options.sortBy)
    }
    if (options?.bankAccountIds && options.bankAccountIds.length > 0) {
      options.bankAccountIds.forEach((id) => {
        params.append('bank_account_ids[]', id)
      })
    }
    if (options?.ibans && options.ibans.length > 0) {
      options.ibans.forEach((iban) => {
        params.append('ibans[]', iban)
      })
    }
    if (options?.periodFrom) {
      params.append('period_from', options.periodFrom)
    }
    if (options?.periodTo) {
      params.append('period_to', options.periodTo)
    }

    const query = params.toString()
    return this.request<QontoStatementsResponse>(
      `/statements${query ? `?${query}` : ''}`
    )
  }

  /**
   * Récupère tous les relevés bancaires (avec pagination automatique)
   */
  async getAllStatements(options?: {
    sortBy?: 'period:asc' | 'period:desc'
    bankAccountIds?: string[]
    ibans?: string[]
    periodFrom?: string
    periodTo?: string
  }): Promise<QontoStatement[]> {
    const allStatements: QontoStatement[] = []
    let currentPage = 1

    // Next page only when Qonto names one and the page was not empty; a
    // missing next_page (undefined) or a runaway response ends the loop.
    for (let pages = 0; pages < MAX_STATEMENT_PAGES; pages++) {
      const response = await this.getStatements({
        ...options,
        page: currentPage,
        perPage: 100,
      })

      allStatements.push(...response.statements)

      const next = response.meta?.next_page
      if (typeof next !== 'number' || next <= currentPage || response.statements.length === 0) break
      currentPage = next
    }

    return allStatements
  }

  /**
   * Récupère un relevé bancaire par son ID
   * Documentation: https://docs.qonto.com/api-reference/business-api/transactions-statements/statements/retrieve-a-statement
   */
  async getStatement(statementId: string): Promise<{ statement: QontoStatement }> {
    return this.request<{ statement: QontoStatement }>(`/statements/${qontoPathSegment(statementId)}`)
  }
}
