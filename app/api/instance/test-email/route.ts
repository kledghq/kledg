import { adminRoute, NextResponse } from '@/lib/api/route'
import { ValidationError } from '@/lib/accounting/errors'
import { enforceRateLimit } from '@/lib/rate-limit'
import { isEmailEnabled, sendEmail } from '@/lib/email'
import { testEmail } from '@/lib/email/templates'
import { getAppUrl } from '@/lib/config'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const NOT_CONFIGURED =
  "Cette instance n'envoie pas d'emails : définissez RESEND_API_KEY (et EMAIL_FROM), puis redéployez."
const FAILED =
  "Resend a refusé l'envoi. Tant que votre domaine n'est pas vérifié, Resend n'écrit qu'à l'adresse de votre compte Resend, depuis son expéditeur de test : vérifiez le domaine, puis EMAIL_FROM."

/**
 * Sends a test email to the administrator asking for it, from the
 * Configuration page: proves RESEND_API_KEY and EMAIL_FROM work end to end.
 * Only to the caller's own address, and rate limited.
 */
export const POST = adminRoute({}, async ({ user }) => {
  await enforceRateLimit('test-email', user.id)
  if (!(await isEmailEnabled())) throw new ValidationError(NOT_CONFIGURED)
  try {
    await sendEmail(testEmail(user.email, `${getAppUrl()}/settings/configuration`))
  } catch (error) {
    logger.warn('Test email failed', error)
    throw new ValidationError(FAILED)
  }
  return NextResponse.json({ sentTo: user.email })
})
