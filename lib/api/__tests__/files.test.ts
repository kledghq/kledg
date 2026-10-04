import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'zlib'
import { assertSafeZip, contentDisposition, fileResponseHeaders, isZip } from '../files'

/** Builds a minimal zip with one deflated entry, declaring `declaredSize` as uncompressed size. */
function zip(name: string, content: Buffer, declaredSize = content.length): Buffer {
  const data = deflateRawSync(content)
  const fileName = Buffer.from(name)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(declaredSize, 22)
  local.writeUInt16LE(fileName.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(declaredSize, 24)
  central.writeUInt16LE(fileName.length, 28)
  const cdOffset = local.length + fileName.length + data.length
  const cd = Buffer.concat([central, fileName])
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(cdOffset, 16)
  return Buffer.concat([local, fileName, data, cd, eocd])
}

describe('upload limits', () => {
  it('accepts a normal xlsx-like archive', async () => {
    const archive = zip('xl/worksheets/sheet1.xml', Buffer.from('<sheet>' + 'a'.repeat(1000) + '</sheet>'))
    expect(isZip(archive)).toBe(true)
    await expect(assertSafeZip(archive)).resolves.toBeUndefined()
  })

  it('rejects zip bombs by their real inflated size and ratio (lib/api/__tests__/zip-bomb.test.ts covers lying headers)', async () => {
    const ratio = zip('xl/sharedStrings.xml', Buffer.alloc(50 * 1024 * 1024))
    await expect(assertSafeZip(ratio)).rejects.toThrow(/décompressé/)
  })

  it('rejects files that are not zip archives', async () => {
    expect(isZip(Buffer.from('Date;Montant\n'))).toBe(false)
    await expect(assertSafeZip(Buffer.from('not a zip at all, definitely not'))).rejects.toThrow(/invalide/)
  })
})

describe('file response headers', () => {
  it('serves PDFs and images inline with nosniff', () => {
    const headers = fileResponseHeaders('application/pdf', 'relevé mars.pdf')
    expect(headers['Content-Type']).toBe('application/pdf')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Content-Disposition']).toBe(
      `inline; filename="releve mars.pdf"; filename*=UTF-8''relev%C3%A9%20mars.pdf`,
    )
  })

  it('downloads HTML, SVG and unknown types instead of rendering them', () => {
    for (const type of ['text/html', 'image/svg+xml', 'application/xhtml+xml', null]) {
      const headers = fileResponseHeaders(type, 'x.html')
      expect(headers['Content-Type']).toBe('application/octet-stream')
      expect(headers['Content-Disposition']).toMatch(/^attachment;/)
    }
  })

  it('strips header injection from file names', () => {
    const value = contentDisposition('a"\r\nSet-Cookie: x=1.pdf', 'attachment')
    expect(value).not.toMatch(/[\r\n]/)
    expect(value.split('filename=')[1]).not.toContain('""')
  })
})
