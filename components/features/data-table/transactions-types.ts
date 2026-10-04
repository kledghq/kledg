/**
 * Type definitions for transactions data table
 * 
 * This module contains type definitions shared across transaction table components.
 */

export interface BankTransaction {
  id: string
  amount: number
  date: string
  label: string | null
  reference: string | null
  side: string
  reconciled: boolean
  /** ID de l'écriture comptable rapprochée (si rapproché) */
  reconciledWith?: string | null
  logoUrl?: string | null
  counterpartyName?: string | null
  category?: string | null
  cashflowCategory?: string | null
  cashflowSubcategory?: string | null
  operationType?: string | null
  attachmentsCount?: number
  /** First attachment (for opening justificatif) */
  attachment?: {
    id: string
    fileName: string
    fileContentType?: string | null
    fileSize?: number | null
  } | null
  /** Qonto transaction UUID (for justificatif proxy) */
  transactionUuid?: string | null
  bankAccount: {
    id: string
    name: string
    displayName: string | null
    iban: string | null
  }
  /** Present when viewing group transactions (all companies) */
  companyId?: string
  companyName?: string
}
