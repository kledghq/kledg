/**
 * Reading of e-invoice files (lib/invoices/e-invoice): Factur-X PDF, CII and
 * UBL XML give the same invoice; the document's amounts are kept and
 * checked with the rules of EN 16931-1 (BR-CO-13, BR-CO-14, BR-CO-15);
 * what Kledg cannot record as is (allowances, negative lines, no lines) is
 * recorded one line per rate, and what it does not handle (another
 * currency, other document types, a MINIMUM profile) is refused with a
 * French reason. Fictitious documents built by fixtures.ts.
 */

import { describe, expect, it } from 'vitest'
import { formatVatRate } from '../../amounts'
import { amountCents } from '../normalize'
import { parseEInvoice } from '../parse-e-invoice'
import type { EInvoiceParseResult, ParsedEInvoice } from '../types'
import { BUYER, SELLER, bytes, ciiXml, facturXPdf, sampleInvoice, ublXml, type FixtureInvoice } from './fixtures'

function ok(result: EInvoiceParseResult): ParsedEInvoice {
  if (result.kind === 'refused') throw new Error(`refused: ${result.reason}`)
  return result.invoice
}

function refused(result: EInvoiceParseResult): string {
  if (result.kind === 'ok') throw new Error('accepted')
  return result.reason
}

const cii = (invoice?: FixtureInvoice) => parseEInvoice(bytes(ciiXml(invoice)))

describe('parseEInvoice: the three syntaxes', () => {
  it('reads a CII invoice: number, dates, parties, lines and VAT per rate, in cents and basis points', () => {
    const invoice = ok(cii())
    expect(invoice).toMatchObject({
      format: 'cii',
      number: 'F2026-0042',
      typeCode: '380',
      issueDate: '2026-03-02',
      dueDate: '2026-04-01',
      seller: { name: SELLER.name, siren: SELLER.siren, siret: SELLER.siret, vatNumber: SELLER.vat, address: { street: '12 rue des Papetiers', postalCode: '75011', city: 'Paris', country: 'FR' } },
      buyer: { name: BUYER.name, siren: BUYER.siren, vatNumber: BUYER.vat },
      warnings: [],
    })
    expect(invoice.lines).toEqual([
      { label: 'Ramettes de papier A4', quantityThousandths: 2000, unitPriceCents: 10000, vatRateBp: 2000, totalExclTaxCents: 20000 },
      { label: 'Livre de comptabilité', quantityThousandths: 1000, unitPriceCents: 5000, vatRateBp: 550, totalExclTaxCents: 5000 },
    ])
    expect(invoice.totals).toMatchObject({
      breakdown: [
        { vatRateBp: 2000, baseCents: 20000, vatCents: 4000 },
        { vatRateBp: 550, baseCents: 5000, vatCents: 275 },
      ],
      totalExclTaxCents: 25000,
      totalVatCents: 4275,
      totalInclTaxCents: 29275,
    })
  })

  it('reads the same invoice from UBL, and from the CII embedded in a Factur-X PDF (compressed or not)', () => {
    const fromCii = ok(cii())
    const fromUbl = ok(parseEInvoice(bytes(ublXml())))
    const fromPdf = ok(parseEInvoice(facturXPdf(ciiXml())))
    const fromRawPdf = ok(parseEInvoice(facturXPdf(ciiXml(), { compress: false })))
    expect(fromUbl.format).toBe('ubl')
    expect(fromPdf.format).toBe('factur-x')
    for (const other of [fromUbl, fromPdf, fromRawPdf]) {
      expect(other.lines).toEqual(fromCii.lines)
      expect(other.totals).toEqual(fromCii.totals)
      expect(other.seller.siren).toBe(SELLER.siren)
      expect(other.buyer.siren).toBe(BUYER.siren)
    }
  })

  it('reads a UBL credit note as type 381, with its due date from the payment means', () => {
    const credit = ok(parseEInvoice(bytes(ublXml(sampleInvoice({ typeCode: '381', number: 'AV-7' })))))
    expect(credit).toMatchObject({ typeCode: '381', number: 'AV-7', dueDate: '2026-04-01' })
    expect(credit.totals.totalInclTaxCents).toBe(29275)
  })

  it('takes the SIREN of a French electronic address (scheme 0225, "SIREN_suffix")', () => {
    const invoice = ok(parseEInvoice(bytes(ublXml(sampleInvoice(), { endpoints: true }))))
    expect(invoice.seller.siren).toBe(SELLER.siren)
    expect(invoice.buyer.siren).toBe(BUYER.siren)
  })

  it('records factored documents as an invoice (393) and a credit note (396)', () => {
    expect(ok(cii(sampleInvoice({ typeCode: '393' }))).typeCode).toBe('380')
    expect(ok(cii(sampleInvoice({ typeCode: '396' }))).typeCode).toBe('381')
  })
})

