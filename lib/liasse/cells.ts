/**
 * The cells of a table of the liasse fiscale (pure, usable by the client):
 * each box of an official form is either computed from the validated
 * entries or a record Kledg holds (with its box code and where it comes
 * from), or listed as to fill by hand with the reason. Kledg never puts a
 * value in a box the books do not give: what they do not say is flagged,
 * not guessed (docs/liasse-fiscale.md).
 */

/** What a cell holds: an amount in cents, a count, a percentage in hundredths, a number of months, a yes or no, a text. */
export type CellValue =
  | { kind: 'amount'; cents: number }
  | { kind: 'count'; value: number }
  | { kind: 'percent'; hundredths: number }
  | { kind: 'months'; value: number }
  | { kind: 'flag'; value: boolean }
  | { kind: 'text'; value: string }

/**
 * Where a computed value comes from: the validated entries of the year
 * (books), a record of the company (company information, shareholders,
 * provisions register, group), the impôt sur les sociétés worksheet, or an
 * answer the user gave (annexe, approval). "manual": nothing in Kledg says it.
 */
export type CellSource = 'books' | 'record' | 'worksheet' | 'answer' | 'manual'

export interface LiasseCell {
  /** Box code printed on the form; null when the form prints none (2065-SD, identification). */
  box: string | null
  /** Column of a grid row, or the label of a field. */
  label: string
  /** Null: to fill by hand. */
  value: CellValue | null
  source: CellSource
  /** Accounts read (books). */
  accounts?: string[]
  /** Why a cell is to fill by hand, or the assumption behind a computed one (French). */
  note?: string
  /**
   * A computed total that adds cells to fill by hand: the value covers the
   * computed cells only, and these boxes are still to add.
   */
  pending?: string[]
  /** A figure of the books that helps fill a cell by hand (never the answer itself). */
  hint?: CellValue
}

export interface LiasseRow {
  id: string
  label: string
  total?: boolean
  cells: LiasseCell[]
}

export interface LiasseSection {
  id: string
  title: string
  /** Column headings of a grid; null for a list of fields (one cell per row). */
  columns: string[] | null
  rows: LiasseRow[]
  note?: string
}

export interface LiasseCheck {
  id: string
  label: string
  ok: boolean
  /** French explanation when it differs, or when it cannot be checked. */
  message: string | null
}

export interface LiasseForm {
  /** "2033-D", "2065"... */
  id: string
  /** Official number, "2033-D-SD". */
  number: string
  title: string
  sections: LiasseSection[]
  checks: LiasseCheck[]
  warnings: string[]
  /** Whether the form is to file, and why not (below a threshold, nothing to declare: "Néant"). */
  required: { value: boolean; reason: string | null }
}

export const amount = (cents: number): CellValue => ({ kind: 'amount', cents })
export const count = (value: number): CellValue => ({ kind: 'count', value })
export const text = (value: string): CellValue => ({ kind: 'text', value })
export const flag = (value: boolean): CellValue => ({ kind: 'flag', value })
export const percent = (hundredths: number): CellValue => ({ kind: 'percent', hundredths })
export const months = (value: number): CellValue => ({ kind: 'months', value })

/** A computed cell. */
export function cell(
  box: string | null,
  label: string,
  value: CellValue,
  source: Exclude<CellSource, 'manual'>,
  extra: Partial<Pick<LiasseCell, 'accounts' | 'note' | 'pending'>> = {},
): LiasseCell {
  return { box, label, value, source, ...extra }
}

/** A cell to fill by hand, with the reason and, when the books help, a figure to start from. */
export function manual(box: string | null, label: string, note: string, hint?: CellValue): LiasseCell {
  return { box, label, value: null, source: 'manual', note, ...(hint ? { hint } : {}) }
}

/** A row holding one field, labelled like its cell. */
export function field(id: string, c: LiasseCell): LiasseRow {
  return { id, label: c.label, cells: [c] }
}

/**
 * The sum of amount cells. Cells to fill by hand count as zero and are
 * listed in `pending`, so a total never hides a box still empty.
 */
export function sumCells(box: string | null, label: string, parts: readonly LiasseCell[], source: Exclude<CellSource, 'manual'> = 'books'): LiasseCell {
  let cents = 0
  const pending: string[] = []
  for (const p of parts) {
    if (p.value?.kind === 'amount') cents += p.value.cents
    else if (p.value === null) pending.push(p.box ?? p.label)
    pending.push(...(p.pending ?? []))
  }
  return { box, label, value: amount(cents), source, ...(pending.length > 0 ? { pending } : {}) }
}

export const centsOf = (c: LiasseCell | undefined): number | null => (c?.value?.kind === 'amount' ? c.value.cents : null)

/** Every cell of a form, in order. */
export function cellsOf(form: LiasseForm): Array<{ section: LiasseSection; row: LiasseRow; cell: LiasseCell }> {
  return form.sections.flatMap((section) => section.rows.flatMap((row) => row.cells.map((c) => ({ section, row, cell: c }))))
}

/** The cell carrying a box code, searched through the form. */
export function cellByBox(form: LiasseForm, box: string): LiasseCell | undefined {
  return cellsOf(form).find((x) => x.cell.box === box)?.cell
}

export function check(id: string, label: string, ok: boolean, message: string | null): LiasseCheck {
  return { id, label, ok, message: ok ? null : message }
}

/** Counts of a form: cells computed and cells to fill by hand. */
export function coverageOf(form: LiasseForm): { computed: number; manual: number } {
  const all = cellsOf(form)
  const manualCells = all.filter((x) => x.cell.value === null).length
  return { computed: all.length - manualCells, manual: manualCells }
}
