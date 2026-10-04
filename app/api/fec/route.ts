import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { downloadResponse } from '@/lib/api/download'
import { enforceRateLimit } from '@/lib/rate-limit'
import { exportFecOfYear, fecComplianceReport } from '@/lib/fec/export-fec.service'
import { FecQuerySchema } from '@/lib/reports/report-query'

/**
 * FEC of a fiscal year (LPF art. A47 A-1): ?companyId=...&fiscalYearId=...
 * (the current fiscal year by default).
 * The file is named SirenFECAAAAMMJJ.txt (closing date). With &report=1 the
 * route returns the compliance report of the file (JSON) instead of the file.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['export'] }, query: FecQuerySchema },
  async ({ companyId, query, user }) => {
    await enforceRateLimit('export', user.id)
    const fec = await exportFecOfYear(companyId, query.fiscalYearId)
    if (query.report) return NextResponse.json(fecComplianceReport(fec))
    return downloadResponse(
      { content: fec.content, fileName: fec.fileName, contentType: 'text/plain; charset=utf-8' },
      { 'Cache-Control': 'private, no-store' },
    )
  },
)
