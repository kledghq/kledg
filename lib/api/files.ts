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
}

class BudgetExceeded extends Error {}

/** Inflates raw deflate data, counting the output without keeping it; rejects once `budget` is exceeded. */
function inflatedSize(data: Uint8Array, budget: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const inflate = createInflateRaw()
    let size = 0
    inflate.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > budget) {
        inflate.destroy()
        reject(new BudgetExceeded())
      }
    })
    inflate.on('end', () => resolve(size))
    inflate.on('error', reject)
    inflate.end(data)
  })
}

/**
 * Zip bomb guard of an .xlsx (a zip archive), run before ExcelJS reads it.
 * The sizes a zip declares are chosen by whoever made the file, so every
 * entry is really inflated (streamed, the output is counted and dropped)
 * with a byte budget for the whole archive: lying headers, entries that
 * overlap the same data and nested tricks all count what they produce. Also
 * refused: more than `maxEntries` entries, an inflated size more than
 * `maxRatio` times the compressed one (past 10 MB), encrypted entries,
 * compression methods other than stored and deflate, ZIP64, and anything
 * that does not parse. Throws a ValidationError with a French message.
 */
export async function assertSafeZip(buffer: Uint8Array, limits: ZipLimits = {}): Promise<void> {
  const maxTotal = limits.maxTotalBytes ?? MAX_XLSX_UNCOMPRESSED_BYTES
  const maxEntries = limits.maxEntries ?? MAX_XLSX_ENTRIES
  const maxRatio = limits.maxRatio ?? MAX_XLSX_RATIO
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const invalid = () => new ValidationError('Fichier Excel invalide ou corrompu.')
  const bomb = () => new ValidationError('Fichier Excel refusé : contenu décompressé trop volumineux.')
  if (buffer.length < 22) throw invalid()

  // End of central directory: 22 bytes + up to 65535 bytes of comment.
  let eocd = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw invalid()
  const entries = view.getUint16(eocd + 10, true)
  const cdOffset = view.getUint32(eocd + 16, true)
  if (entries === 0xffff || cdOffset === 0xffffffff) throw invalid() // ZIP64: not produced by Excel for sane files
  if (entries > maxEntries) throw new ValidationError('Fichier Excel refusé : il contient trop de fichiers.')

  let total = 0
  let compressed = 0
  let p = cdOffset
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buffer.length || view.getUint32(p, true) !== 0x02014b50) throw invalid()
    const flags = view.getUint16(p + 8, true)
    const method = view.getUint16(p + 10, true)
    const csize = view.getUint32(p + 20, true)
    const localOffset = view.getUint32(p + 42, true)
    if (flags & 0x1) throw invalid() // encrypted
    if (csize === 0xffffffff || localOffset === 0xffffffff) throw invalid()
    p += 46 + view.getUint16(p + 28, true) + view.getUint16(p + 30, true) + view.getUint16(p + 32, true)

    if (localOffset + 30 > buffer.length || view.getUint32(localOffset, true) !== 0x04034b50) throw invalid()
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true)
    if (dataStart + csize > buffer.length) throw invalid()
    const data = buffer.subarray(dataStart, dataStart + csize)

    let size: number
    if (method === 0) size = csize
    else if (method === 8) {
      try {
        size = await inflatedSize(data, maxTotal - total)
      } catch (error) {
        if (error instanceof BudgetExceeded) throw bomb()
        throw invalid()
      }
    } else throw invalid()

    total += size
    compressed += csize
    if (total > maxTotal) throw bomb()
    if (total > RATIO_FLOOR_BYTES && total > compressed * maxRatio) throw bomb()
  }
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
