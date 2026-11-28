/**
 * The amount due, the date and the currency of an invoice or a receipt,
 * read from the text of its PDF (pdf-text.ts), to prefill the form of the
 * Justificatifs page. Pure module: lines in, fields out.
 *
 * Kledg reads the text layer only (no OCR, no model): what the PDF says,
 * as its issuer wrote it. Every field is a proposal the user confirms, so
 * each rule prefers saying nothing to guessing:
 * - the amount is the one labelled as due (net à payer, total à payer),
 *   else the total VAT included (total TTC), else a plain total that is not
 *   a total excluding tax or a VAT total. The last such line wins: totals
 *   end a document. An amount needs its two decimals ("1 200,00"): a whole
 *   number is too often an invoice or an order number;
 * - the date is the one labelled as the invoice date, else the first date
 *   of the document that is not a due or delivery date. Day first
 *   (03/10/2026 is 3 October), as written in France;
 * - the currency is the one written beside the amount (€, EUR, $, £...),
 *   else the euro when the document shows it anywhere.
 */

export interface InvoiceTextFields {
  /** Cents, the amount due (VAT included). */
  amountCents: number | null
  /** ISO 4217 code. */
  currency: string | null
  /** yyyy-mm-dd */
  date: string | null
}

/** Lower case, without accents, spaces of every kind as one space. */
function normalize(line: string): string {
  return line
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s  ]+/g, ' ')
    .toLowerCase()
    .trim()
}

// ---------------------------------------------------------------------------
// Amounts

/**
 * An amount with two decimals, thousands grouped by a space, a dot or a
 * comma ("1 200,00", "1.200,00", "1,200.00", "1200.00"). The thousands
 * separator must differ from the decimal one.
 */
const AMOUNT = /(?<![\d.,])(\d{1,3}(?:([ .,])\d{3})(?:\2\d{3})*|\d+)([.,])(\d{2})(?![\d])/g

/** Over this, a "total" is a reference number misread, not an amount (10 million euros). */
const MAX_AMOUNT_CENTS = 1_000_000_000

/** The amounts of a line, in order, in cents. */
export function amountsOf(line: string): number[] {
  const text = line.replace(/[  ]/g, ' ')
  const out: number[] = []
  for (const match of text.matchAll(AMOUNT)) {
    const [, units, thousands, decimal, cents] = match
    if (thousands && thousands === decimal) continue
    const value = Number(units.replace(/[ .,]/g, '')) * 100 + Number(cents)
    if (value > 0 && value < MAX_AMOUNT_CENTS) out.push(value)
  }
  return out
}

/** Labels of the amount, strongest first. Matched on the normalized line. */
const AMOUNT_LABELS: RegExp[] = [
  /\b(net a payer|total a payer|montant a payer|reste a payer|solde a payer|montant du|amount due|total due|balance due)\b/,
  /\b(total ttc|montant ttc|total toutes taxes|ttc|total \(?tva incluse\)?|total tva comprise|total incl\.? (vat|tax)|total including (vat|tax))\b/,
  /\btotal\b/,
]
/** A total that is not the amount paid: excluding tax, the VAT itself, a subtotal. */
const NOT_DUE = /\b(ht|hors taxes?|h\.t\.|tva|vat|tax(es)?|sous-total|sous total|subtotal|sub-total|excl\.?|excluding|net ht|remise|discount|acompte verse|deja paye)\b/

function labelRank(normalized: string): number | null {
  for (let rank = 0; rank < AMOUNT_LABELS.length; rank++) {
    if (!AMOUNT_LABELS[rank].test(normalized)) continue
    // "Total TTC" holds "ttc"; "Total HT" and "Total TVA" are not due
    if (rank === 2 && NOT_DUE.test(normalized)) return null
    if (rank === 1 && /\b(ht|hors taxes?)\b/.test(normalized) && !/\bttc\b/.test(normalized)) return null
    return rank
  }
  return null
}

const CURRENCIES: Array<[RegExp, string]> = [
  [/€|\beur(os?)?\b/i, 'EUR'],
  [/\$|\busd\b/i, 'USD'],
  [/£|\bgbp\b/i, 'GBP'],
  [/\bchf\b/i, 'CHF'],
]

function currencyOf(text: string): string | null {
  for (const [pattern, code] of CURRENCIES) if (pattern.test(text)) return code
  return null
}

