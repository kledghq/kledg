/**
 * Exports the fixed asset report of a fiscal year (forms 2054-SD, 2055-SD
 * and 2033-C-SD) as a PDF to print or a CSV to copy into the liasse.
 * Exported with reports:export, rate limited like every generated file.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { PDF_CONTENT_TYPE, type GeneratedFile } from '@/lib/api/download'
import { renderDocumentPdf } from '@/lib/approval/documents/render'
import { fixedAssetCsv, fixedAssetDocument } from './fixed-asset-document'
import { getFixedAssetMovements } from './get-fixed-asset-movements.service'

export const FixedAssetExportQuerySchema = z.object({
  fiscalYearId: z.string({ error: "L'exercice est requis" }).min(1, "L'exercice est requis").max(64),
  format: z.enum(['pdf', 'csv'], { error: 'Format attendu : pdf ou csv' }).optional().default('pdf'),
})
export type FixedAssetExportQuery = z.infer<typeof FixedAssetExportQuerySchema>

export async function exportFixedAssetMovements(companyId: string, query: FixedAssetExportQuery): Promise<GeneratedFile> {
  const report = await getFixedAssetMovements(companyId, query.fiscalYearId)
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, siren: true } })
  const doc = fixedAssetDocument(report, company)
  if (query.format === 'csv') return { content: `﻿${fixedAssetCsv(report)}`, fileName: `${doc.fileName}.csv`, contentType: 'text/csv; charset=utf-8' }
  return { content: await renderDocumentPdf(doc), fileName: `${doc.fileName}.pdf`, contentType: PDF_CONTENT_TYPE }
}
