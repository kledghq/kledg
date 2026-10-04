/**
 * A generated document as data: written once by the builders (build.ts),
 * rendered as PDF (pdf.tsx) and as editable Markdown (markdown.ts), so the
 * two formats always say the same thing. Pure.
 */

export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'checklist'; items: string[] }
  | { kind: 'table'; columns: string[]; rows: string[][]; numeric?: number[] }
  | { kind: 'note'; text: string }
  | { kind: 'signatures'; place: string | null; date: string | null; signers: Array<{ name: string; role: string }> }

export interface GeneratedDocument {
  /** Lines identifying the company (name, form and capital, head office, RCS). */
  header: string[]
  title: string
  subtitle: string | null
  blocks: Block[]
  /** Short line at the bottom of each PDF page. */
  footer: string
  /** File name without extension. */
  fileName: string
}

/** Cents as "1 234,56 €" with no-break spaces (rendered the same in PDF and Markdown). */
export function eur(cents: number): string {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const euros = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const fraction = String(abs % 100).padStart(2, '0')
  return `${negative ? '-' : ''}${euros},${fraction} €`
}
