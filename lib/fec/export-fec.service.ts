/**
 * The FEC export as the Rapports page asks for it (LPF art. A47 A-1): the
 * file of a fiscal year, the current one by default, or the compliance
 * report of that file (lib/fec/validator.ts).
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { parisDayOf } from '@/lib/accounting/entry-date'
import { fiscalYearContaining } from '@/lib/accounting/entry-guards'
import { exportFec, type FecExport } from './export'
import { FEC_FILE_NAME } from './format'
import { validateFec, type FecValidationReport } from './validator'

/** The fiscal year containing today in France, else the latest one. */
async function defaultFecFiscalYearId(companyId: string, now = new Date()): Promise<string> {
  const fiscalYears = await prisma.fiscalYear.findMany({
    where: { companyId },
    select: { id: true, startDate: true, endDate: true },
    orderBy: { year: 'desc' },
  })
  const current = fiscalYearContaining(fiscalYears, parisDayOf(now)) ?? fiscalYears[0]
  if (!current) throw new NotFoundError("Aucun exercice : créez l'exercice avant d'exporter le FEC")
  return current.id
}

/** The FEC of the fiscal year (the current one when not given). */
export async function exportFecOfYear(companyId: string, fiscalYearId?: string): Promise<FecExport> {
  return exportFec(companyId, fiscalYearId ?? (await defaultFecFiscalYearId(companyId)))
}

/**
 * The compliance report of an exported FEC, with its counts. Drafts of the
 * year are not in the file: a warning says so, since the file is then not
 * the final book of the year.
 */
export function fecComplianceReport(fec: FecExport): FecValidationReport & Pick<FecExport, 'fileName' | 'entries' | 'lines' | 'drafts'> {
  const report = validateFec(fec.content, { fileName: fec.fileName, closingDate: FEC_FILE_NAME.exec(fec.fileName)?.[2] })
  if (fec.drafts > 0) {
    const drafts = fec.drafts === 1 ? '1 écriture en brouillon' : `${fec.drafts} écritures en brouillon`
    report.warnings.unshift({
      line: null,
      message: `${drafts} de l'exercice ne figure${fec.drafts === 1 ? '' : 'nt'} pas dans le fichier : validez-les ou supprimez-les avant de remettre le FEC.`,
    })
  }
  return { fileName: fec.fileName, entries: fec.entries, lines: fec.lines, drafts: fec.drafts, ...report }
}
