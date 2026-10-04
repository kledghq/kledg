/**
 * Generates one document of the approval pack as a file: PDF to print and
 * sign, or Markdown to edit first. The document must be part of the pack
 * for this company and fiscal year (404 otherwise) and nothing it needs may
 * be missing: a 400 lists what to fill in, so no value is ever guessed.
 * Exported with reports:export, rate limited like every generated file.
 */

import { renderToStream } from '@react-pdf/renderer'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { PDF_CONTENT_TYPE, type GeneratedFile } from '@/lib/api/download'
import { getApproval } from './get-approval.service'
import { buildDocument } from './documents/build'
import { renderMarkdown } from './documents/markdown'
import { ApprovalDocumentPdf } from './documents/pdf'
import type { DocumentId } from './pack'
import type { DocumentFormat } from './schemas'

export const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8'

async function renderPdf(document: Parameters<typeof renderToStream>[0]): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  for await (const chunk of await renderToStream(document)) {
    chunks.push(chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks)
}

export async function exportApprovalDocument(
  companyId: string,
  fiscalYearId: string,
  documentId: DocumentId,
  format: DocumentFormat,
  now?: Date,
): Promise<GeneratedFile> {
  const view = await getApproval(companyId, fiscalYearId, now)
  if (view.pack.unsupported) throw new ValidationError(view.pack.unsupported)
  const entry = view.pack.documents.find((d) => d.id === documentId)
  if (!entry) throw new NotFoundError("Ce document ne fait pas partie de l'approbation des comptes de cette société.")
  if (entry.missing.length > 0) {
    throw new ValidationError(`Complétez d'abord : ${entry.missing.join(' ; ')}.`).withDetails({ missing: entry.missing })
  }
  const doc = buildDocument(documentId, { context: view.context, details: view.details, pack: view.pack })
  if (format === 'md') {
    return { content: renderMarkdown(doc), fileName: `${doc.fileName}.md`, contentType: MARKDOWN_CONTENT_TYPE }
  }
  return { content: await renderPdf(<ApprovalDocumentPdf doc={doc} />), fileName: `${doc.fileName}.pdf`, contentType: PDF_CONTENT_TYPE }
}
