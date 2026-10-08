/**
 * Upload limits and safe headers for files served or received by API routes.
 */

import { createInflateRaw } from 'zlib'
import { ValidationError } from '@/lib/accounting/errors'

/**
 * Largest accepted upload (imports, bank statements, attachments). Request
 * bodies are capped while they are read by the route wrappers
 * (lib/api/request-guards.ts). On Vercel the platform refuses any request
 * body over 4.5 MB before Kledg sees it (413 FUNCTION_PAYLOAD_TOO_LARGE).
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/** Largest total uncompressed size accepted for an .xlsx (a zip archive). */
const MAX_XLSX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024

/** Highest accepted compression ratio inside an .xlsx, once it inflates beyond RATIO_FLOOR_BYTES (zip bomb guard). */
const MAX_XLSX_RATIO = 100

/** Below this inflated size, the ratio is not checked (small XML parts compress very well). */
const RATIO_FLOOR_BYTES = 10 * 1024 * 1024

/** Most entries an .xlsx may hold (a real workbook has a few dozen to a few thousand). */
const MAX_XLSX_ENTRIES = 10_000

/**
 * Most cells (`<c>` elements, every sheet together) an .xlsx may hold.
 * ExcelJS builds about 600 bytes of objects per cell, whatever the cell
 * holds: a million cells is about 600 MB, a 100,000 line statement with ten
 * columns fits.
 */
export const MAX_XLSX_CELLS = 1_000_000

/** Most XML elements an .xlsx may hold (cells, values, shared strings, styles...): ExcelJS builds an object for each. */
export const MAX_XLSX_ELEMENTS = 3_000_000

const TOO_LARGE = `Fichier trop volumineux (maximum ${MAX_UPLOAD_BYTES / 1024 / 1024} Mo).`

/** Rejects an uploaded file larger than the limit. */
export function assertFileSize(file: { size: number }, max = MAX_UPLOAD_BYTES): void {
  if (file.size > max) throw new ValidationError(TOO_LARGE)
}

export interface ZipLimits {
  /** Total inflated bytes of all entries (default MAX_XLSX_UNCOMPRESSED_BYTES). */
  maxTotalBytes?: number
  /** Number of entries (default MAX_XLSX_ENTRIES). */
  maxEntries?: number
  /** Inflated size / compressed size, checked past 10 MB (default 100). */
  maxRatio?: number
  /** Cells of all sheets (default MAX_XLSX_CELLS). */
  maxCells?: number
  /** XML elements of all entries (default MAX_XLSX_ELEMENTS). */
  maxElements?: number
}

class BudgetExceeded extends Error {}
class ContentExceeded extends Error {}

/**
 * Counts the XML elements and the cells (`<c>`, any namespace prefix) of
 * the inflated entries, chunk by chunk (a tag may span two chunks). Every
 * `<` followed by something else than `/`, `!` or `?` counts as an element,
 * so comments, CDATA or binary parts can only make the count larger than
 * what ExcelJS builds, never smaller.
 */
class XmlElementCounter {
  elements = 0
  cells = 0
  /** 0: in text; 1: right after `<`; 2: reading a tag name. */
  private state = 0
  /** Local name read so far (after the last `:`), up to 2 bytes are enough to tell `c` apart. */
  private local = ''
  private longName = false

  constructor(private readonly maxElements: number, private readonly maxCells: number) {}

  write(chunk: Uint8Array): void {
    const n = chunk.length
    let i = 0
    while (i < n) {
      if (this.state === 0) {
        const lt = chunk.indexOf(0x3c, i)
        if (lt < 0) return
        this.state = 1
        i = lt + 1
        continue
      }
      const b = chunk[i]
      if (this.state === 1) {
        if (b === 0x2f || b === 0x21 || b === 0x3f) {
          this.state = 0
          i++
          continue
        }
        this.elements++
        if (this.elements > this.maxElements) throw new ContentExceeded()
        this.state = 2
        this.local = ''
        this.longName = false
        continue
      }
      // state 2: tag name until whitespace, `>` or `/`
      if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d || b === 0x3e || b === 0x2f || b === 0x3c) {
        if (!this.longName && this.local === 'c') {
          this.cells++
          if (this.cells > this.maxCells) throw new ContentExceeded()
        }
        this.state = 0
        if (b !== 0x3c) i++
        continue
      }
      if (b === 0x3a) {
        this.local = ''
        this.longName = false
      } else if (this.local.length < 2) this.local += String.fromCharCode(b)
      else this.longName = true
      i++
    }
  }
}