describe('parseEInvoice: amounts kept, checked with EN 16931-1', () => {
  it('refuses totals that break BR-CO-13, BR-CO-14 or BR-CO-15', () => {
    expect(refused(cii(sampleInvoice({ taxBasis: '251.00' })))).toContain('BR-CO-13')
    expect(refused(cii(sampleInvoice({ taxTotal: '42.76' })))).toContain('BR-CO-14')
    expect(refused(cii(sampleInvoice({ grandTotal: '292.74' })))).toContain('BR-CO-15')
  })

  it('keeps the VAT of the document per rate, never recomputed', () => {
    // 3 x 0,10 at 5,5 %: Kledg's rule gives 0,02 (CGI ann. II art. 242 nonies A); a document saying 0,02 agrees
    const invoice = ok(
      cii(
        sampleInvoice({
          lines: [{ name: 'Gommes', quantity: '3', price: '0.10', net: '0.30', rate: '5.5' }],
          vat: [{ rate: '5.5', base: '0.30', amount: '0.02' }],
          taxBasis: '0.30',
          taxTotal: '0.02',
          grandTotal: '0.32',
        }),
      ),
    )
    expect(invoice.totals.breakdown).toEqual([{ vatRateBp: 550, baseCents: 30, vatCents: 2 }])
  })

  it('keeps a line whose price has more than two decimals as one unit at its net amount', () => {
    const invoice = ok(
      cii(
        sampleInvoice({
          lines: [
            { name: 'Vis', quantity: '1000', price: '0.1234', net: '123.40', rate: '20' },
            { name: 'Ramettes', quantity: '1', price: '126.60', net: '126.60', rate: '20' },
          ],
          vat: [{ rate: '20', base: '250.00', amount: '50.00' }],
          taxBasis: '250.00',
          taxTotal: '50.00',
          grandTotal: '300.00',
        }),
      ),
    )
    expect(invoice.lines[0]).toEqual({ label: 'Vis', quantityThousandths: 1000, unitPriceCents: 12340, vatRateBp: 2000, totalExclTaxCents: 12340 })
    expect(invoice.warnings).toEqual([])
  })

  it('records one line per rate when the invoice has allowances on its total, and says so', () => {
    const invoice = ok(
      cii(
        sampleInvoice({
          allowances: '10.00',
          vat: [
            { rate: '20.00', base: '190.00', amount: '38.00' },
            { rate: '5.50', base: '50.00', amount: '2.75' },
          ],
          taxBasis: '240.00',
          taxTotal: '40.75',
          grandTotal: '280.75',
        }),
      ),
    )
    expect(invoice.lines).toEqual([
      { label: `Facture F2026-0042 ${SELLER.name}, base au taux de ${formatVatRate(2000)}`, quantityThousandths: 1000, unitPriceCents: 19000, vatRateBp: 2000, totalExclTaxCents: 19000 },
      { label: `Facture F2026-0042 ${SELLER.name}, base au taux de ${formatVatRate(550)}`, quantityThousandths: 1000, unitPriceCents: 5000, vatRateBp: 550, totalExclTaxCents: 5000 },
    ])
    expect(invoice.totals.totalInclTaxCents).toBe(28075)
    expect(invoice.warnings[0]).toContain('remises ou des frais sur son total')
  })

  it('records one line per rate for a negative line (a return), and for an invoice without lines (BASIC WL)', () => {
    const withReturn = ok(
      cii(
        sampleInvoice({
          lines: [
            { name: 'Ramettes', quantity: '3', price: '100.00', net: '300.00', rate: '20' },
            { name: 'Retour', quantity: '-1', price: '100.00', net: '-100.00', rate: '20' },
          ],
          vat: [{ rate: '20', base: '200.00', amount: '40.00' }],
          taxBasis: '200.00',
          taxTotal: '40.00',
          grandTotal: '240.00',
        }),
      ),
    )
    expect(withReturn.lines).toEqual([{ label: `Facture F2026-0042 ${SELLER.name}`, quantityThousandths: 1000, unitPriceCents: 20000, vatRateBp: 2000, totalExclTaxCents: 20000 }])
    expect(withReturn.warnings[0]).toContain('lignes négatives')
    const withoutLines = ok(cii(sampleInvoice({ lines: [] })))
    expect(withoutLines.lines.map((l) => l.totalExclTaxCents)).toEqual([20000, 5000])
    expect(withoutLines.warnings[0]).toContain('ne détaille pas ses lignes')
  })

  it('merges two categories at the same rate into one row (exempt and zero rated at 0 %)', () => {
    const invoice = ok(
      cii(
        sampleInvoice({
          lines: [
            { name: 'Formation', quantity: '1', price: '100.00', net: '100.00', category: 'E', rate: '0' },
            { name: 'Livres', quantity: '1', price: '20.00', net: '20.00', category: 'Z', rate: '0' },
          ],
          vat: [
            { category: 'E', rate: '0', base: '100.00', amount: '0.00' },
            { category: 'Z', rate: '0', base: '20.00', amount: '0.00' },
          ],
          taxBasis: '120.00',
          taxTotal: '0.00',
          grandTotal: '120.00',
        }),
      ),
    )
    expect(invoice.totals.breakdown).toEqual([{ vatRateBp: 0, baseCents: 12000, vatCents: 0 }])
    expect(invoice.lines).toHaveLength(2)
  })

  it('accepts amounts written with trailing zeros beyond the cent, refuses a real third decimal', () => {
    expect(amountCents('100.000')).toBe(10000)
    expect(amountCents('100.005')).toBeNull()
    expect(amountCents('')).toBeNull()
  })
})

