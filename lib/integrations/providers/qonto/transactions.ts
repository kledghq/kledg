/**
 * Qonto transactions API methods
 */

import { logger } from '@/lib/logger'
import { isQontoAccountId } from './account-id'
import { QontoClientBase } from './client-base'
import type { QontoTransaction, QontoTransactionsResponse } from './types'

/**
 * Transaction-related methods for Qonto API
 */
export class QontoTransactions extends QontoClientBase {
  /**
   * Récupère les transactions d'un compte
   * Documentation: https://docs.qonto.com/api-reference/business-api/transactions-statements/transactions/list-transactions
   */
  async getTransactions(
    iban: string,
    options?: {
      currentPage?: number
      perPage?: number
      since?: string
      until?: string
      settledAtFrom?: string
      settledAtTo?: string
      /** Si non précisé, on demande completed + pending + declined pour afficher le vrai statut côté app */
      status?: ('completed' | 'pending' | 'declined')[]
    }
  ): Promise<QontoTransactionsResponse> {
    logger.debug('[QontoClient] getTransactions - Début', { iban, options })

    const params = new URLSearchParams()
    // Qonto filters by bank_account_id (preferred: it is stable and works where
    // the IBAN is masked, as in the sandbox) or by iban.
    params.append(isQontoAccountId(iban) ? 'bank_account_id' : 'iban', iban)
    if (options?.currentPage) {
      params.append('page', options.currentPage.toString())
    }
    if (options?.perPage) {
      params.append('per_page', options.perPage.toString())
    }
    // Demander tous les statuts pour refléter Qonto (sinon l'API ne renvoie que completed)
    const statuses = options?.status ?? ['completed', 'pending', 'declined']
    statuses.forEach((s) => params.append('status[]', s))
    // Utiliser settled_at_from selon la documentation Qonto (format ISO 8601)
    if (options?.settledAtFrom) {
      params.append('settled_at_from', options.settledAtFrom)
      logger.debug('[QontoClient] getTransactions - settled_at_from:', options.settledAtFrom)
    } else if (options?.since) {
      // Convertir 'since' (format YYYY-MM-DD) en ISO 8601 pour Qonto
      // Qonto attend le format ISO 8601 : YYYY-MM-DDTHH:mm:ssZ
      const sinceDate = new Date(options.since + 'T00:00:00Z')
      const sinceISO = sinceDate.toISOString()
      params.append('settled_at_from', sinceISO)
      logger.debug('[QontoClient] getTransactions - since converti:', options.since, '->', sinceISO)
    }
    if (options?.settledAtTo) {
      params.append('settled_at_to', options.settledAtTo)
    } else if (options?.until) {
      const untilDate = new Date(options.until + 'T23:59:59Z')
      params.append('settled_at_to', untilDate.toISOString())
    }

    const url = `/transactions?${params.toString()}`
    logger.debug('[QontoClient] getTransactions - URL:', url)
    
    const response = await this.request<QontoTransactionsResponse>(url)
    logger.debug('[QontoClient] getTransactions - Réponse:', {
      transactionsCount: response.transactions.length,
      meta: response.meta,
    })
    
    return response
  }

  /**
   * Récupère toutes les transactions d'un compte (avec pagination automatique)
   * @param iban - IBAN du compte bancaire
   * @param since - Date de début au format YYYY-MM-DD ou ISO 8601 (sera convertie en settled_at_from)
   */
  async getAllTransactions(
    iban: string,
    since?: string
  ): Promise<QontoTransaction[]> {
    logger.debug('[QontoClient] getAllTransactions - Début', { iban, since })
    
    const allTransactions: QontoTransaction[] = []
    let currentPage = 1
    let hasMore = true

    while (hasMore) {
      const settledAtFrom = since ? (since.includes('T') ? since : `${since}T00:00:00Z`) : undefined
      logger.debug('[QontoClient] getAllTransactions - Page', currentPage, 'settledAtFrom:', settledAtFrom)
      
      const response = await this.getTransactions(iban, {
        currentPage,
        perPage: 100,
        settledAtFrom,
      })

      logger.debug('[QontoClient] getAllTransactions - Page', currentPage, 'transactions reçues:', response.transactions.length)
      allTransactions.push(...response.transactions)

      if (response.meta.next_page) {
        currentPage = response.meta.next_page
        logger.debug('[QontoClient] getAllTransactions - Page suivante:', currentPage)
      } else {
        hasMore = false
        logger.debug('[QontoClient] getAllTransactions - Plus de pages')
      }
    }

    logger.debug('[QontoClient] getAllTransactions - Total transactions récupérées:', allTransactions.length)
    return allTransactions
  }
}
