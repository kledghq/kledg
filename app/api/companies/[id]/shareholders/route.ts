import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import {
  createShareholder,
  CreateShareholderSchema,
  listShareholders,
} from '@/lib/companies/manage-shareholders.service'

/** GET /api/companies/[id]/shareholders: the capital table, oldest shareholder first. */
export const GET = companyRoute(
  { company: fromParam('id'), permission: { settings: ['read'] } },
  async ({ companyId }) => NextResponse.json(await listShareholders(companyId)),
)

/** POST /api/companies/[id]/shareholders: adds a shareholder (percentages stay within 100 %). 201. */
export const POST = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, body: CreateShareholderSchema },
  async ({ companyId, body, user }) => NextResponse.json(await createShareholder(companyId, body, user), { status: 201 }),
)
