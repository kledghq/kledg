/**
 * POST /api/inbound-email/[provider]: the webhook an inbound email provider
 * calls with an email sent to a receipt address (docs/justificatifs-email.md).
 * No session: the request is trusted only once it is proven to come from
 * the provider configured on this instance (signatures.ts), then read
 * (adapters.ts) and received (receive-email.service.ts).
 *
 * Answers:
 * - 404 when the feature or this provider is not configured (nothing to call);
 * - 401 when the proof is missing or wrong;
 * - 413 beyond MAX_BODY_BYTES;
 * - 200 once handled, also for an email to no receipt address or an event
 *   that is not an email: the provider would otherwise retry for nothing;
 * - 500 on a failure of Kledg: the provider retries, and staging the same
 *   files again changes nothing (one staging per content).
 */

import { AccountingError } from '@/lib/accounting/errors'
import { capRequestBody } from '@/lib/api/request-guards'
import { logger } from '@/lib/logger'
import { NotAnEmail, readMailgunEmail, readPostmarkEmail, readResendEmail, type InboundEmail } from './adapters'
import { isInboundProvider, providerSecrets, receiptEmailDomain, type InboundProvider } from './config'
import { receiveInboundEmail } from './receive-email.service'
import { verifyBasicPassword, verifyMailgun, verifySvix } from './signatures'

/** Postmark and Mailgun post the attachments with the email: ten of 5 MB in base64, and the body. */
const MAX_BODY_BYTES = 75 * 1024 * 1024

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

type Read = { ok: true; email: InboundEmail } | { ok: false; response: Response }

async function readRequest(provider: InboundProvider, request: Request, now: Date): Promise<Read> {
  const secrets = providerSecrets()
  const refused: Read = { ok: false, response: json(401, { error: 'Requête non authentifiée' }) }
  switch (provider) {
    case 'resend': {
      if (!secrets.resend) break
      const raw = await request.text()
      const headers = { id: request.headers.get('svix-id'), timestamp: request.headers.get('svix-timestamp'), signature: request.headers.get('svix-signature') }
      if (!verifySvix(raw, headers, secrets.resend.webhookSecret, now)) return refused
      return { ok: true, email: await readResendEmail(JSON.parse(raw), secrets.resend.apiKey) }
    }
    case 'postmark': {
      if (!secrets.postmark) break
      if (!verifyBasicPassword(request.headers.get('authorization'), secrets.postmark.password)) return refused
      return { ok: true, email: readPostmarkEmail(await request.json()) }
    }
    case 'mailgun': {
      if (!secrets.mailgun) break
      const form = await request.formData()
      const field = (name: string) => {
        const value = form.get(name)
        return typeof value === 'string' ? value : null
      }
      if (!verifyMailgun({ timestamp: field('timestamp'), token: field('token'), signature: field('signature') }, secrets.mailgun.signingKey, now)) return refused
      return { ok: true, email: readMailgunEmail(form) }
    }
  }
  return { ok: false, response: json(404, { error: 'Introuvable' }) }
}

export async function handleInboundEmail(providerName: string, request: Request, now: Date = new Date()): Promise<Response> {
  if (!isInboundProvider(providerName) || !receiptEmailDomain()) return json(404, { error: 'Introuvable' })
  try {
    const capped = await capRequestBody(request, MAX_BODY_BYTES)
    const read = await readRequest(providerName, capped, now)
    if (!read.ok) return read.response
    const outcome = await receiveInboundEmail(read.email, providerName)
    return json(200, outcome.outcome === 'no-company' ? { ignored: true } : { staged: outcome.staged, duplicates: outcome.duplicates, skipped: outcome.skipped })
  } catch (error) {
    if (error instanceof NotAnEmail || error instanceof SyntaxError) return json(200, { ignored: true })
    if (error instanceof AccountingError && error.statusCode === 413) return json(413, { error: error.message })
    logger.error('[Receipts] Inbound email failed', { provider: providerName, reason: (error as Error).message })
    return json(500, { error: 'Erreur interne' })
  }
}
