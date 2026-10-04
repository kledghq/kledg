/**
 * Qonto API types and interfaces
 * Documentation: https://docs.qonto.com/get-started/business-api/overview
 */

export interface QontoAccount {
  /** Qonto's account id (UUID), the reliable key: the sandbox masks IBANs. */
  id: string
  slug: string
  iban: string
  bic: string
  currency: string
  balance: number
  balance_cents: number
  authorized_balance: number
  authorized_balance_cents: number
}

export interface QontoTransaction {
  id?: string
  transaction_id: string
  amount: number
  amount_cents: number
  local_amount: number
  local_amount_cents?: number
  side: 'debit' | 'credit'
  operation_type: string
  currency: string
  local_currency: string
  label: string
  settled_at: string
  emitted_at: string
  created_at?: string | null
  updated_at: string
  status: string
  note?: string | null
  reference?: string
  attachment_ids?: string[]
  // Champs enrichis de Qonto
  logo?: {
    small?: string
    medium?: string
  } | null
  category?: string
  vat_rate?: number | null
  vat_amount?: number | null
  label_ids?: string[]
  initiator_id?: string
  subject_type?: string
  attachment_lost?: boolean
  bank_account_id?: string
  settled_balance?: number
  settled_balance_cents?: number
  card_last_digits?: string
  vat_amount_cents?: number | null
  cashflow_category?: {
    name: string
  } | null
  cashflow_subcategory?: {
    name: string
  } | null
  attachment_required?: boolean
  clean_counterparty_name?: string
  is_external_transaction?: boolean
}

export interface QontoAttachment {
  id: string
  file_name: string
  file_size: number
  file_content_type: string
  file_url: string
  created_at: string
  updated_at: string
}

export interface QontoTransactionsResponse {
  transactions: QontoTransaction[]
  meta: {
    current_page: number
    next_page: number | null
    prev_page: number | null
    total_pages: number
    total_count: number
    per_page: number
  }
}

/**
 * Type pour les attachments de transactions
 * Documentation: https://docs.qonto.com/api-reference/business-api/expense-management/attachments-in-transactions/list-attachments-for-a-transaction
 */
export interface QontoTransactionAttachment {
  id: string
  created_at: string
  file_name: string
  file_size: string
  file_content_type: string
  url: string
  probative_attachment?: {
    status: 'available' | 'unavailable'
    file_name?: string
    file_content_type?: string
    file_size?: string
    url?: string
  }
}

export interface QontoTransactionAttachmentsResponse {
  attachments: QontoTransactionAttachment[]
}

/**
 * Type pour les relevés bancaires (statements) de l'endpoint /statements
 * Documentation: https://docs.qonto.com/api-reference/business-api/transactions-statements/statements/list-statements
 */
export interface QontoStatement {
  id: string
  bank_account_id: string
  period: string // Format: "MM-YYYY" (e.g., "08-2024")
  file: {
    file_name: string
    file_content_type: string
    file_size: string
    file_url: string
  }
}

export interface QontoStatementsResponse {
  statements: QontoStatement[]
  meta: {
    current_page: number
    next_page: number | null
    prev_page: number | null
    total_pages: number
    total_count: number
    per_page: number
  }
}
