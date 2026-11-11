/**
 * Exports the liasse fiscale of a fiscal year as a PDF to print or a CSV to
 * copy box by box into the professional space or to give to an EDI partner.
 * Exported with reports:export, rate limited like every generated file.
 */

import { z } from 'zod'
import { ConflictError } from '@/lib/accounting/errors'
import { PDF_CONTENT_TYPE, type GeneratedFile } from '@/lib/api/download'
import { renderDocumentPdf } from '@/lib/approval/documents/render'
import type { GroupAccess } from '@/lib/management-fees/access'
import { getLiasse } from './get-liasse.service'
import { liasseCsv, liasseDocument } from './liasse-document'

export const LiasseExportQuerySchema = z.object({
  fiscalYearId: z.string({ error: "L'exercice est requis" }).min(1, "L'exercice est requis").max(64),
  format: z.enum(['pdf', 'csv'], { error: 'Format attendu : pdf ou csv' }).optional().default('pdf'),
})
export type LiasseExportQuery = z.infer<typeof LiasseExportQuerySchema>

export async function exportLiasse(companyId: string, query: LiasseExportQuery, access: GroupAccess | null): Promise<GeneratedFile> {
  const view = await getLiasse(companyId, query.fiscalYearId, access)
  if (view.status !== 'ready') {
    throw new ConflictError(
      view.status === 'missing-regime'
        ? "Le régime d'impôt sur les sociétés n'est pas renseigné : choisissez-le dans Société, Informations pour préparer la liasse."
        : "La société n'est pas soumise à l'impôt sur les sociétés : Kledg ne prépare que la liasse des sociétés à l'IS.",
    )
  }
  const doc = liasseDocument(view)
  if (query.format === 'csv') return { content: `﻿${liasseCsv(view)}`, fileName: `${doc.fileName}.csv`, contentType: 'text/csv; charset=utf-8' }
  return { content: await renderDocumentPdf(doc), fileName: `${doc.fileName}.pdf`, contentType: PDF_CONTENT_TYPE }
}
