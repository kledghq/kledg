/**
 * Renders a generated document (model.ts) as a PDF file in memory, with the
 * document layout of pdf.tsx. Shared by the approval pack and the annexe
 * (lib/annexe), so every generated document looks the same.
 */

import React from 'react'
import { renderToStream } from '@react-pdf/renderer'
import type { GeneratedDocument } from './model'
import { ApprovalDocumentPdf } from './pdf'

export async function renderDocumentPdf(doc: GeneratedDocument): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  for await (const chunk of await renderToStream(<ApprovalDocumentPdf doc={doc} />)) {
    chunks.push(chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks)
}
