/**
 * The annexe written as a document (pure module): the notes in the order of
 * the balance sheet and the income statement (PCG art. 811-6), each with
 * its source, rendered as PDF or Markdown by the document renderer of the
 * approval pack (lib/approval/documents).
 */

import type { Block, GeneratedDocument } from '@/lib/approval/documents/model'
import type { Annexe } from './build-annexe'

const frDay = (iso: string) => iso.split('-').reverse().join('/')
const fileSafe = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'societe'

export function annexeTitle(annexe: Pick<Annexe, 'list'>): string {
  return annexe.list === 'micro' ? 'Informations à la suite du bilan' : 'Annexe des comptes annuels'
}

export function annexeDocument(annexe: Annexe, company: { name: string; siren: string }, fiscalYear: { year: number; startDate: string; endDate: string }): GeneratedDocument {
  const blocks: Block[] = []
  annexe.notes.forEach((note, i) => {
    blocks.push({ kind: 'heading', text: annexe.list === 'micro' ? note.title : `${i + 1}. ${note.title}` }, ...note.blocks, { kind: 'note', text: `Source : ${note.source}.` })
  })
  blocks.push({
    kind: 'note',
    text: `${annexe.listLabel} (${annexe.listSource}). Montants en euros, lus dans les écritures validées de l'exercice ; les informations que les comptes ne contiennent pas ont été saisies par la société.`,
  })
  return {
    header: [company.name, `SIREN ${company.siren.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')}`],
    title: annexeTitle(annexe),
    subtitle: `Exercice du ${frDay(fiscalYear.startDate)} au ${frDay(fiscalYear.endDate)}`,
    blocks,
    footer: `${company.name}, ${annexeTitle(annexe).toLowerCase()} ${fiscalYear.year}`,
    fileName: `Annexe_${fileSafe(company.name)}_${fiscalYear.year}`,
  }
}
