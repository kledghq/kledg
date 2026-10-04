/**
 * Action handlers for transactions data table
 * 
 * This module contains action handlers separated from the main component
 * for better testability and reusability.
 */

import { toast } from "sonner"
import type { BankTransaction } from "./transactions-types"

/**
 * Copies transaction ID to clipboard
 * 
 * @param transactionId - Transaction ID to copy
 */
export async function handleCopyTransactionId(transactionId: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(transactionId)
    toast.success("Identifiant copié")
  } catch {
    toast.error("Impossible de copier l'identifiant")
  }
}

/**
 * Reconciles a transaction
 * 
 * @param transaction - Transaction to reconcile
 * @param companyId - Company ID (required)
 * @param onSuccess - Callback called on successful reconciliation
 * @returns Promise that resolves when reconciliation is complete
 */
export async function handleReconcileTransaction(
  transaction: BankTransaction,
  companyId: string,
  onSuccess?: () => void
): Promise<void> {
  if (transaction.reconciled) {
    toast.info("Cette transaction est déjà rapprochée")
    return
  }

  try {
    const response = await fetch(`/api/transactions/${transaction.id}/reconcile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    })

    if (response.ok) {
      toast.success("Transaction rapprochée avec succès")
      onSuccess?.()
    } else {
      const error = await response.json()
      toast.error(error.error || "Erreur lors du rapprochement")
    }
  } catch {
    toast.error("Erreur lors du rapprochement")
  }
}

/**
 * Unreconciles a transaction
 * 
 * @param transaction - Transaction to unreconcile
 * @param companyId - Company ID (required)
 * @param onSuccess - Callback called on successful unreconciliation
 * @returns Promise that resolves when unreconciliation is complete
 */
export async function handleUnreconcileTransaction(
  transaction: BankTransaction,
  companyId: string,
  onSuccess?: () => void
): Promise<void> {
  if (!transaction.reconciled) {
    toast.info("Cette transaction n'est pas rapprochée")
    return
  }

  try {
    const response = await fetch(
      `/api/banking/reconciliation?transactionId=${transaction.id}`,
      {
        method: "DELETE",
      }
    )

    if (response.ok) {
      toast.success("Rapprochement annulé avec succès")
      onSuccess?.()
    } else {
      const error = await response.json()
      toast.error(error.error || "Erreur lors de l'annulation du rapprochement")
    }
  } catch {
    toast.error("Erreur lors de l'annulation du rapprochement")
  }
}
