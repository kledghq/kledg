/**
 * An e-invoice file read into a ParsedEInvoice: a Factur-X PDF (its
 * embedded CII XML), a CII XML or a UBL XML (Invoice or CreditNote), the
 * three syntaxes of the French e-invoicing reform (CGI art. 289 bis; the
 * base formats of the external specifications of the DGFiP are UBL, CII
 * and Factur-X). Pure: no database, tested on the files alone.
 */

import { readCii, CII_ROOT } from './cii'
import { normalizeEInvoice } from './normalize'
import { embeddedXmlFiles, isPdf } from './pdf'
import { readUbl, UBL_ROOTS } from './ubl'
import { MAX_XML_BYTES, parseXml } from './xml'
import type { EInvoiceFormat, EInvoiceParseResult, RawEInvoice } from './types'

/** The file names accepted by the import (also the accept list of the file picker). */
export const E_INVOICE_EXTENSIONS = ['.pdf', '.xml'] as const

const refuse = (reason: string): EInvoiceParseResult => ({ kind: 'refused', reason })

function readXml(text: string, format: EInvoiceFormat): RawEInvoice | 'not-invoice' | 'unreadable' {
  const document = parseXml(text)
  if (!document) return 'unreadable'
  if (document.name === CII_ROOT) return readCii(document.node, format === 'ubl' ? 'cii' : format)
  if (UBL_ROOTS.has(document.name)) return readUbl(document.name, document.node)
  return 'not-invoice'
}

export function parseEInvoice(bytes: Uint8Array): EInvoiceParseResult {
  if (bytes.length === 0) return refuse('fichier vide')
  if (isPdf(bytes)) {
    const embedded = embeddedXmlFiles(bytes)
    if (embedded.kind === 'encrypted') return refuse('PDF protégé par un mot de passe : Kledg ne peut pas lire le XML Factur-X qu’il contient')
    for (const text of embedded.texts) {
      const raw = readXml(text, 'factur-x')
      if (typeof raw === 'object') return normalizeEInvoice(raw)
    }
    return refuse('ce PDF ne contient pas de facture Factur-X (aucun XML CII joint) : déposez-le dans Justificatifs ou saisissez la facture')
  }
  if (bytes.length > MAX_XML_BYTES) return refuse('fichier XML de plus de 5 Mo')
  const text = Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '')
  const raw = readXml(text, 'cii')
  if (raw === 'unreadable') return refuse('fichier illisible : ni un PDF Factur-X, ni un XML bien formé')
  if (raw === 'not-invoice') return refuse('ce XML n’est ni une facture CII (Factur-X) ni une facture UBL')
  return normalizeEInvoice(raw)
}
