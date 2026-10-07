/**
 * Zip bomb guard of .xlsx uploads (assertSafeZip, lib/api/files.ts). The
 * sizes a zip declares are written by whoever made the file: the guard
 * inflates every entry with a byte budget and counts what really comes out,
 * so lying headers, overlapping entries ("better zip bomb", several central
 * directory entries pointing at the same data) and huge entry counts are
 * refused before ExcelJS sees the file. Archives are crafted here.
 */

import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { crc32, deflateRawSync } from 'zlib'
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
    await expect(assertSafeZip(archive)).resolves.toEqual(['[Content_Types].xml', 'xl/worksheets/sheet1.xml'])
  })

  it('refuses an archive whose headers understate what the entries really inflate to', async () => {
    // 64 MB of zeros declared as 1 KB: the declared total and ratio look harmless.
    const lying = buildZip([{ name: 'xl/sharedStrings.xml', content: Buffer.alloc(64 * MB), declared: 1024 }])
    await expect(assertSafeZip(lying, { maxTotalBytes: 32 * MB })).rejects.toThrow(/décompressé/)
  })

  it('refuses overlapping entries that inflate the same data many times', async () => {
    const overlapping = buildZip([{ name: 'xl/worksheets/sheet1.xml', content: Buffer.alloc(4 * MB) }], { overlap: 20 })
    // Refused as soon as the second record names a local header it does not match (KLEDG-R3-INPUT-02)
    await expect(assertSafeZip(overlapping, { maxTotalBytes: 32 * MB })).rejects.toThrow(/invalide|décompressé/)
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

// The JSZip ExcelJS itself loads (not a direct dependency of Kledg).
const requireHere = createRequire(import.meta.url)
interface Zip {
  files: Record<string, unknown>
}
const JSZip = createRequire(requireHere.resolve('exceljs'))('jszip') as { loadAsync(data: Uint8Array): Promise<Zip> }

interface RawEntry {
  name: string
  content: Buffer
  /** Name written in the local header (defaults to `name`). */
  localName?: string
  /** Extra field of the central record. */
  extra?: Buffer
}

interface RawOptions {
  /** Records the end of central directory announces (defaults to all). */
  announced?: number
  prepend?: Buffer
  append?: Buffer
  diskNumber?: number
}

/** A zip written field by field, so each field can lie (KLEDG-R3-INPUT-02 differentials). */
function rawZip(entries: RawEntry[], options: RawOptions = {}): Buffer {
  const u16 = (n: number) => {
    const b = Buffer.alloc(2)
    b.writeUInt16LE(n)
    return b
  }
  const u32 = (n: number) => {
    const b = Buffer.alloc(4)
    b.writeUInt32LE(n >>> 0)
    return b
  }
  const prefix = options.prepend ?? Buffer.alloc(0)
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const data = deflateRawSync(e.content)
    const crc = crc32(e.content)
    const name = Buffer.from(e.name)
    const localName = Buffer.from(e.localName ?? e.name)
    const extra = e.extra ?? Buffer.alloc(0)
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0), u32(crc), u32(data.length), u32(e.content.length), u16(localName.length), u16(0), localName, data,
    ])
    central.push(
      Buffer.concat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0), u32(crc), u32(data.length), u32(e.content.length),
        u16(name.length), u16(extra.length), u16(0), u16(0), u16(0), u32(0), u32(offset), name, extra,
      ]),
    )
    locals.push(local)
    offset += local.length
  }
  const cd = Buffer.concat(central)
  const announced = options.announced ?? entries.length
  const eocd = Buffer.concat([u32(0x06054b50), u16(options.diskNumber ?? 0), u16(0), u16(announced), u16(announced), u32(cd.length), u32(offset), u16(0)])
  return Buffer.concat([prefix, ...locals, cd, eocd, options.append ?? Buffer.alloc(0)])
}

const sheet = { name: 'xl/worksheets/sheet1.xml', content: Buffer.from('<worksheet><sheetData/></worksheet>') }
const hidden = { name: 'xl/hidden.xml', content: Buffer.alloc(8 * MB, 0x20) }

