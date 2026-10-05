/**
 * Where an invoice stands with Qonto (lib/invoices/origin.ts), on the page
 * of the invoice and in the MCP view of get_invoice: an invoice Kledg
 * created in Qonto reads "Créée dans Qonto" (and "Brouillon dans Qonto"
 * while Qonto keeps it a draft), never "Importée de Qonto"; an imported one
 * keeps "Importée de Qonto". Qonto documents no web link to one client
 * invoice, so the Qonto id is shown instead of a link.
 */

import { describe, expect, it } from 'vitest'
import { invoiceOriginLabel, qontoStanding } from '../origin'
import { invoiceDocument } from '@/lib/mcp/views/builders'

const base = { source: 'QONTO', origin: 'QONTO', createdInQonto: false, qontoDraft: false, qontoId: 'q-123' }

describe('qontoStanding', () => {
  it('says created, and draft while Qonto keeps it a draft', () => {
    expect(qontoStanding({ ...base, createdInQonto: true, qontoDraft: true })).toEqual({ label: 'Créée dans Qonto', draftLabel: 'Brouillon dans Qonto', qontoId: 'q-123' })
    expect(qontoStanding({ ...base, createdInQonto: true })).toEqual({ label: 'Créée dans Qonto', draftLabel: null, qontoId: 'q-123' })
  })

  it('keeps "Importée de Qonto" for an imported invoice, sale or purchase', () => {
    expect(qontoStanding(base)).toEqual({ label: 'Importée de Qonto', draftLabel: null, qontoId: 'q-123' })
    expect(qontoStanding({ ...base, origin: null })).toEqual({ label: 'Importée de Qonto', draftLabel: null, qontoId: 'q-123' })
    expect(invoiceOriginLabel('QONTO', false)).toBe('Importée de Qonto')
    expect(invoiceOriginLabel('QONTO', true)).toBe('Créée dans Qonto')
  })

  it('says nothing about Qonto for an invoice Qonto never saw', () => {
    expect(qontoStanding({ source: 'MANUAL', origin: 'AUTO', createdInQonto: false, qontoDraft: false, qontoId: null })).toEqual({ label: null, draftLabel: null, qontoId: null })
  })
})

describe('invoiceDocument (MCP view of get_invoice)', () => {
  const invoice = {
    id: 'inv-1',
    direction: 'SALE',
    number: null,
    creditNote: false,
    issueDate: '2026-10-01',
    dueDate: '2026-10-31',
    tiers: { name: 'Studio Nord', auxiliaryAccountNumber: 'C00001' },
    parties: { sellerSiren: null, sellerVatNumber: null, buyerSiren: null, buyerVatNumber: null },
    status: 'draft',
    lines: [],
    vatBreakdown: [],
    totalExclTax: 100,
    totalVat: 20,
    totalInclTax: 120,
    paid: 0,
    remaining: 120,
    lettering: null,
    entry: null,
    payments: [],
    source: 'QONTO',
  }
  const facts = (patch: object) => invoiceDocument('c1', { ...invoice, ...patch }).facts.filter((f) => f.label !== 'Date' && f.label !== 'Échéance')

  it('shows an invoice created in Qonto as created, its draft state and its Qonto id', () => {
    expect(facts({ origin: 'QONTO', createdInQonto: true, qontoDraft: true, qontoId: 'q-123' })).toEqual([
      { label: 'Origine', value: 'Créée dans Qonto' },
      { label: 'Dans Qonto', value: 'Brouillon dans Qonto' },
      { label: 'Identifiant Qonto', value: 'q-123' },
    ])
  })

  it('shows an imported invoice as imported, and a Kledg invoice as entered in Kledg', () => {
    expect(facts({ origin: 'QONTO', createdInQonto: false, qontoDraft: false, qontoId: 'q-9' })).toEqual([
      { label: 'Origine', value: 'Importée de Qonto' },
      { label: 'Identifiant Qonto', value: 'q-9' },
    ])
    expect(facts({ source: 'MANUAL', origin: 'AUTO', createdInQonto: false, qontoDraft: false, qontoId: null })).toEqual([{ label: 'Origine', value: 'Saisie dans Kledg' }])
  })
})
