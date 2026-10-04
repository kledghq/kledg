import { NextResponse } from 'next/server'
import { authedRoute } from '@/lib/api/route'
import { assertSameOrigin } from '@/lib/api/same-origin'
import { writeAuditLog } from '@/lib/audit'
import { requestEmailChange } from '@/lib/account/change-email.service'
import { ChangeEmailSchema } from '@/lib/account/schemas'

/**
 * Starts an email change of the signed-in user: a confirmation link goes to
 * the new address (or, for an instance administrator on an instance without
 * emails, the address changes at once). The current password is required.
 */
export const POST = authedRoute({ body: ChangeEmailSchema }, async ({ request, user, body }) => {
  assertSameOrigin(request)
  const result = await requestEmailChange(user, request.headers, body)
  await writeAuditLog('info', result.status === 'updated' ? 'Account email changed by its administrator' : 'Account email change requested', {
    action: result.status === 'updated' ? 'CHANGE_EMAIL' : 'REQUEST_EMAIL_CHANGE',
    metadata: { userId: user.id },
  })
  return NextResponse.json(result)
})
