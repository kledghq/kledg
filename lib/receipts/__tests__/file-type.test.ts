import { describe, expect, it } from 'vitest'
import { RECEIPT_MAX_BYTES, checkReceiptFile, receiptFileName, sniffReceiptType } from '../file-type'
import { fieldsFromFileName } from '../file-name-fields'
import { HEIC, JPEG, PNG, text } from './fixtures'

describe('receipt file type (magic bytes)', () => {
  it('recognises JPEG, PNG, PDF and HEIC from the bytes, whatever the name', () => {
    expect(sniffReceiptType(JPEG)).toBe('image/jpeg')
    expect(sniffReceiptType(PNG)).toBe('image/png')
    expect(sniffReceiptType(text('%PDF-1.7\n'))).toBe('application/pdf')
    // PDF readers accept a header within the first 1024 bytes
    expect(sniffReceiptType(text(`${' '.repeat(100)}%PDF-1.4`))).toBe('application/pdf')
    expect(sniffReceiptType(text(`${' '.repeat(1100)}%PDF-1.4`))).toBeNull()
    expect(sniffReceiptType(HEIC)).toBe('heic')
    expect(sniffReceiptType(text('<html><script>'))).toBeNull()
    expect(sniffReceiptType(text('GIF89a'))).toBeNull()
  })

  it('accepts a receipt of 5 MB at most, and says what to do otherwise', () => {
    expect(checkReceiptFile(JPEG)).toEqual({ ok: true, contentType: 'image/jpeg' })
    expect(checkReceiptFile(new Uint8Array(0))).toEqual({ ok: false, message: 'Le fichier est vide.' })
    const large = new Uint8Array(RECEIPT_MAX_BYTES + 1)
    large.set(JPEG)
    expect(checkReceiptFile(large)).toMatchObject({ ok: false, message: expect.stringContaining('5 Mo') === undefined ? '' : expect.stringContaining('Mo au plus') })
    expect(checkReceiptFile(HEIC)).toMatchObject({ ok: false, message: expect.stringContaining('HEIC') })
    expect(checkReceiptFile(text('MZ\x90\x00'))).toEqual({ ok: false, message: 'Type de fichier non accepté : une photo JPEG ou PNG, ou un PDF.' })
  })

  it('names the file after its real type, without path nor control characters', () => {
    expect(receiptFileName('IMG_0042.HEIC', 'image/jpeg')).toBe('IMG_0042.jpg')
    expect(receiptFileName('../../etc/passwd', 'application/pdf')).toBe('.._.._etc_passwd.pdf')
    expect(receiptFileName('facture‮fdp.exe', 'application/pdf')).toBe('facturefdp.pdf')
    expect(receiptFileName('', 'image/png')).toBe('justificatif.png')
    expect(receiptFileName(null, 'image/png')).toBe('justificatif.png')
  })
})

describe('fields of a receipt file name', () => {
  it('reads the date, the amount and the merchant', () => {
    expect(fieldsFromFileName('2026-10-03 Carrefour 23,45.pdf')).toEqual({ date: '2026-10-03', amountCents: 2_345, merchant: 'Carrefour' })
    expect(fieldsFromFileName('facture_ovh_20261003.pdf')).toEqual({ date: '2026-10-03', amountCents: null, merchant: 'Ovh' })
    expect(fieldsFromFileName('ticket-03.10.2026-SNCF-89.00eur.jpg')).toEqual({ date: '2026-10-03', amountCents: 8_900, merchant: 'Sncf' })
  })

  it('reads at most the date of a camera name', () => {
    expect(fieldsFromFileName('PXL_20261003_101500123.jpg')).toEqual({ date: '2026-10-03', amountCents: null, merchant: null })
    expect(fieldsFromFileName('IMG_1234.HEIC')).toEqual({ date: null, amountCents: null, merchant: null })
  })

  it('ignores impossible dates', () => {
    expect(fieldsFromFileName('2026-02-31 Resto.jpg').date).toBeNull()
  })
})
