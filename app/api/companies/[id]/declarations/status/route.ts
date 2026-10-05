import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { ClearDeclarationQuerySchema, MarkDeclarationBodySchema, clearDeclaration, markDeclaration } from '@/lib/declarations/mark-declaration.service'
import { DECLARATIONS_WRITE } from '@/lib/declarations/permissions'

/**
 * PUT /api/companies/[id]/declarations/status { deadlineId, filedOn?, paidOn?, amountCents?, notDue?,
 * attachmentId?, attachmentReference?, note? }: marks a deadline of the calendar filed, paid or not due (only
 * the fields sent change; null clears one). Facts another module owns (VAT and IS filings, IS acomptes,
 * approval of the accounts) answer 409 with the page where they are recorded. Kledg never files nor pays.
 */
export const PUT = companyRoute(
  { company: fromParam(), permission: DECLARATIONS_WRITE, body: MarkDeclarationBodySchema },
  async ({ companyId, body, user }) => NextResponse.json(await markDeclaration(companyId, body, { userId: user.id })),
)

/** DELETE /api/companies/[id]/declarations/status?deadlineId=: removes what was recorded for the deadline. */
export const DELETE = companyRoute(
  { company: fromParam(), permission: DECLARATIONS_WRITE, query: ClearDeclarationQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await clearDeclaration(companyId, query.deadlineId)),
)
