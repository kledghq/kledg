import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromParam } from '@/lib/api/route'
import { writeAuditLog } from '@/lib/audit'
import { getOpeningTarget, postOpeningBalances } from '@/lib/accounting/opening-balance/post-opening-balances.service'

/** Where the opening balances go (first fiscal year) and whether they are booked already. */
export const GET = companyRoute(
  { company: fromParam('id'), permission: { entries: ['read'] } },
  async ({ companyId }) => NextResponse.json({ target: await getOpeningTarget(companyId) }),
)

const MAX_CENTS = 100_000_000_000_00 // 100 billion euros: far above any small company balance

const Body = z.object({
  lines: z
    .array(
      z.object({
        accountCode: z.string().trim().min(1).max(20),
        debitCents: z.number().int().min(0).max(MAX_CENTS),
        creditCents: z.number().int().min(0).max(MAX_CENTS),
      }),
    )
    .min(2)
    .max(200),
  validate: z.boolean().default(false),
})

/**
 * Books the opening balances (lib/accounting/opening-balance): a draft
 * entry in the AN journal, or a validated one when `validate` is true (which
 * also needs the right to validate entries).
 */
export const POST = companyRoute(
  { company: fromParam('id'), permission: { entries: ['create'] }, body: Body },
  async ({ companyId, body, authorize }) => {
    if (body.validate) authorize({ entries: ['validate'] })
    const entry = await postOpeningBalances({ companyId, lines: body.lines, validate: body.validate })
    await writeAuditLog('info', 'Opening balances booked', {
      action: 'CREATE_OPENING_BALANCES',
      companyId,
      metadata: { entryId: entry.id, status: entry.status, lines: body.lines.length },
    })
    return NextResponse.json(entry, { status: 201 })
  },
)