function findAmount(lines: readonly string[]): { cents: number; line: string } | null {
  let best: { rank: number; cents: number; line: string } | null = null
  for (let index = 0; index < lines.length; index++) {
    const rank = labelRank(normalize(lines[index]))
    if (rank === null) continue
    // The amount on the line of its label, else at the start of the next line (a table)
    let source = lines[index]
    let amounts = amountsOf(source)
    if (amounts.length === 0 && index + 1 < lines.length) {
      source = lines[index + 1]
      amounts = amountsOf(source).slice(0, 1)
    }
    if (amounts.length === 0) continue
    // A stronger label wins; for the same label, the last line (totals end a document)
    if (!best || rank <= best.rank) best = { rank, cents: amounts[amounts.length - 1], line: source }
  }
  return best ? { cents: best.cents, line: best.line } : null
}

// ---------------------------------------------------------------------------
// Dates

const MONTHS: Record<string, number> = {
  janvier: 1, janv: 1, jan: 1, january: 1,
  fevrier: 2, fevr: 2, fev: 2, feb: 2, february: 2,
  mars: 3, mar: 3, march: 3,
  avril: 4, avr: 4, apr: 4, april: 4,
  mai: 5, may: 5,
  juin: 6, jun: 6, june: 6,
  juillet: 7, juil: 7, jul: 7, july: 7,
  aout: 8, aug: 8, august: 8,
  septembre: 9, sept: 9, sep: 9, september: 9,
  octobre: 10, oct: 10, october: 10,
  novembre: 11, nov: 11, november: 11,
  decembre: 12, dec: 12, december: 12,
}
const MONTH_NAMES = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')

function validDay(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000
  if (y < 2000 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCMonth() !== m - 1) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const DATE_PATTERNS: Array<[RegExp, (m: RegExpExecArray) => string | null]> = [
  [/(?<!\d)(20\d{2})-(\d{2})-(\d{2})(?!\d)/, (m) => validDay(+m[1], +m[2], +m[3])],
  [/(?<![\d/.-])(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2}|\d{2})(?![\d/.-])/, (m) => validDay(+m[3], +m[2], +m[1])],
  [new RegExp(`(?<!\\d)(\\d{1,2})(?:er)?\\.? (${MONTH_NAMES})\\.? (20\\d{2})(?!\\d)`), (m) => validDay(+m[3], MONTHS[m[2]], +m[1])],
  [new RegExp(`\\b(${MONTH_NAMES})\\.? (\\d{1,2})(?:st|nd|rd|th)?,? (20\\d{2})(?!\\d)`), (m) => validDay(+m[3], MONTHS[m[1]], +m[2])],
]

/** The first date of a normalized line. */
export function dateOf(normalized: string): string | null {
  let best: { index: number; date: string } | null = null
  for (const [pattern, read] of DATE_PATTERNS) {
    const match = pattern.exec(normalized)
    if (!match) continue
    const date = read(match)
    if (date && (!best || match.index < best.index)) best = { index: match.index, date }
  }
  return best?.date ?? null
}

const DATE_LABEL = /\b(date de (la )?facture|date d'emission|date d emission|date facture|date de facturation|date du recu|date du ticket|facture du|facture emise le|invoice date|date of issue|date issued|issued on|issue date|date)\b/
const OTHER_DATE = /\b(echeance|due|limite|livraison|delivery|expedition|naissance|validite|valable|periode|period)\b/

function findDate(lines: readonly string[]): string | null {
  const normalized = lines.map(normalize)
  for (let index = 0; index < normalized.length; index++) {
    const line = normalized[index]
    if (!DATE_LABEL.test(line) || /\b(echeance|due|limite|livraison|delivery)\b/.test(line)) continue
    const date = dateOf(line.slice(line.search(DATE_LABEL))) ?? (index + 1 < normalized.length ? dateOf(normalized[index + 1]) : null)
    if (date) return date
  }
  for (const line of normalized) {
    if (OTHER_DATE.test(line)) continue
    const date = dateOf(line)
    if (date) return date
  }
  return null
}

// ---------------------------------------------------------------------------

export function readInvoiceText(lines: readonly string[]): InvoiceTextFields {
  const amount = findAmount(lines)
  return {
    amountCents: amount?.cents ?? null,
    currency: amount ? (currencyOf(amount.line) ?? (lines.some((l) => /€/.test(l)) ? 'EUR' : null)) : null,
    date: findDate(lines),
  }
}
