/**
 * Qonto invoices mapped to Kledg invoices (lib/invoices/qonto-mapping.ts),
 * with payloads shaped like Qonto's public API reference: client invoices
 * with items (vat_rate as a fraction), supplier invoices with a taxes array
 * (tax_rate as a percentage). Fictitious data.
 */

import { describe, expect, it } from 'vitest'
import { basesFromTaxes, mapClientInvoice, mapSupplierInvoice } from '../qonto-mapping'
import type { QontoClientInvoice, QontoSupplierInvoice } from '@/lib/integrations/providers/qonto/invoicing'

const eur = (value: string) => ({ value, currency: 'EUR' })

const clientInvoice = (over: Partial<QontoClientInvoice> = {}): QontoClientInvoice => ({
  id: 'ci-1',
  number: 'F-2026-001',
  status: 'unpaid',
  issue_date: '2026-03-02',
  due_date: '2026-04-01',
  attachment_id: 'att-1',
  total_amount: eur('366.33'),
  vat_amount: eur('56.33'),
  items: [
    { title: 'Conseil', quantity: '2', unit_price: eur('125.00'), vat_rate: '0.2', total_vat: eur('50.00') },
    { title: 'Livre', quantity: '3', unit_price: eur('20.00'), vat_rate: '0.055', total_vat: eur('3.30') },
    { title: 'Repas', quantity: '1', unit_price: eur('0.30'), vat_rate: '0.1', total_vat: eur('0.03') },
  ],
  client: { id: 'cl-1', name: 'Martin SA' },
  ...over,
})

describe('client invoices', () => {
  it('maps items to lines and keeps the VAT of the document', () => {
    const result = mapClientInvoice(clientInvoice({ total_amount: eur('363.63') }))
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.invoice).toMatchObject({ externalId: 'ci-1', number: 'F-2026-001', issueDate: '2026-03-02', dueDate: '2026-04-01', attachmentId: 'att-1' })
    expect(result.invoice.lines.map((l) => [l.label, l.quantityThousandths, l.unitPriceCents, l.vatRateBp, l.totalExclTaxCents])).toEqual([
      ['Conseil', 2000, 12500, 2000, 25000],
      ['Livre', 3000, 2000, 550, 6000],
      ['Repas', 1000, 30, 1000, 30],
    ])
    expect(result.invoice.totals.breakdown).toEqual([
      { vatRateBp: 2000, baseCents: 25000, vatCents: 5000 },
      { vatRateBp: 1000, baseCents: 30, vatCents: 3 },
      { vatRateBp: 550, baseCents: 6000, vatCents: 330 },
    ])
    expect(result.invoice.totals.totalInclTaxCents).toBe(36363)
  })

  it('refuses an invoice whose lines do not add up to its total', () => {
    expect(mapClientInvoice(clientInvoice())).toEqual({ kind: 'refused', reason: 'le total des lignes ne correspond pas au total de la facture' })
  })

  it('computes VAT per rate when Qonto gives no item VAT', () => {
    const result = mapClientInvoice(
      clientInvoice({ total_amount: eur('120.00'), items: [{ title: 'A', quantity: '1', unit_price: eur('100.00'), vat_rate: '0.2' }] }),
    )
    expect(result.kind === 'ok' && result.invoice.totals.totalVatCents).toBe(2000)
  })

  it('ignores drafts and canceled invoices, refuses incomplete ones', () => {
    expect(mapClientInvoice(clientInvoice({ status: 'draft' }))).toEqual({ kind: 'ignored' })
    expect(mapClientInvoice(clientInvoice({ status: 'canceled' }))).toEqual({ kind: 'ignored' })
    expect(mapClientInvoice(clientInvoice({ number: null }))).toMatchObject({ kind: 'refused' })
    expect(mapClientInvoice(clientInvoice({ issue_date: null }))).toMatchObject({ kind: 'refused' })
    expect(mapClientInvoice(clientInvoice({ total_amount: { value: '10', currency: 'USD' } }))).toMatchObject({ kind: 'refused' })
    expect(mapClientInvoice(clientInvoice({ items: [] }))).toMatchObject({ kind: 'refused', reason: 'aucune ligne' })
    expect(mapClientInvoice(clientInvoice({ items: [{ title: 'A', quantity: '1', unit_price: eur('1.00'), vat_rate: '0.2', discount: { type: 'percentage', value: '0.1' } }] }))).toMatchObject({
      kind: 'refused',
    })
    expect(mapClientInvoice(clientInvoice({ items: [{ title: 'A', quantity: 'x', unit_price: eur('1.00'), vat_rate: '0.2' }] }))).toMatchObject({ kind: 'refused' })
  })
})

