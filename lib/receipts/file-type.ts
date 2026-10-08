/**
 * What a receipt file is, read from its first bytes (magic numbers), never
 * from its name or the type a client declares: a photo or a scan sent by an
 * assistant, a ChatGPT file or the Justificatifs page is accepted only as
 * JPEG, PNG or PDF of RECEIPT_MAX_BYTES at most (docs/justificatifs-photo.md).
 *
 * HEIC (the default format of iPhone photos) is recognised to answer with
 * what to do: Kledg has no HEIC decoder on the server (it would mean a
 * native dependency), while the capture view and the Justificatifs page
 * convert any photo the browser can draw to JPEG before sending it.
 *
 * Pure module, usable on both sides.
 */

/** Largest receipt file, after the client-side downscale of large photos. */
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024

export const RECEIPT_CONTENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const
export type ReceiptContentType = (typeof RECEIPT_CONTENT_TYPES)[number]

/** The accept attribute of the file inputs (the browser offers the camera for image/*). */
export const RECEIPT_ACCEPT = 'image/*,application/pdf'

export const RECEIPT_FILE_MESSAGES = {
  empty: 'Le fichier est vide.',
  tooLarge: `Fichier trop volumineux (${RECEIPT_MAX_BYTES / 1024 / 1024} Mo au plus) : reprenez la photo en plus petit, ou envoyez un PDF.`,
  heic: "Photo au format HEIC non acceptée : déposez-la depuis la vue de dépôt ou la page Justificatifs (elle la convertit en JPEG), ou réglez l'appareil photo sur « Le plus compatible » (Réglages, Appareil photo, Formats).",
  type: 'Type de fichier non accepté : une photo JPEG ou PNG, ou un PDF.',
} as const

const EXTENSIONS: Record<ReceiptContentType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' }

/** HEIF brands of the ftyp box (ISO/IEC 23008-12): heic, heix, hevc, hevx, mif1, msf1, heim, heis, avif excluded. */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'])

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let text = ''
  for (let i = start; i < start + length && i < bytes.length; i++) text += String.fromCharCode(bytes[i])
  return text
}

/**
 * The type of a receipt from its bytes: JPEG (FF D8 FF), PNG (the 8 byte
 * signature), PDF ("%PDF-" within the first 1024 bytes, as PDF readers
 * accept, ISO 32000-1 annex H), 'heic' for an HEIF image, else null.
 */
export function sniffReceiptType(bytes: Uint8Array): ReceiptContentType | 'heic' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return 'image/png'
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp' && HEIF_BRANDS.has(ascii(bytes, 8, 4))) return 'heic'
  const head = ascii(bytes, 0, Math.min(bytes.length, 1024))
  if (head.includes('%PDF-')) return 'application/pdf'
  return null
}

/**
 * A safe file name for a receipt of `type`: no path, no control nor
 * invisible character, 120 characters at most, with the extension of its
 * real type ("photo.heic" sent as JPEG becomes "photo.jpg").
 */
export function receiptFileName(name: string | null | undefined, type: ReceiptContentType): string {
  const cleaned = (name ?? '')
    .replace(/[\p{Cf}]+/gu, '')
    .replace(/[\\/\p{Cc}]+/gu, '_')
    .trim()
  const base = cleaned.replace(/\.[A-Za-z0-9]{1,5}$/, '').slice(0, 110) || 'justificatif'
  return `${base}.${EXTENSIONS[type]}`
}

export type ReceiptFileCheck = { ok: true; contentType: ReceiptContentType } | { ok: false; message: string }

/** Whether `bytes` is an accepted receipt: not empty, not too large, JPEG, PNG or PDF. */
export function checkReceiptFile(bytes: Uint8Array): ReceiptFileCheck {
  if (bytes.length === 0) return { ok: false, message: RECEIPT_FILE_MESSAGES.empty }
  if (bytes.length > RECEIPT_MAX_BYTES) return { ok: false, message: RECEIPT_FILE_MESSAGES.tooLarge }
  const type = sniffReceiptType(bytes)
  if (type === 'heic') return { ok: false, message: RECEIPT_FILE_MESSAGES.heic }
  if (type === null) return { ok: false, message: RECEIPT_FILE_MESSAGES.type }
  return { ok: true, contentType: type }
}
