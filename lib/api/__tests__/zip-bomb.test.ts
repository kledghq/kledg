/**
 * Zip bomb guard of .xlsx uploads (assertSafeZip, lib/api/files.ts). The
 * sizes a zip declares are written by whoever made the file: the guard
 * inflates every entry with a byte budget and counts what really comes out,
 * so lying headers, overlapping entries ("better zip bomb", several central
 * directory entries pointing at the same data) and huge entry counts are
 * refused before ExcelJS sees the file. Archives are crafted here.
 */

import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'zlib'
import { assertSafeZip } from '../files'

interface Entry {
  name: string
  content: Buffer
  /** Uncompressed size written in the headers (defaults to the real one). */
  declared?: number
}

/** Builds a zip; `overlap` adds central directory entries pointing at the first local file. */
function buildZip(entries: Entry[], options: { overlap?: number } = {}): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  const records: Array<{ name: Buffer; data: Buffer; declared: number; offset: number }> = []
  for (const entry of entries) {
    const data = deflateRawSync(entry.content)
    const name = Buffer.from(entry.name)
    const declared = entry.declared ?? entry.content.length
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(declared, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, data)
    records.push({ name, data, declared, offset })
    offset += local.length + name.length + data.length
  }
  const all = [...records, ...Array.from({ length: options.overlap ?? 0 }, (_, i) => ({ ...records[0], name: Buffer.from(`xl/copy${i}.xml`) }))]
  for (const r of all) {
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(r.data.length, 20)
    central.writeUInt32LE(r.declared, 24)
    central.writeUInt16LE(r.name.length, 28)
    central.writeUInt32LE(r.offset, 42)
    centrals.push(central, r.name)
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(all.length, 8)
  eocd.writeUInt16LE(all.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

const MB = 1024 * 1024

describe('assertSafeZip', () => {
  it('accepts a normal workbook-like archive', async () => {
    const archive = buildZip([
      { name: '[Content_Types].xml', content: Buffer.from('<Types/>') },
      { name: 'xl/worksheets/sheet1.xml', content: Buffer.from(`<sheetData>${'<row><c><v>1</v></c></row>'.repeat(2000)}</sheetData>`) },
    ])
    await expect(assertSafeZip(archive)).resolves.toBeUndefined()
  })

  it('refuses an archive whose headers understate what the entries really inflate to', async () => {
    // 64 MB of zeros declared as 1 KB: the declared total and ratio look harmless.
    const lying = buildZip([{ name: 'xl/sharedStrings.xml', content: Buffer.alloc(64 * MB), declared: 1024 }])
    await expect(assertSafeZip(lying, { maxTotalBytes: 32 * MB })).rejects.toThrow(/décompressé/)
  })

  it('refuses overlapping entries that inflate the same data many times', async () => {
    const overlapping = buildZip([{ name: 'xl/worksheets/sheet1.xml', content: Buffer.alloc(4 * MB) }], { overlap: 20 })
    await expect(assertSafeZip(overlapping, { maxTotalBytes: 32 * MB })).rejects.toThrow(/décompressé/)
  })

  it('refuses an extreme compression ratio even under the size budget', async () => {
    const dense = buildZip([{ name: 'xl/worksheets/sheet1.xml', content: Buffer.alloc(30 * MB) }])
    await expect(assertSafeZip(dense)).rejects.toThrow(/décompressé/)
  })

  it('refuses an archive with too many entries', async () => {
    const many = buildZip(Array.from({ length: 50 }, (_, i) => ({ name: `xl/f${i}.xml`, content: Buffer.from('<a/>') })))
    await expect(assertSafeZip(many, { maxEntries: 20 })).rejects.toThrow(/trop de fichiers/)
  })

  it('refuses archives it cannot read', async () => {
    await expect(assertSafeZip(Buffer.from('not a zip at all, definitely not'))).rejects.toThrow(/invalide/)
    const archive = buildZip([{ name: 'a.xml', content: Buffer.from('<a/>') }])
    await expect(assertSafeZip(archive.subarray(0, archive.length - 30))).rejects.toThrow(/invalide/)
  })
})