const supplierInvoice = (over: Partial<QontoSupplierInvoice> = {}): QontoSupplierInvoice => ({
  id: 'si-1',
  supplier_id: 'sup-1',
  supplier_name: 'Papeterie Durand',
  invoice_number: 'D-77',
  status: 'paid',
  issue_date: '2026-02-15',
  due_date: null,
  total_amount: eur('132.10'),
  total_amount_excluding_taxes: eur('111.00'),
  total_tax_amount: eur('21.10'),
  taxes: [
    { tax_rate: '20', tax_amount: eur('20.00') },
    { tax_rate: '10', tax_amount: eur('1.10') },
  ],
  attachment_id: 'att-9',
  file_name: 'd77.pdf',
  ...over,
})

describe('supplier invoices', () => {
  it('derives one line per rate from the taxes and keeps the document VAT', () => {
    const result = mapSupplierInvoice(supplierInvoice(), 'Papeterie Durand')
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.invoice.totals.breakdown).toEqual([
      { vatRateBp: 2000, baseCents: 10000, vatCents: 2000 },
      { vatRateBp: 1000, baseCents: 1100, vatCents: 110 },
    ])
    expect(result.invoice.lines.map((l) => l.totalExclTaxCents)).toEqual([10000, 1100])
    expect(result.invoice.totals.totalInclTaxCents).toBe(13210)
    expect(result.invoice.dueDate).toBeNull()
    expect(result.invoice.attachmentFileName).toBe('d77.pdf')
  })

  it('takes a single rate base from the total excluding tax', () => {
    const result = mapSupplierInvoice(
      supplierInvoice({ total_amount: eur('12.34'), total_amount_excluding_taxes: eur('10.28'), total_tax_amount: eur('2.06'), taxes: [{ tax_rate: '20', tax_amount: eur('2.06') }] }),
      'X',
    )
    expect(result.kind === 'ok' && result.invoice.totals.breakdown).toEqual([{ vatRateBp: 2000, baseCents: 1028, vatCents: 206 }])
  })

  it('records an invoice without VAT at 0 %', () => {
    const result = mapSupplierInvoice(supplierInvoice({ total_amount: eur('50.00'), total_amount_excluding_taxes: null, total_tax_amount: null, taxes: [] }), 'X')
    expect(result.kind === 'ok' && result.invoice.totals.breakdown).toEqual([{ vatRateBp: 0, baseCents: 5000, vatCents: 0 }])
  })

  it('refuses taxes that do not add up', () => {
    expect(mapSupplierInvoice(supplierInvoice({ total_tax_amount: eur('21.00') }), 'X')).toMatchObject({ kind: 'refused' })
    expect(mapSupplierInvoice(supplierInvoice({ total_amount_excluding_taxes: eur('100.00') }), 'X')).toMatchObject({ kind: 'refused' })
    expect(mapSupplierInvoice(supplierInvoice({ taxes: [], total_tax_amount: eur('3.00') }), 'X')).toMatchObject({ kind: 'refused' })
    expect(mapSupplierInvoice(supplierInvoice({ taxes: [{ tax_rate: 'vingt', tax_amount: eur('1') }] }), 'X')).toMatchObject({ kind: 'refused' })
  })

  it('ignores rejected and discarded documents, refuses one without number or date', () => {
    expect(mapSupplierInvoice(supplierInvoice({ status: 'rejected' }), 'X')).toEqual({ kind: 'ignored' })
    expect(mapSupplierInvoice(supplierInvoice({ status: 'discarded' }), 'X')).toEqual({ kind: 'ignored' })
    expect(mapSupplierInvoice(supplierInvoice({ invoice_number: '' }), 'X')).toMatchObject({ kind: 'refused', reason: 'numéro de facture absent' })
    expect(mapSupplierInvoice(supplierInvoice({ issue_date: null }), 'X')).toMatchObject({ kind: 'refused' })
  })
})

describe('bases from taxes', () => {
  it('gives the rest of the base to the 0 % rate', () => {
    expect(basesFromTaxes(15000, [{ vatRateBp: 2000, vatCents: 2000 }, { vatRateBp: 0, vatCents: 0 }])).toEqual([
      { vatRateBp: 2000, baseCents: 10000, vatCents: 2000 },
      { vatRateBp: 0, baseCents: 5000, vatCents: 0 },
    ])
  })

  it('refuses a base that would not give back its tax', () => {
    expect(basesFromTaxes(50000, [{ vatRateBp: 2000, vatCents: 2000 }, { vatRateBp: 550, vatCents: 55 }])).toBeNull()
    expect(basesFromTaxes(100, [{ vatRateBp: 2000, vatCents: 2000 }])).toBeNull()
  })
})
