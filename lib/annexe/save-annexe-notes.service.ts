/**
 * Saves what the user answered for the annexe of a fiscal year (one row per
 * fiscal year, annexe_notes). The details are validated by the route
 * (AnnexeDetailsSchema); the fiscal year must be the company's (404
 * otherwise). Written with closing:execute, audited. The annexe of a closed
 * year stays editable: it is written after the closing.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ownedFiscalYear } from '@/lib/accounting/manage-fiscal-years.service'
import { writeAuditLog } from '@/lib/audit'
import type { AnnexeDetails } from './schemas'

export async function saveAnnexeNotes(companyId: string, fiscalYearId: string, details: AnnexeDetails, userId: string): Promise<{ updatedAt: string }> {
  const fiscalYear = await ownedFiscalYear(companyId, fiscalYearId)
  const json = details as unknown as Prisma.InputJsonObject
  const row = await prisma.annexeNote.upsert({
    where: { fiscalYearId_companyId: { fiscalYearId: fiscalYear.id, companyId } },
    create: { companyId, fiscalYearId: fiscalYear.id, details: json, updatedById: userId },
    update: { details: json, updatedById: userId },
    select: { updatedAt: true },
  })
  await writeAuditLog('info', `Annexe de l'exercice ${fiscalYear.year} enregistrée`, {
    action: 'SAVE_ANNEXE_NOTES',
    companyId,
    metadata: { fiscalYearId: fiscalYear.id },
  })
  return { updatedAt: row.updatedAt.toISOString() }
}
