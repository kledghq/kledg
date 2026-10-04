/**
 * Qonto API Client
 * 
 * Main client class that composes all Qonto API domain modules
 * Documentation: https://docs.qonto.com/get-started/business-api/overview
 */

import { QontoClientBase } from './client-base'
import { QontoAccounts } from './accounts'
import { QontoTransactions } from './transactions'
import { QontoAttachments } from './attachments'
import { QontoStatements } from './statements'
import type {
  QontoAccount,
  QontoTransaction,
  QontoAttachment,
  QontoTransactionsResponse,
  QontoTransactionAttachmentsResponse,
  QontoStatement,
  QontoStatementsResponse,
} from './types'

/**
 * Main Qonto API client that provides access to all Qonto API endpoints
 */
export class QontoClient extends QontoClientBase {
  private accounts: QontoAccounts
  private transactions: QontoTransactions
  private attachments: QontoAttachments
  private statements: QontoStatements

  constructor(login: string, secretKey: string) {
    super(login, secretKey)
    this.accounts = new QontoAccounts(login, secretKey)
    this.transactions = new QontoTransactions(login, secretKey)
    this.attachments = new QontoAttachments(login, secretKey)
    this.statements = new QontoStatements(login, secretKey)
  }

  // Accounts methods
  async getOrganization(): Promise<{ organization: { bank_accounts: QontoAccount[] } }> {
    return this.accounts.getOrganization()
  }

  async getAccounts(): Promise<QontoAccount[]> {
    return this.accounts.getAccounts()
  }

  // Transactions methods
  async getTransactions(
    iban: string,
    options?: {
      currentPage?: number
      perPage?: number
      since?: string
      until?: string
      settledAtFrom?: string
      settledAtTo?: string
    }
  ): Promise<QontoTransactionsResponse> {
    return this.transactions.getTransactions(iban, options)
  }

  async getAllTransactions(iban: string, since?: string): Promise<QontoTransaction[]> {
    return this.transactions.getAllTransactions(iban, since)
  }

  // Attachments methods
  async getAttachment(attachmentId: string): Promise<QontoAttachment> {
    return this.attachments.getAttachment(attachmentId)
  }

  /**
   * Récupère tous les justificatifs d'une transaction
   * @deprecated Utiliser listTransactionAttachments à la place
   */
  async getTransactionAttachments(transactionId: string, iban: string): Promise<QontoAttachment[]> {
    // Récupérer la transaction pour obtenir les attachment_ids
    const transactions = await this.getTransactions(iban, { perPage: 100 })
    const transaction = transactions.transactions.find(t => t.transaction_id === transactionId)
    
    if (!transaction || !transaction.attachment_ids || transaction.attachment_ids.length === 0) {
      return []
    }

    const attachments: QontoAttachment[] = []
    for (const attachmentId of transaction.attachment_ids) {
      try {
        const attachment = await this.getAttachment(attachmentId)
        attachments.push(attachment)
      } catch {
        // Erreur silencieuse pour les attachments manquants
        // Ne pas logger en production selon les règles clean code
      }
    }

    return attachments
  }

  async listTransactionAttachments(
    transactionId: string,
    options?: { page?: number; perPage?: number }
  ): Promise<QontoTransactionAttachmentsResponse> {
    return this.attachments.listTransactionAttachments(transactionId, options)
  }

  async uploadTransactionAttachment(
    transactionId: string,
    file: File | Blob,
    idempotencyKey?: string
  ): Promise<void> {
    return this.attachments.uploadTransactionAttachment(transactionId, file, idempotencyKey)
  }

  /**
   * Récupère tous les justificatifs de tous les comptes
   */
  async getAllAttachments(since?: string): Promise<Array<QontoAttachment & { transaction_id: string; transaction_uuid?: string; transaction_label: string; transaction_date: string; transaction_amount: number }>> {
    const accounts = await this.getAccounts()
    const allAttachments: Array<QontoAttachment & { transaction_id: string; transaction_uuid?: string; transaction_label: string; transaction_date: string; transaction_amount: number }> = []

    for (const account of accounts) {
      const transactions = await this.getAllTransactions(account.iban, since)
      
      for (const transaction of transactions) {
        if (transaction.attachment_ids && transaction.attachment_ids.length > 0) {
          for (const attachmentId of transaction.attachment_ids) {
            try {
              const attachment = await this.getAttachment(attachmentId)
              allAttachments.push({
                ...attachment,
                transaction_id: transaction.transaction_id,
                transaction_uuid: transaction.id, // UUID de la transaction pour l'API
                transaction_label: transaction.label,
                transaction_date: transaction.settled_at,
                transaction_amount: transaction.amount,
              })
            } catch {
              // Erreur silencieuse pour les attachments manquants
              // Ne pas logger en production selon les règles clean code
            }
          }
        }
      }
    }

    return allAttachments
  }

  // Statements methods
  async getStatements(options?: {
    page?: number
    perPage?: number
    sortBy?: 'period:asc' | 'period:desc'
    bankAccountIds?: string[]
    ibans?: string[]
    periodFrom?: string
    periodTo?: string
  }): Promise<QontoStatementsResponse> {
    return this.statements.getStatements(options)
  }

  async getAllStatements(options?: {
    sortBy?: 'period:asc' | 'period:desc'
    bankAccountIds?: string[]
    ibans?: string[]
    periodFrom?: string
    periodTo?: string
  }): Promise<QontoStatement[]> {
    return this.statements.getAllStatements(options)
  }

  async getStatement(statementId: string): Promise<{ statement: QontoStatement }> {
    return this.statements.getStatement(statementId)
  }

}
