import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromBody } from '@/lib/api/route'
import { enforceRateLimit } from '@/lib/rate-limit'
import { MailboxInputSchema, mailboxFolders } from '@/lib/receipts/mailbox/mailbox.service'

const FoldersBodySchema = MailboxInputSchema.pick({ host: true, username: true, password: true })

/**
 * POST /api/receipts/mailbox/folders { companyId, host, username, password? }
 * Signs in to the mailbox and lists its folders, to choose the one Kledg
 * reads. An empty password uses the stored one. Company settings.
 */
export const POST = companyRoute({ company: fromBody(), permission: { settings: ['update'] }, body: FoldersBodySchema }, async (ctx) => {
  await enforceRateLimit('mailbox-connect', ctx.companyId)
  return NextResponse.json(await mailboxFolders(ctx.companyId, ctx.body as z.output<typeof FoldersBodySchema>))
})
