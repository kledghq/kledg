import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery, fromQueryOrBody } from '@/lib/api/route'
import { MailboxInputSchema, deleteMailbox, mailboxOf, saveMailbox } from '@/lib/receipts/mailbox/mailbox.service'

/**
 * GET /api/receipts/mailbox?companyId=
 * The company's receipt mailbox (docs/justificatifs-email.md#boîte-e-mail):
 * server, user name, folder, mode, last reading. Never the password.
 */
export const GET = companyRoute({ company: fromQuery(), permission: { banking: ['reconcile'] } }, async (ctx) => NextResponse.json(await mailboxOf(ctx.companyId)))

/**
 * PUT /api/receipts/mailbox { companyId, host, username, password?, folder, mode, moveTo? }
 * Connects the mailbox, or changes it, once Kledg could sign in and found
 * the folder. An empty password keeps the stored one. Company settings.
 */
export const PUT = companyRoute({ company: fromBody(), permission: { settings: ['update'] }, body: MailboxInputSchema }, async (ctx) =>
  NextResponse.json(await saveMailbox(ctx.companyId, ctx.user.id, ctx.body)),
)

/** DELETE /api/receipts/mailbox?companyId= : Kledg stops reading the mailbox and forgets its password. */
export const DELETE = companyRoute({ company: fromQueryOrBody(), permission: { settings: ['update'] } }, async (ctx) => {
  await deleteMailbox(ctx.companyId, ctx.user.id)
  return NextResponse.json({ deleted: true })
})
