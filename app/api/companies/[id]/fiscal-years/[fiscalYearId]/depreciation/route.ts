import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { ownedFiscalYear } from '@/lib/accounting/manage-fiscal-years.service'
import { findUnpostedDepreciation, generateDepreciationEntries } from '@/lib/fixed-assets/depreciation-entries'
import { writeAuditLog } from '@/lib/audit'
import { fromCents } from '@/lib/utils/money'

/** GET: depreciation allowances of the fiscal year that have no accounting entry yet. */
export const GET = companyRoute(
  { company: fromParam('id'), permission: { reports: ['read'] } },
  async ({ params, companyId }) => {
    const fiscalYear = await ownedFiscalYear(companyId, params.fiscalYearId as string)
    const items = await findUnpostedDepreciation(companyId, fiscalYear.id)
    return NextResponse.json(
      {
        count: items.length,
        amount: fromCents(items.reduce((sum, item) => sum + item.amountCents, 0)),
        items: items.map((item) => ({
          fixedAssetId: item.fixedAssetId,
          label: item.label,
          amount: fromCents(item.amountCents),
          expenseAccount: item.expenseAccount.code,
          depreciationAccount: item.depreciationAccount.code,
        })),
      },
      { headers: NO_CACHE_HEADERS },
    )
  },
)

/**
 * POST: books the missing depreciation entries of the fiscal year
 * ("Générer les dotations"): one validated OD entry per asset, 6811 / 28xx,
 * on the last day of the year. Idempotent; 409 on a closed year.
 */
export const POST = companyRoute(
  { company: fromParam('id'), permission: { entries: ['create', 'validate'] } },
  async ({ params, companyId }) => {
    const fiscalYear = await ownedFiscalYear(companyId, params.fiscalYearId as string)
    const result = await generateDepreciationEntries(companyId, fiscalYear.id)
    if (result.count > 0) {
      await writeAuditLog('info', `Depreciation entries booked for ${fiscalYear.year}`, {
        action: 'GENERATE_DEPRECIATION_ENTRIES',
        companyId,
        metadata: { fiscalYearId: fiscalYear.id, count: result.count, totalCents: result.totalCents },
      })
    }
    return NextResponse.json({ count: result.count, amount: fromCents(result.totalCents) })
  },
)
