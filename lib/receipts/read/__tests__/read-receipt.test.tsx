// @vitest-environment node
/**
 * What Kledg reads in a receipt file (lib/receipts/read/read-receipt.ts),
 * on real PDFs: a Factur-X invoice (its CII data, exact, VAT per rate and
 * the advance already paid), a PDF with a text layer (rendered here with
 * @react-pdf/renderer, embedded fonts like a real invoice), a photo and a
 * damaged file (nothing read, never an error); then the prefill of the
 * form, the file's content before its name.
 */

import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer'

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { indexTiers } from '@/lib/receipts/detect-supplier'
import { fieldsFromFileName } from '@/lib/receipts/file-name-fields'
import { mergeGuess } from '@/lib/receipts/read/guess'
import { pdfTextLines } from '@/lib/receipts/read/pdf-text'
import { readReceiptFile } from '@/lib/receipts/read/read-receipt'
import { ciiXml, facturXPdf, sampleInvoice } from '@/lib/invoices/e-invoice/__tests__/fixtures'

const NO_SUPPLIERS = indexTiers([])

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text>{label}</Text>
      <Text>{value}</Text>
    </View>
  )
}

async function textInvoice(issuer: string, rows: Array<[string, string]>, pages = 1): Promise<Uint8Array> {
  const buffer = await renderToBuffer(
    <Document>
      {Array.from({ length: pages }, (_, index) => (
        <Page key={index} size="A4" style={{ padding: 40, fontSize: 10 }}>
          {index === 0 ? <Text>{issuer}</Text> : <Text>Conditions générales, page {index + 1}</Text>}
          {index === pages - 1 ? rows.map(([label, value]) => <Row key={label} label={label} value={value} />) : null}
        </Page>
      ))}
    </Document>,
  )
  return new Uint8Array(buffer)
}

describe('reading a receipt file', () => {
  it('reads a Factur-X invoice from its data: amount due, date, seller, VAT per rate', async () => {
    const pdf = facturXPdf(ciiXml(sampleInvoice({ prepaid: '92.75' })))
    expect(await readReceiptFile(pdf, 'application/pdf', NO_SUPPLIERS)).toEqual({
      // 292,75 TTC less 92,75 already paid (BT-113): the bank pays 200,00
      amountCents: 20000,
      currency: 'EUR',
      date: '2026-03-02',
      merchant: 'Papeterie Durand SARL',
      vatLines: [
        { rateBp: 2000, amountCents: 4000 },
        { rateBp: 550, amountCents: 275 },
      ],
      readFrom: 'e-invoice',
    })
  })

  it('reads the text of a PDF invoice, and the known vendor it names', async () => {
    const pdf = await textInvoice('OVH SAS, 2 rue Kellermann, Roubaix', [
      ['Date de facture :', '03/10/2026'],
      ['Total HT', '1 000,00 €'],
      ['TVA 20 %', '200,00 €'],
      ['Total TTC', '1 200,00 €'],
    ])
    expect(await readReceiptFile(pdf, 'application/pdf', NO_SUPPLIERS)).toEqual({
      amountCents: 120000,
      currency: 'EUR',
      date: '2026-10-03',
      merchant: 'OVHcloud',
      vatLines: [],
      readFrom: 'pdf',
    })
  }, 30_000)

  it('names a supplier of the company found in the text, and reads the totals on the last page', async () => {
    const pdf = await textInvoice('Imprimerie Lefèvre SARL', [['Facture du', '12 novembre 2026'], ['Net à payer', '84,00 €']], 3)
    const suppliers = indexTiers([{ id: 't1', name: 'Imprimerie Lefèvre', kind: 'SUPPLIER', auxiliaryAccountNumber: null }])
    expect(await readReceiptFile(pdf, 'application/pdf', suppliers)).toMatchObject({ amountCents: 8400, date: '2026-11-12', merchant: 'Imprimerie Lefèvre' })
  }, 30_000)

  it('reads nothing in a photo or a damaged PDF, without an error', async () => {
    expect(await readReceiptFile(new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg', NO_SUPPLIERS)).toBeNull()
    const damaged = new Uint8Array(Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF'))
    expect(await pdfTextLines(damaged)).toBeNull()
    expect(await readReceiptFile(damaged, 'application/pdf', NO_SUPPLIERS)).toBeNull()
  }, 30_000)
})

describe('prefill of the form', () => {
  const content = { amountCents: 5990, currency: 'EUR', date: '2026-10-03', merchant: null, vatLines: [], readFrom: 'pdf' as const }

  it('takes the file content first, and the file name for what the content does not say', () => {
    expect(mergeGuess(content, fieldsFromFileName('2026-09-30 Fnac 12,00.pdf'))).toEqual({
      amountCents: 5990,
      date: '2026-10-03',
      merchant: 'Fnac',
      currency: 'EUR',
      vatLines: [],
      readFrom: 'pdf',
    })
  })

  it('falls back to the file name, and says when nothing was read', () => {
    expect(mergeGuess(null, fieldsFromFileName('2026-09-30 Fnac 12,00.pdf'))).toMatchObject({ amountCents: 1200, readFrom: 'file-name' })
    expect(mergeGuess(null, fieldsFromFileName('IMG_1234.jpg'))).toMatchObject({ amountCents: null, date: null, readFrom: null })
  })
})
