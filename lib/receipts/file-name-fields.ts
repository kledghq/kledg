/**
 * What a receipt's file name tells, to prefill the small form of the
 * Justificatifs drop zone: Kledg reads no image on the server (no model,
 * no OCR), so the user confirms the amount, the date and the merchant, and
 * a name like "2026-10-03 Carrefour 23,45.pdf" or "facture_ovh_20261003.pdf"
 * saves typing. Camera names (IMG_1234.jpg, PXL_20261003_...) give the date
 * at most. Pure module, without imports (client side).
 */

export interface FileNameFields {
  /** yyyy-mm-dd */
  date: string | null
  /** Cents, VAT included. */
  amountCents: number | null
  merchant: string | null
}

const CAMERA = /^(img|image|pxl|dsc|dcim|photo|scan|screenshot|capture|whatsapp|signal|wa\d*|pict?|mvimg)$/i
const GENERIC = new Set(['facture', 'invoice', 'recu', 'reçu', 'ticket', 'receipt', 'justificatif', 'note', 'frais', 'de', 'du', 'le', 'la', 'copie', 'scan', 'eur', 'euros', 'ttc', 'jpg', 'jpeg', 'png', 'pdf', 'heic'])

function validDay(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCMonth() !== m - 1) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function findDate(text: string): { date: string; match: string } | null {
  const iso = /(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)/.exec(text)
  if (iso) {
    const date = validDay(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    if (date) return { date, match: iso[0] }
  }
  const fr = /(?<!\d)(\d{2})[-_.](\d{2})[-_.](20\d{2})(?!\d)/.exec(text)
  if (fr) {
    const date = validDay(Number(fr[3]), Number(fr[2]), Number(fr[1]))
    if (date) return { date, match: fr[0] }
  }
  return null
}

function findAmount(text: string): { cents: number; match: string } | null {
  // A decimal amount with two decimals ("23,45", "1234.50", "23,45eur"): whole numbers are too ambiguous (a ticket number).
  const all = [...text.matchAll(/(?<![\d.,])(\d{1,6})[,.](\d{2})(?![\d])\s*(?:€|eur(?:os)?)?/gi)]
  const last = all[all.length - 1]
  if (!last) return null
  return { cents: Number(last[1]) * 100 + Number(last[2]), match: last[0] }
}

/** The date, amount and merchant a file name gives, each null when absent. */
export function fieldsFromFileName(fileName: string): FileNameFields {
  let text = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '')
  const date = findDate(text)
  if (date) text = text.replace(date.match, ' ')
  const amount = findAmount(text)
  if (amount) text = text.replace(amount.match, ' ')
  const parts = text
    .split(/[\s_\-.+()[\]]+/)
    .filter((w) => w && !/^\d+$/.test(w) && !GENERIC.has(w.toLowerCase()))
  const camera = parts.length > 0 && CAMERA.test(parts[0])
  const words = camera ? [] : parts.filter((w) => /[A-Za-zÀ-ÿ]/.test(w))
  const merchant = words.length ? words.slice(0, 4).map((w) => (w === w.toUpperCase() || w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ') : null
  return { date: date?.date ?? null, amountCents: amount?.cents ?? null, merchant }
}
