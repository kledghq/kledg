/**
 * Numbering of sales invoices, on plain values (pure: used by the settings
 * form for its preview and by the server when it assigns a number).
 *
 * CGI annexe II art. 242 nonies A, I, 7°: an invoice carries "un numéro
 * unique basé sur une séquence chronologique et continue". BOFiP
 * BOI-TVA-DECLA-30-20-20-10 (version of 2013-10-18), § 70 to 100: the
 * numbering may use separate series when the conditions of the business
 * justify it; each series is numbered chronologically as invoices are
 * issued, is continuous, and two invoices issued the same year never share a
 * number; a distinct prefix per series is advised (§ 90). A series restarted
 * each year therefore needs the year in the number: a yearly or fiscal year
 * reset requires a year in the format. A credit note is an invoice and has
 * its number too: in the invoice series, or in a series of its own with its
 * own prefix.
 *
 * A format is built from parts, not typed as a free template:
 * <prefix><year><separator><month><separator><sequence>, the default giving
 * F{YYYY}-{SEQ:4}, F2026-0001. A sequence longer than its padding is printed
 * in full (F2026-10000): numbers are never truncated.
 */

export const NUMBERING_MODES = ['AUTO', 'MANUAL'] as const
export const YEAR_FORMATS = ['YYYY', 'YY', 'NONE'] as const
export const SEPARATORS = ['-', '/', '_', '.', ''] as const
export const RESETS = ['YEARLY', 'FISCAL_YEAR', 'NEVER'] as const
export const CREDIT_NOTE_SERIES = ['SAME_SERIES', 'OWN_SERIES'] as const

export type NumberingMode = (typeof NUMBERING_MODES)[number]
export type YearFormat = (typeof YEAR_FORMATS)[number]
export type Separator = (typeof SEPARATORS)[number]
export type Reset = (typeof RESETS)[number]
export type CreditNoteSeries = (typeof CREDIT_NOTE_SERIES)[number]
export type Series = 'INVOICE' | 'CREDIT_NOTE'

export interface NumberFormat {
  prefix: string
  year: YearFormat
  month: boolean
  separator: Separator
  padding: number
}

export interface InvoiceNumberingSettings extends NumberFormat {
  /** AUTO: Kledg numbers sales invoices when they are posted; MANUAL: the number is typed (the company numbers elsewhere). */
  mode: NumberingMode
  reset: Reset
  creditNotes: CreditNoteSeries
  /** Prefix of the credit note series (OWN_SERIES), the other parts shared with invoices. */
  creditNotePrefix: string
  /** Create sales invoices in Qonto first; null: on when the Qonto connection can create them. */
  qontoFirst: boolean | null
}

export const DEFAULT_NUMBERING: InvoiceNumberingSettings = {
  mode: 'AUTO',
  prefix: 'F',
  year: 'YYYY',
  month: false,
  separator: '-',
  padding: 4,
  reset: 'YEARLY',
  creditNotes: 'SAME_SERIES',
  creditNotePrefix: 'A',
  qontoFirst: null,
}

/** Highest sequence (9 digits): the parser reads at most 9 digits. */
export const MAX_SEQUENCE = 999_999_999

/** Characters allowed in a prefix: letters, digits and - / _ . (printed as is). */
export const PREFIX_PATTERN = /^[A-Za-z0-9\-/_.]{0,20}$/

/** The format of a series (credit notes take their own prefix when they have their own series). */
export function formatOf(settings: InvoiceNumberingSettings, series: Series): NumberFormat {
  const prefix = series === 'CREDIT_NOTE' && settings.creditNotes === 'OWN_SERIES' ? settings.creditNotePrefix : settings.prefix
  return { prefix, year: settings.year, month: settings.month, separator: settings.separator, padding: settings.padding }
}

/** Series of an invoice by its type (UNTDID 1001: 381 is a credit note). */
export function seriesOf(settings: Pick<InvoiceNumberingSettings, 'creditNotes'>, typeCode: string): Series {
  return typeCode === '381' && settings.creditNotes === 'OWN_SERIES' ? 'CREDIT_NOTE' : 'INVOICE'
}

/** Types of invoice that share a series. */
export function typeCodesOf(settings: Pick<InvoiceNumberingSettings, 'creditNotes'>, series: Series): string[] {
  if (settings.creditNotes === 'SAME_SERIES') return ['380', '381']
  return series === 'CREDIT_NOTE' ? ['381'] : ['380']
}

