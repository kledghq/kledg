/**
 * Transactional email through Resend.
 *
 * Without RESEND_API_KEY (local development), emails are printed to the server
 * log instead of being sent, so links such as password resets stay usable.
 * An instance whose policy refuses "send-email" (lib/instance) logs them too.
 */

import { Resend } from 'resend'
import { APP_NAME } from '@/lib/config'
import { logger } from '@/lib/logger'
import { isActionAllowed } from '@/lib/instance'

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
}

let client: Resend | null = null

async function getClient(): Promise<Resend | null> {
  if (!(await isEmailEnabled())) return null
  client ??= new Resend(process.env.RESEND_API_KEY)
  return client
}

export async function isEmailEnabled(): Promise<boolean> {
  return Boolean(process.env.RESEND_API_KEY) && (await isActionAllowed('send-email'))
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const resend = await getClient()
  if (!resend) {
    logger.info(`[email disabled] To: ${message.to} | ${message.subject}\n${message.text}`)
    return
  }

  const from = process.env.EMAIL_FROM || `${APP_NAME} <onboarding@resend.dev>`
  const { error } = await resend.emails.send({ from, ...message })
  if (error) {
    logger.error('Failed to send email:', error)
    throw new Error(`Email delivery failed: ${error.message}`)
  }
}
