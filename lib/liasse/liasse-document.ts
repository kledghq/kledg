/**
 * The liasse fiscale written as a document (PDF through the document
 * renderer of the approval pack, lib/approval/documents) and as CSV (pure
 * module). Every value carries its box code, and every box to fill by hand
 * says so, so the figures are copied into the professional space or handed
 * to an EDI partner box by box.
 */

import { eur, type Block, type GeneratedDocument } from '@/lib/approval/documents/model'
import { buildCsv } from '@/lib/reports/csv-safe'
import { centsToDecimal } from '@/lib/utils/money'
import type { LiasseView } from './build-liasse'
import type { CellValue, LiasseCell, LiasseForm } from './cells'

export const SOURCE_LABELS: Record<LiasseCell['source'], string> = {
  books: 'Écritures',
  record: 'Fiche Kledg',
  worksheet: 'Calcul IS',
  answer: 'Réponse',
  manual: 'À remplir à la main',
}

const percentText = (hundredths: number) => `${centsToDecimal(hundredths).replace(/\.?0+$/, '').replace('.', ',')} %`

/** A value as French text: amounts with the euro sign, yes or no, percentages. */
export function valueText(value: CellValue): string {
  switch (value.kind) {
    case 'amount':
      return eur(value.cents)
    case 'count':
      return String(value.value)
    case 'percent':
      return percentText(value.hundredths)
    case 'months':
      return `${value.value} mois`
    case 'flag':
      return value.value ? 'Oui' : 'Non'
    case 'text':
      return value.value
  }
}

/** A value as a CSV cell: amounts as decimals with a comma, the rest as text. */
function csvValue(value: CellValue | null): string {
  if (value === null) return ''
  if (value.kind === 'amount') return centsToDecimal(value.cents).replace('.', ',')
  return valueText(value)
}

function cellText(c: LiasseCell): string {
  const value = c.value === null ? 'à remplir' : valueText(c.value)
  const pending = c.pending?.length ? ` (sans ${c.pending.join(', ')})` : ''
  return c.box ? `${c.box} : ${value}${pending}` : `${value}${pending}`
}

function formBlocks(form: LiasseForm): Block[] {
  const blocks: Block[] = [{ kind: 'heading', text: `${form.number} : ${form.title}` }]
  if (form.required.reason) blocks.push({ kind: 'paragraph', text: form.required.reason })
  for (const section of form.sections) {
    if (section.rows.length === 0) {
      if (section.note) blocks.push({ kind: 'paragraph', text: `${section.title}. ${section.note}` })
      continue
    }
    if (section.columns) {
      blocks.push({ kind: 'paragraph', text: section.title })
      blocks.push({
        kind: 'table',
        columns: ['Ligne', ...section.columns],
        rows: section.rows.map((r) => [r.total ? r.label.toUpperCase() : r.label, ...r.cells.map(cellText)]),
        numeric: section.columns.map((_, i) => i + 1),
      })
    } else {
      blocks.push({ kind: 'paragraph', text: section.title })
      // One line per box: the official labels are long, a list keeps them readable in the PDF
      blocks.push({
        kind: 'list',
        items: section.rows.flatMap((r) =>
          r.cells.map((c) => {
            const value = c.value === null ? (c.hint ? `à remplir (repère : ${valueText(c.hint)})` : 'à remplir') : cellText({ ...c, box: null })
            return `${c.box ? `Case ${c.box}, ` : ''}${c.label} : ${value} (${SOURCE_LABELS[c.source].toLowerCase()})`
          }),
        ),
      })
    }
  }
  const toReview = form.checks.filter((c) => !c.ok)
  if (form.checks.length > 0) {
    blocks.push({ kind: 'list', items: form.checks.map((c) => `${c.ok ? 'Concordant' : 'À vérifier'} : ${c.label}${c.message ? `. ${c.message}` : ''}`) })
  }
  if (form.warnings.length > 0) blocks.push({ kind: 'list', items: form.warnings })
  if (toReview.length === 0 && form.checks.length === 0 && form.warnings.length === 0) return blocks
  return blocks
}

export function liasseDocument(view: LiasseView): GeneratedDocument {
  const fy = view.fiscalYear
  const blocks: Block[] = [
    { kind: 'paragraph', text: view.filing },
    {
      kind: 'table',
      columns: ['Tableau', 'Intitulé', 'Où le trouver'],
      rows: view.tables.map((t) => [t.number, t.title, t.status === 'here' ? 'Ce document' : t.status === 'page' ? `Kledg${t.note ? ` : ${t.note}` : ''}` : (t.note ?? 'À remplir à la main')]),
    },
    ...(view.warnings.length > 0 ? [{ kind: 'list' as const, items: view.warnings }] : []),
    ...view.forms.flatMap(formBlocks),
    { kind: 'note', text: `Montants lus dans les écritures validées de l'exercice (écriture de clôture exclue) et les fiches de la société. Sources : ${view.sources.map((s) => s.label).join(' ; ')}.` },
  ]
  return {
    header: [view.company.name, `SIREN ${view.company.siren.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')}`],
    title: 'Liasse fiscale',
    subtitle: `Exercice du ${fy.startDate.split('-').reverse().join('/')} au ${fy.endDate.split('-').reverse().join('/')}`,
    blocks,
    footer: `${view.company.name}, liasse fiscale ${fy.year}`,
    fileName: `Liasse_fiscale_${fy.year}`,
  }
}

/** One CSV row per cell: form, frame, line, column, box, value, origin, note. */
export function liasseCsv(view: LiasseView): string {
  const rows: Array<Array<string | number | null>> = [['Formulaire', 'Cadre', 'Ligne', 'Colonne', 'Case', 'Valeur', 'Origine', 'Comptes', 'Remarque']]
  for (const form of view.forms) {
    for (const section of form.sections) {
      for (const row of section.rows) {
        for (const c of row.cells) {
          const note = [c.note, c.pending?.length ? `Sans les cases à remplir : ${c.pending.join(', ')}` : null, c.hint ? `Repère : ${valueText(c.hint)}` : null].filter(Boolean).join(' ')
          rows.push([form.number, section.title, row.label, section.columns ? c.label : '', c.box ?? '', csvValue(c.value), SOURCE_LABELS[c.source], (c.accounts ?? []).join(' '), note])
        }
      }
    }
  }
  return buildCsv(rows)
}
