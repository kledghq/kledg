import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { countCompanyTasks } from '@/lib/tasks/count-tasks.service'

/** GET /api/tasks/count?companyId= : pending tasks of the company (unreconciled bank transactions). */
export const GET = companyRoute(
  { company: fromQuery(), permission: { banking: ['read'] } },
  async ({ companyId }) => NextResponse.json(await countCompanyTasks(companyId)),
)