/** Inflates raw deflate data, counting the output without keeping it; rejects once `budget` is exceeded. */
function inflatedSize(data: Uint8Array, budget: number, counter: XmlElementCounter): Promise<number> {
  return new Promise((resolve, reject) => {
    const inflate = createInflateRaw()
    let size = 0
    inflate.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > budget) {
        inflate.destroy()
        reject(new BudgetExceeded())
        return
      }
      try {
        counter.write(chunk)
      } catch (error) {
        inflate.destroy()
        reject(error)
      }
    })
    inflate.on('end', () => resolve(size))
    inflate.on('error', reject)
    inflate.end(data)
  })
}

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const SIG_ZIP64_LOCATOR = 0x07064b50

/**
 * Zip bomb guard of an .xlsx (a zip archive), run before ExcelJS reads it.
 * The sizes a zip declares are chosen by whoever made the file, so every
 * entry is really inflated (streamed, the output is counted and dropped)
 * with a byte budget for the whole archive: lying headers, entries that
 * overlap the same data and nested tricks all count what they produce. Also
 * refused: more than `maxEntries` entries, an inflated size more than
 * `maxRatio` times the compressed one (past 10 MB), more than `maxCells`
 * cells or `maxElements` XML elements (what ExcelJS turns into objects),
 * encrypted entries, compression methods other than stored and deflate,
 * ZIP64, and anything that does not parse. Throws a ValidationError with a
 * French message.
 *
 * The guard must see exactly the entries JSZip (the reader inside ExcelJS)
 * will inflate, so the archive has to be unambiguous: JSZip takes the last
 * end of central directory record, reads central directory records as long
 * as their signature follows (whatever count the end record announces),
 * names each entry from its local header, rebases every offset when bytes
 * precede the central directory, switches to ZIP64 on any sentinel field,
 * renames an entry from a Unicode path extra field and keeps the last of
 * two entries with the same name. Hence: the central directory must end
 * exactly at the end record and hold exactly the announced records, the end
 * record must end the file, no field may hold a ZIP64 sentinel, local and
 * central names must match, names are printable ASCII and unique, no Unicode
 * path field, and entries may neither overlap nor reach into the central
 * directory (KLEDG-R3-INPUT-02).
 *
 * Returns the entry names, in central directory order.
 */
