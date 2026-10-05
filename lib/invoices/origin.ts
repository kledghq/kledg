/**
 * Labels of where an invoice's number comes from (Invoice.origin), shared by
 * the list and the page of an invoice. Pure: no imports.
 */

export type InvoiceOriginCode = 'AUTO' | 'MANUAL' | 'RECORDED' | 'QONTO' | 'MANAGEMENT_FEES'

/** Short label of the origin; a Qonto invoice reads differently whether Kledg created it there or imported it. */
export function invoiceOriginLabel(origin: InvoiceOriginCode, createdInQonto: boolean): string | null {
  switch (origin) {
    case 'AUTO':
      return 'Numérotée par Kledg'
    case 'RECORDED':
      return 'Déjà émise'
    case 'QONTO':
      return createdInQonto ? 'Créée dans Qonto' : 'Importée de Qonto'
    case 'MANAGEMENT_FEES':
      return 'Frais de gestion'
    default:
      return null
  }
}