describe('parseEInvoice: warnings to check', () => {
  it('warns on reverse charge (AE): the VAT due by the buyer is not on the invoice (CGI art. 283)', () => {
    const invoice = ok(
      cii(
        sampleInvoice({
          lines: [{ name: 'Travaux', quantity: '1', price: '1000.00', net: '1000.00', category: 'AE', rate: '0' }],
          vat: [{ category: 'AE', rate: '0', base: '1000.00', amount: '0.00' }],
          taxBasis: '1000.00',
          taxTotal: '0.00',
          grandTotal: '1000.00',
        }),
      ),
    )
    expect(invoice.warnings).toEqual([expect.stringContaining('Autoliquidation (catégorie AE)')])
  })

  it('warns on an advance already paid (BT-113) and on a rate that is not French', () => {
    const invoice = ok(
      cii(
        sampleInvoice({
          lines: [{ name: 'Service', quantity: '1', price: '100.00', net: '100.00', rate: '19' }],
          vat: [{ rate: '19', base: '100.00', amount: '19.00' }],
          taxBasis: '100.00',
          taxTotal: '19.00',
          grandTotal: '119.00',
          prepaid: '19.00',
        }),
      ),
    )
    expect(invoice.prepaidCents).toBe(1900)
    expect(invoice.warnings).toEqual([expect.stringContaining(`Taux de ${formatVatRate(1900)}`), expect.stringContaining('Acompte de 19,00 €')])
  })
})

describe('parseEInvoice: refusals', () => {
  it('refuses another currency, another document type and a MINIMUM profile without VAT breakdown', () => {
    expect(refused(cii(sampleInvoice({ currency: 'USD' })))).toContain('facture en USD')
    expect(refused(cii(sampleInvoice({ typeCode: '386' })))).toContain('document de type 386')
    expect(refused(cii(sampleInvoice({ lines: [], vat: [] })))).toContain('profil MINIMUM')
  })

  it('refuses an invoice without number, date or seller name', () => {
    expect(refused(cii(sampleInvoice({ number: '' })))).toContain('BT-1')
    expect(refused(cii(sampleInvoice({ issueDate: '2026-02-30' })))).toContain('BT-2')
    expect(refused(cii(sampleInvoice({ seller: { name: '', siren: null, vat: null } })))).toContain('BT-27')
  })

  it('refuses a document with a DOCTYPE (no entity expansion), an XML that is not an invoice, a plain PDF and an encrypted one', () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]>${ciiXml().replace(/^<\?xml[^>]*>/, '')}`
    expect(refused(parseEInvoice(bytes(bomb)))).toContain('illisible')
    expect(refused(parseEInvoice(bytes('<?xml version="1.0"?><Order><ID>1</ID></Order>')))).toContain('ni une facture CII')
    expect(refused(parseEInvoice(facturXPdf(null)))).toContain('ne contient pas de facture Factur-X')
    expect(refused(parseEInvoice(facturXPdf(ciiXml(), { encrypted: true })))).toContain('protégé par un mot de passe')
    expect(refused(parseEInvoice(bytes('pas une facture')))).toContain('illisible')
    expect(refused(parseEInvoice(new Uint8Array()))).toBe('fichier vide')
  })

  it('ignores an identifier whose Luhn key is wrong, and a French VAT number of another SIREN', () => {
    const invoice = ok(cii(sampleInvoice({ seller: { name: 'Durand', siren: '930000101', vat: 'FR42930000120' } })))
    expect(invoice.seller).toMatchObject({ siren: null, vatNumber: 'FR42930000120' })
    const mismatch = ok(cii(sampleInvoice({ seller: { name: 'Durand', siren: SELLER.siren, vat: BUYER.vat } })))
    expect(mismatch.seller).toMatchObject({ siren: SELLER.siren, vatNumber: null })
  })
})