describe('[KLEDG-R3-INPUT-02] the guard sees exactly the entries JSZip reads', () => {
  it('a well formed raw archive is accepted and JSZip lists the same entries', async () => {
    const archive = rawZip([sheet, { name: 'xl/b.xml', content: Buffer.from('<b/>') }])
    const names = await assertSafeZip(archive)
    expect(names).toEqual(Object.keys((await JSZip.loadAsync(archive)).files))
  })

  it.each([
    ['a central directory record beyond the announced count', () => rawZip([sheet, hidden], { announced: 1 })],
    ['a ZIP64 sentinel in the disk number', () => rawZip([sheet], { diskNumber: 0xffff })],
    ['a disk number other than 0', () => rawZip([sheet], { diskNumber: 1 })],
    ['bytes prepended before the archive (JSZip rebases offsets)', () => rawZip([sheet], { prepend: Buffer.from('MZ junk in front') })],
    ['bytes after the end record', () => rawZip([sheet], { append: Buffer.from('trailing') })],
    ['two entries with the same name (JSZip keeps the last)', () => rawZip([sheet, { ...hidden, name: sheet.name }])],
    ['the same part with and without a leading slash', () => rawZip([sheet, { ...hidden, name: `/${sheet.name}` }])],
    ['a local header naming another entry than its central record', () => rawZip([sheet, { ...hidden, name: 'xl/a.xml', localName: 'xl/z.xml' }])],
    ['a Unicode path extra field (JSZip renames the entry)', () => rawZip([sheet, { ...hidden, extra: Buffer.from([0x75, 0x70, 0x01, 0x00, 0x00]) }])],
    ['a non ASCII entry name', () => rawZip([sheet, { ...hidden, name: 'xl/caf\u00e9.xml' }])],
  ])('refuses %s', async (_, build) => {
    await expect(assertSafeZip(build())).rejects.toThrow('Fichier Excel invalide ou corrompu.')
  })

  it('a ZIP64 locator before the end record is refused', async () => {
    const archive = rawZip([sheet])
    const eocd = archive.length - 22
    const locator = Buffer.alloc(20)
    locator.writeUInt32LE(0x07064b50, 0)
    const withLocator = Buffer.concat([archive.subarray(0, eocd), locator, archive.subarray(eocd)])
    await expect(assertSafeZip(withLocator)).rejects.toThrow('Fichier Excel invalide ou corrompu.')
  })

  it('a hidden entry over the budget never reaches the statement parser', async () => {
    const { parseStatementFile } = await import('@/lib/banking/import/parse')
    const archive = rawZip([sheet, { name: 'xl/hidden.xml', content: Buffer.alloc(64 * MB, 0x20) }], { announced: 1 })
    expect(Object.keys((await JSZip.loadAsync(archive)).files)).toContain('xl/hidden.xml')
    await expect(parseStatementFile(new Uint8Array(archive))).rejects.toThrow('Fichier Excel invalide ou corrompu.')
  })

  it('counts every cell of every entry, whatever the namespace prefix', async () => {
    const cells = '<x:c r="A1"/>'.repeat(30) + '<c r="B1">' + '<c>'.repeat(30)
    await expect(assertSafeZip(rawZip([{ name: 'xl/s.xml', content: Buffer.from(cells) }]), { maxCells: 60 })).rejects.toThrow(/trop de cellules/)
    await expect(assertSafeZip(rawZip([{ name: 'xl/s.xml', content: Buffer.from(cells) }]), { maxCells: 61 })).resolves.toEqual(['xl/s.xml'])
    // `<col>`, `<cfRule>`, closing tags, comments and declarations are not cells
    const others = Buffer.from('<?xml version="1.0"?><cols><col min="1"/></cols><!-- c --><cfRule/></c>')
    await expect(assertSafeZip(rawZip([{ name: 'xl/s.xml', content: others }]), { maxCells: 1 })).resolves.toEqual(['xl/s.xml'])
    await expect(assertSafeZip(rawZip([{ name: 'xl/s.xml', content: others }]), { maxElements: 2 })).rejects.toThrow(/trop de cellules/)
  })
})
