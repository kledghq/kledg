/**
 * The amount due, the date and the currency of an invoice read from the
 * lines of its PDF text (lib/receipts/read/invoice-text.ts): the labelled
 * amount due first, the total VAT included next, never a total excluding
 * tax or a VAT total; the invoice date, never a due date; day first.
 */

import { describe, expect, it } from 'vitest'
import { amountsOf, dateOf, readInvoiceText } from '@/lib/receipts/read/invoice-text'

describe('amounts', () => {
  it('reads French, English and plain amounts with two decimals', () => {
    expect(amountsOf('Total 1 200,00 €')).toEqual([120000])
    expect(amountsOf('Total 1 200,00 €')).toEqual([120000])
    expect(amountsOf('1.200,00 EUR')).toEqual([120000])
    expect(amountsOf('$1,200.00')).toEqual([120000])
    expect(amountsOf('23,45 et 7.10')).toEqual([2345, 710])
  })

  it('leaves out whole numbers, references and mixed separators', () => {
    expect(amountsOf('Facture n° 2026001')).toEqual([])
    expect(amountsOf('Quantité 12')).toEqual([])
    expect(amountsOf('1,200,00')).toEqual([])
    expect(amountsOf('SIRET 123 456 789 00012')).toEqual([])
  })
})

describe('dates', () => {
  it('reads the formats of French and English invoices, day first', () => {
    expect(dateOf('03/10/2026')).toBe('2026-10-03')
    expect(dateOf('3.10.26')).toBe('2026-10-03')
    expect(dateOf('2026-10-03')).toBe('2026-10-03')
    expect(dateOf('le 1er octobre 2026')).toBe('2026-10-01')
    expect(dateOf('3 oct. 2026')).toBe('2026-10-03')
    expect(dateOf('october 3, 2026')).toBe('2026-10-03')
    expect(dateOf('3 fevrier 2026')).toBe('2026-02-03')
  })

  it('refuses a day that does not exist', () => {
    expect(dateOf('31/02/2026')).toBeNull()
    expect(dateOf('12/13/2026')).toBeNull()
  })
})

describe('invoice text', () => {
  it('reads a French invoice: the total VAT included, not the total excluding tax', () => {
    expect(
      readInvoiceText([
        'OVH SAS',
        'Facture n° FR12345678',
        'Date de facture : 03/10/2026',
        "Date d'échéance : 02/11/2026",
        'Total HT 1 000,00 €',
        'TVA 20 % 200,00 €',
        'Total TTC 1 200,00 €',
      ]),
    ).toEqual({ amountCents: 120000, currency: 'EUR', date: '2026-10-03' })
  })

  it('prefers the amount due to the total, when an advance was paid', () => {
    const fields = readInvoiceText(['Total TTC 1 200,00 €', 'Acompte versé 200,00 €', 'Net à payer 1 000,00 €'])
    expect(fields.amountCents).toBe(100000)
  })

  it('takes the amount on the next line of a table header, and the last total of the document', () => {
    expect(readInvoiceText(['Total TTC', '59,90 € 0,00 €']).amountCents).toBe(5990)
    expect(readInvoiceText(['Total 10,00 €', 'Total 12,00 €']).amountCents).toBe(1200)
    // A subtotal or a VAT total is never the total
    expect(readInvoiceText(['Sous-total 10,00 €', 'Total TVA 2,00 €']).amountCents).toBeNull()
  })

  it('reads an English receipt, its currency beside the amount', () => {
    expect(readInvoiceText(['Receipt', 'Date paid October 3, 2026', 'Subtotal $20.00', 'Tax $0.00', 'Amount due $20.00'])).toEqual({
      amountCents: 2000,
      currency: 'USD',
      date: '2026-10-03',
    })
  })

  it('never takes a due date or a delivery date for the invoice date', () => {
    expect(readInvoiceText(['Date d’échéance 30/11/2026', 'Livraison le 05/10/2026', 'Commande du 01/10/2026']).date).toBe('2026-10-01')
    expect(readInvoiceText(['Échéance : 30/11/2026']).date).toBeNull()
    expect(readInvoiceText(['Période du 01/09/2026 au 30/09/2026', 'Émise le 01/10/2026']).date).toBe('2026-10-01')
  })

  it('says nothing when the text holds no amount and no date', () => {
    expect(readInvoiceText(['Merci de votre visite'])).toEqual({ amountCents: null, currency: null, date: null })
  })
})
