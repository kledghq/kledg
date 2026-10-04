/**
 * Qonto attachments API methods
 */

import { QontoClientBase, qontoPathSegment } from './client-base'
import type { QontoAttachment, QontoTransactionAttachmentsResponse } from './types'

/**
 * Attachment-related methods for Qonto API
 */
export class QontoAttachments extends QontoClientBase {
  /**
   * Récupère un justificatif (attachment) par son ID
   */
  async getAttachment(attachmentId: string): Promise<QontoAttachment> {
    return this.request<QontoAttachment>(`/attachments/${qontoPathSegment(attachmentId)}`)
  }

  /**
   * Liste tous les attachments d'une transaction
   * Documentation: https://docs.qonto.com/api-reference/business-api/expense-management/attachments-in-transactions/list-attachments-for-a-transaction
   */
  async listTransactionAttachments(
    transactionId: string,
    options?: { page?: number; perPage?: number }
  ): Promise<QontoTransactionAttachmentsResponse> {
    const params = new URLSearchParams()
    if (options?.page) {
      params.append('page', options.page.toString())
    }
    if (options?.perPage) {
      params.append('per_page', options.perPage.toString())
    }

    const endpoint = `/transactions/${qontoPathSegment(transactionId)}/attachments${params.toString() ? `?${params.toString()}` : ''}`
    return this.request<QontoTransactionAttachmentsResponse>(endpoint)
  }

  /**
   * Upload un attachment à une transaction
   * Documentation: https://docs.qonto.com/api-reference/business-api/expense-management/attachments-in-transactions/upload-an-attachment-to-a-transaction
   * @param transactionId - L'ID de la transaction
   * @param file - Le fichier à uploader (JPEG, PNG ou PDF)
   * @param idempotencyKey - Clé d'idempotence pour éviter les doublons
   */
  async uploadTransactionAttachment(
    transactionId: string,
    file: File | Blob,
    idempotencyKey?: string
  ): Promise<void> {
    const formData = new FormData()
    formData.append('file', file)
    // Qonto answers 200 with an empty body
    await this.send(
      `/transactions/${qontoPathSegment(transactionId)}/attachments`,
      { method: 'POST', body: formData, headers: idempotencyKey ? { 'X-Qonto-Idempotency-Key': idempotencyKey } : {} },
      false,
    )
  }
}
