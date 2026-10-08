/**
 * What Kledg can hand to Qonto instead of keeping a file itself, in one
 * place: when Qonto's API changes, change it here (docs/justificatifs-
 * photo.md, Qonto).
 *
 * Checked in Qonto's Business API reference on 2026-10-08:
 * https://docs.qonto.com/api-reference/business-api/expense-management/attachments-in-transactions/upload-an-attachment-to-a-transaction
 * https://docs.qonto.com/api-reference/business-api/expense-management/supplier-invoices/create-supplier-invoices
 * https://docs.qonto.com/api-reference/business-api/expense-management/attachments/upload-an-attachment
 * https://docs.qonto.com/get-started/business-api/authentication/introduction (Endpoints access)
 */

export const QONTO_RECEIPT_CAPABILITIES = {
  /** A receipt filed on a Qonto transaction is uploaded to it (POST /v2/transactions/{id}/attachments). */
  storesTransactionReceipts: true,
  /**
   * A receipt without a Qonto transaction (an expense line's receipt, paid
   * with a personal card or cash) can be stored at Qonto and read back:
   * POST /v2/supplier_invoices/bulk, then GET /v2/supplier_invoices/{id} and
   * GET /v2/attachments/{id} (lib/integrations/providers/qonto/supplier-invoices.ts).
   * Qonto files it among the supplier invoices "to review" and has no
   * endpoint to delete it, so the instance opts in
   * (KLEDG_QONTO_EXPENSE_RECEIPTS=supplier_invoices,
   * lib/receipts/offload-to-qonto.service.ts).
   */
  canStoreUnmatchedReceipts: true,
  /** No reimbursement, expense report or receipt inbox endpoint exists. */
  canStoreExpenseReports: false,
} as const
