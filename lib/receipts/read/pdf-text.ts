/**
 * The text of a PDF, as lines, read with PDF.js (pdfjs-dist, Mozilla), for
 * the fields of a receipt (invoice-text.ts). Server side only.
 *
 * Only the text layer is read: a scanned PDF (an image) gives no text, and
 * Kledg does no OCR. Lines are rebuilt from the position of each piece of
 * text: same baseline, left to right.
 *
 * Invariants, since the file comes from a user:
 * - PDF.js (version 6, which no longer compiles fonts with eval) runs
 *   without fonts loaded into the page, without system fonts, and fetches
 *   nothing: the whole file is given, no range or stream request;
 * - at most MAX_PAGES pages are read (the first ones and the last, where
 *   invoices put their totals), MAX_CHARS characters kept, and reading
 *   stops after TIMEOUT_MS;
 * - an encrypted, damaged or empty PDF gives null, never an error: the
 *   receipt is staged all the same, its fields typed by the user.
 */

import { logger } from '@/lib/logger'

const MAX_PAGES = 3
const MAX_CHARS = 100_000
const TIMEOUT_MS = 8_000
/** Pieces of text whose baselines are this close (in PDF points) are on the same line. */
const SAME_LINE = 2

interface TextPiece {
  str: string
  transform: number[]
}

function linesOf(pieces: TextPiece[]): string[] {
  const rows: Array<{ y: number; parts: Array<{ x: number; str: string }> }> = []
  for (const piece of pieces) {
    if (!piece.str) continue
    const [, , , , x, y] = piece.transform
    const row = rows.find((r) => Math.abs(r.y - y) <= SAME_LINE)
    if (row) row.parts.push({ x, str: piece.str })
    else rows.push({ y, parts: [{ x, str: piece.str }] })
  }
  // Top of the page first (PDF y grows upwards)
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) =>
      row.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
}

type LoadingTask = { promise: Promise<PdfDocument>; destroy(): Promise<void> }
interface PdfDocument {
  numPages: number
  getPage(number: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>
}

async function open(bytes: Uint8Array): Promise<LoadingTask> {
  // The worker runs on this thread: imported here by name, so the server
  // build (output: standalone) ships it; PDF.js uses it instead of loading
  // pdf.worker.mjs by a path the build cannot see.
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.mjs')])
  const global = globalThis as { pdfjsWorker?: unknown }
  global.pdfjsWorker ??= worker
  // PDF.js takes ownership of the buffer: give it a copy
  return pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    disableAutoFetch: true,
    disableStream: true,
    verbosity: 0,
  }) as unknown as LoadingTask
}

async function read(task: LoadingTask): Promise<string[]> {
  const pdf = await task.promise
  const pages = [...new Set([1, 2, pdf.numPages].filter((n) => n >= 1 && n <= pdf.numPages))].slice(0, MAX_PAGES)
  const lines: string[] = []
  let chars = 0
  for (const number of pages) {
    const page = await pdf.getPage(number)
    const content = await page.getTextContent()
    for (const line of linesOf(content.items as TextPiece[])) {
      if (chars + line.length > MAX_CHARS) return lines
      lines.push(line)
      chars += line.length
    }
  }
  return lines
}

/** The lines of text of the PDF, top to bottom; null when it has none or cannot be read. */
export async function pdfTextLines(bytes: Uint8Array): Promise<string[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let task: LoadingTask | undefined
  try {
    task = await open(bytes)
    const lines = await Promise.race([
      read(task),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), TIMEOUT_MS)
      }),
    ])
    return lines && lines.length > 0 ? lines : null
  } catch (error) {
    // Encrypted, damaged: the user types the fields
    logger.debug('[Receipts] PDF text unreadable', { error: (error as Error).message })
    return null
  } finally {
    clearTimeout(timer)
    // Also stops a reading cut by the timeout
    await task?.destroy().catch(() => undefined)
  }
}
