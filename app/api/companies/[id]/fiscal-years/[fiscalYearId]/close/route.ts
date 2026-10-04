import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { closeCompanyFiscalYear } from '@/lib/accounting/manage-fiscal-years.service'

export const maxDuration = 300

/**
 * POST: closes the fiscal year (closing entry, next year, à-nouveaux, lock),
 * in one transaction. A year already closed answers 409 and changes nothing;
 * a year that cannot be closed answers 400; both list the reasons in
 * `details`. The audit log is written inside the closing transaction.
 */
export const POST = companyRoute(
  { company: fromParam('id'), permission: { closing: ['execute'] } },
  async ({ params, companyId, user }) => {
    const result = await closeCompanyFiscalYear(companyId, params.fiscalYearId as string, user.id)
    return NextResponse.json({
      success: true,
      nextFiscalYearId: result.nextFiscalYearId,
      result: result.result,
      warnings: result.warnings ?? [],
      message: "Exercice clôturé : résultat porté au compte 12, écriture d'à-nouveaux passée sur l'exercice suivant.",
    })
  },
)