/** The format as a template, F{YYYY}-{SEQ:4}. */
export function patternOf(format: NumberFormat): string {
  const year = format.year === 'NONE' ? '' : `{${format.year}}`
  const month = format.month ? `${year ? format.separator : ''}{MM}` : ''
  const head = `${year}${month}`
  return `${format.prefix}${head}${head ? format.separator : ''}{SEQ:${format.padding}}`
}

export interface NumberParts {
  /** Year printed by {YYYY} or {YY}: the calendar year of the invoice, or the year its fiscal year ends. */
  year: number
  /** Month of the invoice date, 1 to 12. */
  month: number
  sequence: number
}

/** A number of the series, the sequence padded with zeros and never cut. */
export function renderNumber(format: NumberFormat, parts: NumberParts): string {
  const year = format.year === 'YYYY' ? String(parts.year) : format.year === 'YY' ? String(parts.year % 100).padStart(2, '0') : ''
  const month = format.month ? `${year ? format.separator : ''}${String(parts.month).padStart(2, '0')}` : ''
  const head = `${year}${month}`
  return `${format.prefix}${head}${head ? format.separator : ''}${String(parts.sequence).padStart(format.padding, '0')}`
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')

/**
 * Regular expression of the numbers of a series in one period, the sequence
 * as its only group (POSIX ARE and JavaScript alike, so PostgreSQL can find
 * the highest existing number). `year` null: any year (a series never reset).
 */
export function sequencePattern(format: NumberFormat, year: number | null): string {
  let yearPart = ''
  if (format.year === 'YYYY') yearPart = year === null ? '[0-9]{4}' : String(year)
  if (format.year === 'YY') yearPart = year === null ? '[0-9]{2}' : String(year % 100).padStart(2, '0')
  const sep = escapeRegex(format.separator)
  const month = format.month ? `${yearPart ? sep : ''}(?:0[1-9]|1[0-2])` : ''
  const head = `${yearPart}${month}`
  return `^${escapeRegex(format.prefix)}${head}${head ? sep : ''}([0-9]{1,9})$`
}

/** Sequence of `number` in the series and period, or null when it is not one of its numbers. */
export function parseSequence(format: NumberFormat, year: number | null, number: string): number | null {
  const match = new RegExp(sequencePattern(format, year)).exec(number)
  return match ? Number(match[1]) : null
}

/** Problems of a configuration, in French; empty when it can be saved. */
export function numberingProblems(settings: InvoiceNumberingSettings): string[] {
  const problems: string[] = []
  if (!PREFIX_PATTERN.test(settings.prefix)) problems.push('Le préfixe contient au plus 20 lettres, chiffres ou signes - / _ .')
  if (settings.creditNotes === 'OWN_SERIES') {
    if (!PREFIX_PATTERN.test(settings.creditNotePrefix)) problems.push('Le préfixe des avoirs contient au plus 20 lettres, chiffres ou signes - / _ .')
    if (settings.creditNotePrefix === settings.prefix) problems.push('Les avoirs ont leur propre série : donnez-leur un préfixe différent de celui des factures (ex. A).')
  }
  if (settings.reset !== 'NEVER' && settings.year === 'NONE') {
    problems.push('La séquence repart à 1 chaque année : ajoutez l’année au format, sinon deux factures porteraient le même numéro.')
  }
  if (settings.month && settings.year === 'NONE') problems.push('Le mois s’ajoute après l’année : choisissez d’abord le format de l’année.')
  if (!Number.isInteger(settings.padding) || settings.padding < 1 || settings.padding > 9) problems.push('La séquence compte de 1 à 9 chiffres.')
  // A prefix of 20 characters, the year, the month, two separators and 9 digits stay within the 40 characters Qonto accepts.
  return problems
}

/** Calendar year and month of a day yyyy-mm-dd. */
export function yearMonthOf(day: string): { year: number; month: number } {
  return { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) }
}

/**
 * Period of a series for an invoice date: the counter it draws from
 * ("2026", "FY:<id>", "ALL") and the year its numbers print.
 */
export function periodOf(
  reset: Reset,
  day: string,
  fiscalYear: { id: string; endDay: string } | null,
): { key: string; year: number; month: number } | null {
  const { year, month } = yearMonthOf(day)
  if (reset === 'YEARLY') return { key: String(year), year, month }
  if (reset === 'NEVER') return { key: 'ALL', year, month }
  if (!fiscalYear) return null
  return { key: `FY:${fiscalYear.id}`, year: yearMonthOf(fiscalYear.endDay).year, month }
}
