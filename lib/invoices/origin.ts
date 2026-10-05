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

/** What the page and the MCP view of an invoice say about Qonto. */
export interface QontoStanding {
  /** "Créée dans Qonto" (Kledg created it there) or "Importée de Qonto"; null for an invoice Qonto never saw. */
  label: string | null
  /** "Brouillon dans Qonto" while Qonto keeps it a draft (no number, not postable yet). */
  draftLabel: string | null
  /** The invoice's id at Qonto, shown as is: Qonto documents no stable web link to one client invoice. */
  qontoId: string | null
}

/**
 * Where an invoice stands with Qonto. An invoice created from Kledg in Qonto
 * (origin QONTO with a creation request) is never shown as imported, even
 * once the import completed it; a purchase invoice synced from Qonto is
 * imported (source QONTO, origin QONTO or none).
 */
export function qontoStanding(invoice: {
  source: string | null
  origin: InvoiceOriginCode | string | null
  createdInQonto: boolean
  qontoDraft: boolean
  qontoId: string | null
}): QontoStanding {
  const fromQonto = invoice.origin === 'QONTO' || invoice.source === 'QONTO'
  if (!fromQonto) return { label: null, draftLabel: null, qontoId: null }
  const created = invoice.origin === 'QONTO' && invoice.createdInQonto
  return {
    label: created ? 'Créée dans Qonto' : 'Importée de Qonto',
    draftLabel: created && invoice.qontoDraft ? 'Brouillon dans Qonto' : null,
    qontoId: invoice.qontoId,
  }
}