export async function assertSafeZip(buffer: Uint8Array, limits: ZipLimits = {}): Promise<string[]> {
  const maxTotal = limits.maxTotalBytes ?? MAX_XLSX_UNCOMPRESSED_BYTES
  const maxEntries = limits.maxEntries ?? MAX_XLSX_ENTRIES
  const maxRatio = limits.maxRatio ?? MAX_XLSX_RATIO
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const invalid = () => new ValidationError('Fichier Excel invalide ou corrompu.')
  const bomb = () => new ValidationError('Fichier Excel refusé : contenu décompressé trop volumineux.')
  const tooManyCells = () =>
    new ValidationError('Fichier Excel refusé : il contient trop de cellules. Découpez-le ou exportez-le en CSV.')
  if (buffer.length < 22) throw invalid()

  // End of central directory: the last signature in the file, as JSZip looks for it (from the very end).
  let eocd = -1
  for (let i = buffer.length - 4; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0 || eocd + 22 > buffer.length) throw invalid()
  const diskNumber = view.getUint16(eocd + 4, true)
  const cdDisk = view.getUint16(eocd + 6, true)
  const entriesOnDisk = view.getUint16(eocd + 8, true)
  const entries = view.getUint16(eocd + 10, true)
  const cdSize = view.getUint32(eocd + 12, true)
  const cdOffset = view.getUint32(eocd + 16, true)
  const commentLength = view.getUint16(eocd + 20, true)
  // ZIP64 (any sentinel or a ZIP64 locator): never produced by Excel for sane files
  if (entries === 0xffff || entriesOnDisk === 0xffff || diskNumber === 0xffff || cdDisk === 0xffff) throw invalid()
  if (cdSize === 0xffffffff || cdOffset === 0xffffffff) throw invalid()
  if (eocd >= 20 && view.getUint32(eocd - 20, true) === SIG_ZIP64_LOCATOR) throw invalid()
  // One disk, the end record ends the file, the central directory ends at the end record
  if (diskNumber !== 0 || cdDisk !== 0 || entriesOnDisk !== entries) throw invalid()
  if (eocd + 22 + commentLength !== buffer.length) throw invalid()
  if (cdOffset + cdSize !== eocd) throw invalid()
  if (entries > maxEntries) throw new ValidationError('Fichier Excel refusé : il contient trop de fichiers.')

  const counter = new XmlElementCounter(limits.maxElements ?? MAX_XLSX_ELEMENTS, limits.maxCells ?? MAX_XLSX_CELLS)
  const names: string[] = []
  const seen = new Set<string>()
  const spans: Array<[number, number]> = []
  let total = 0
  let compressed = 0
  let p = cdOffset
  for (let n = 0; n < entries; n++) {
    if (p + 46 > eocd || view.getUint32(p, true) !== SIG_CENTRAL) throw invalid()
    const flags = view.getUint16(p + 8, true)
    const method = view.getUint16(p + 10, true)
    const csize = view.getUint32(p + 20, true)
    const usize = view.getUint32(p + 24, true)
    const nameLength = view.getUint16(p + 28, true)
    const extraLength = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const entryDisk = view.getUint16(p + 34, true)
    const localOffset = view.getUint32(p + 42, true)
    if (flags & 0x1) throw invalid() // encrypted
    if (csize === 0xffffffff || usize === 0xffffffff || localOffset === 0xffffffff || entryDisk === 0xffff) throw invalid()
    const recordEnd = p + 46 + nameLength + extraLength + commentLen
    if (recordEnd > eocd || nameLength === 0) throw invalid()
    const nameBytes = buffer.subarray(p + 46, p + 46 + nameLength)
    // Unicode path extra field (0x7075): JSZip would rename the entry from it
    for (let e = p + 46 + nameLength; e + 4 <= p + 46 + nameLength + extraLength; ) {
      if (view.getUint16(e, true) === 0x7075) throw invalid()
      e += 4 + view.getUint16(e + 2, true)
    }
    p = recordEnd

    let name = ''
    for (const b of nameBytes) {
      if (b < 0x20 || b > 0x7e || b === 0x5c) throw invalid() // printable ASCII, no backslash
      name += String.fromCharCode(b)
    }
    // ExcelJS drops a leading slash: `/xl/a.xml` and `xl/a.xml` are the same part
    const key = name.replace(/^\/+/, '')
    if (seen.has(key)) throw invalid()
    seen.add(key)
    names.push(name)

    // Local header: JSZip names the entry from it and reads the data right after it
    if (localOffset + 30 > cdOffset || view.getUint32(localOffset, true) !== SIG_LOCAL) throw invalid()
    const localNameLength = view.getUint16(localOffset + 26, true)
    if (localNameLength !== nameLength) throw invalid()
    for (let k = 0; k < nameLength; k++) {
      if (buffer[localOffset + 30 + k] !== nameBytes[k]) throw invalid()
    }
    const dataStart = localOffset + 30 + localNameLength + view.getUint16(localOffset + 28, true)
    if (dataStart + csize > cdOffset) throw invalid()
    spans.push([localOffset, dataStart + csize])
    const data = buffer.subarray(dataStart, dataStart + csize)

    let size: number
    try {
      if (method === 0) {
        size = csize
        if (size > maxTotal - total) throw new BudgetExceeded()
        counter.write(data)
      } else if (method === 8) size = await inflatedSize(data, maxTotal - total, counter)
      else throw invalid()
    } catch (error) {
      if (error instanceof BudgetExceeded) throw bomb()
      if (error instanceof ContentExceeded) throw tooManyCells()
      if (error instanceof ValidationError) throw error
      throw invalid()
    }

    total += size
    compressed += csize
    if (total > maxTotal) throw bomb()
    if (total > RATIO_FLOOR_BYTES && total > compressed * maxRatio) throw bomb()
  }
  // Exactly the announced records: nothing else between the last record and the end record
  if (p !== eocd) throw invalid()
  // Entries never share bytes (a hidden entry inside another one's data)
  spans.sort((a, b) => a[0] - b[0])
  for (let k = 1; k < spans.length; k++) {
    if (spans[k][0] < spans[k - 1][1]) throw invalid()
  }
  return names
}

/** Is this buffer a zip archive (xlsx) rather than CSV or legacy xls? */
export function isZip(buffer: Uint8Array): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04
}

/** Content types a file proxy may serve inline; anything else is downloaded. */
const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'])

function asciiFallback(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\;\r\n]/g, '_')
      .trim() || 'fichier'
  )
}

/** RFC 6266 Content-Disposition with an ASCII fallback and a UTF-8 filename*. */
export function contentDisposition(fileName: string, type: 'inline' | 'attachment'): string {
  const clean = fileName.replace(/[\r\n"]/g, '').slice(0, 200) || 'fichier'
  return `${type}; filename="${asciiFallback(clean)}"; filename*=UTF-8''${encodeURIComponent(clean)}`
}

/**
 * Headers for serving a stored or proxied file: nosniff, a safe disposition,
 * and inline display only for PDFs and raster images (anything else, HTML or
 * SVG included, is served as a download).
 */
export function fileResponseHeaders(contentType: string | null | undefined, fileName: string): Record<string, string> {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase()
  const inline = INLINE_TYPES.has(type)
  return {
    'Content-Type': inline ? type : 'application/octet-stream',
    'Content-Disposition': contentDisposition(fileName, inline ? 'inline' : 'attachment'),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  }
}
