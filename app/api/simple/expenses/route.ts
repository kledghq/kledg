import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { ExpensesToReviewQuerySchema, listExpensesToReview } from '@/lib/simple/expenses-to-review.service'

/**
 * GET /api/simple/expenses?companyId=&side=&limit=
 * "Dépenses à vérifier" of simple mode: the transactions not reconciled
 * yet, with the category Kledg proposes, its confidence and reason
 * (docs/categories-simples.md).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { banking: ['read'] }, query: ExpensesToReviewQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await listExpensesToReview(companyId, query), { headers: NO_CACHE_HEADERS }),
)
