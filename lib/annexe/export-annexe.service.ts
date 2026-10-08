/**
 * Generates the annexe of a fiscal year as a file: PDF to sign and file
 * with the accounts, or Markdown to edit first. A 400 lists what the user
 * must still answer, so nothing is ever guessed. Exported with
 * reports:export, rate limited like every generated file; the same file is
 * offered by the approval pack (document "annexe").
 */

import { ValidationError } from '@/lib/accounting/errors'
import { PDF_CONTENT_TYPE, type GeneratedFile } from '@/lib/api/download'
import { renderMarkdown } from '@/lib/approval/documents/markdown'
import { renderDocumentPdf } from '@/lib/approval/documents/render'
import type { GroupAccess } from '@/lib/management-fees/access'
import { annexeDocument } from './annexe-document'
import { getAnnexe } from './get-annexe.service'

export const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8'

export async function exportAnnexe(companyId: string, fiscalYearId: string, format: 'pdf' | 'md', access: GroupAccess | null, now?: Date): Promise<GeneratedFile> {
  const view = await getAnnexe(companyId, fiscalYearId, access, now)
  const missing = view.annexe.missing.map((m) => m.label)
  if (missing.length > 0) throw new ValidationError(`Complétez d'abord : ${missing.join(' ; ')}.`).withDetails({ missing })
  const doc = annexeDocument(view.annexe, view.company, view.fiscalYear)
  if (format === 'md') return { content: renderMarkdown(doc), fileName: `${doc.fileName}.md`, contentType: MARKDOWN_CONTENT_TYPE }
  return { content: await renderDocumentPdf(doc), fileName: `${doc.fileName}.pdf`, contentType: PDF_CONTENT_TYPE }
}
