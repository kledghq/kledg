import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromParam } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { ownedFiscalYear } from '@/lib/accounting/manage-fiscal-years.service'
import { fromCents, parseCents } from '@/lib/utils/money'
import { allocateResult, previewResultAllocation } from '@/lib/accounting/result-allocation/allocate-result.service'
import type { AllocationPlan } from '@/lib/accounting/result-allocation/compute'

/** An amount in euros (number or decimal string, empty for 0) as cents, never negative. */
const euroCents = z
  .union([z.number(), z.string()], { error: 'Montant attendu' })
  .nullish()
  .transform((value, ctx) => {
    const cents = parseCents(value === undefined || value === null || value === '' ? 0 : value)
    if (cents === null || cents < 0) {
      ctx.addIssue({ code: 'custom', message: 'montant invalide (positif, deux décimales au plus)' })
      return z.NEVER
    }
    return cents
  })

const AllocationQuery = z.object({ dividends: euroCents, otherReserves: euroCents })

const AllocationBody = z.object({
  date: z.string({ error: "Date de l'assemblée obligatoire (AAAA-MM-JJ)" }),
  dividends: euroCents,
  otherReserves: euroCents,
})

const toEuros = (plan: AllocationPlan) => ({
  result: fromCents(plan.resultCents),
  legalReserveRequired: plan.legalReserveRequired,
  legalReserve: fromCents(plan.legalReserveCents),
  distributable: fromCents(plan.distributableCents),
  dividends: fromCents(plan.dividendsCents),
  otherReserves: fromCents(plan.otherReservesCents),
  priorLossesCleared: fromCents(plan.priorLossesClearedCents),
  retainedEarnings: fromCents(plan.retainedEarningsCents),
  lines: plan.lines.map((l) => ({ code: l.code, debit: fromCents(l.debitCents), credit: fromCents(l.creditCents) })),
  errors: plan.errors,
})

/** GET ?dividends=&otherReserves=: the allocation of the previous result that would be booked. */
export const GET = companyRoute(
  { company: fromParam('id'), permission: { reports: ['read'] }, query: AllocationQuery },
  async ({ params, companyId, query }) => {
    const fiscalYear = await ownedFiscalYear(companyId, params.fiscalYearId as string)
    const preview = await previewResultAllocation(companyId, fiscalYear.id, {
      dividendsCents: query.dividends,
      otherReservesCents: query.otherReserves,
    })
    return NextResponse.json(
      {
        fiscalYear: preview.fiscalYear,
        balances: {
          result: fromCents(preview.balances.resultCents),
          legalReserve: fromCents(preview.balances.legalReserveCents),
          capital: fromCents(preview.balances.capitalCents),
          retainedEarnings: fromCents(preview.balances.retainedEarningsCents),
          priorLosses: fromCents(preview.balances.priorLossesCents),
        },
        plan: toEuros(preview.plan),
      },
      { headers: NO_CACHE_HEADERS },
    )
  },
)

/**
 * POST { date, dividends, otherReserves }: books the allocation voted by the
 * shareholders (one validated OD entry). 409 when the result is already
 * allocated.
 */
export const POST = companyRoute(
  { company: fromParam('id'), permission: { closing: ['execute'] }, body: AllocationBody },
  async ({ params, companyId, user, body }) => {
    const fiscalYear = await ownedFiscalYear(companyId, params.fiscalYearId as string)
    const result = await allocateResult(companyId, fiscalYear.id, {
      date: body.date,
      dividendsCents: body.dividends,
      otherReservesCents: body.otherReserves,
      userId: user.id,
    })
    return NextResponse.json({ entryId: result.entryId, entryNumber: result.entryNumber, plan: toEuros(result.plan) })
  },
)
