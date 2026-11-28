/**
 * Configuration of the receipt email address (docs/justificatifs-email.md),
 * from the environment. The address of a company is
 * <token>@KLEDG_RECEIPTS_EMAIL_DOMAIN; an inbound email provider receives
 * the mail of that domain (its MX records) and posts it to
 * /api/inbound-email/<provider>, which checks it came from the provider:
 * - resend: RESEND_INBOUND_WEBHOOK_SECRET (the webhook's signing secret,
 *   whsec_...) and RESEND_API_KEY to download the attachments;
 * - postmark: POSTMARK_INBOUND_PASSWORD, the password of the basic
 *   authentication put in the webhook URL (Postmark does not sign);
 * - mailgun: MAILGUN_WEBHOOK_SIGNING_KEY.
 * Without the domain, or without any provider, the feature is off.
 */

export type InboundProvider = 'resend' | 'postmark' | 'mailgun'

export const INBOUND_PROVIDERS: readonly InboundProvider[] = ['resend', 'postmark', 'mailgun']

export function isInboundProvider(value: string): value is InboundProvider {
  return (INBOUND_PROVIDERS as readonly string[]).includes(value)
}

const env = (name: string): string | null => process.env[name]?.trim() || null

/** The domain of the receipt addresses, lower case, or null when the feature is off. */
export function receiptEmailDomain(): string | null {
  const domain = env('KLEDG_RECEIPTS_EMAIL_DOMAIN')?.toLowerCase().replace(/^@/, '') ?? null
  return domain && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null
}

export interface ProviderSecrets {
  resend: { webhookSecret: string; apiKey: string } | null
  postmark: { password: string } | null
  mailgun: { signingKey: string } | null
}

export function providerSecrets(): ProviderSecrets {
  const resendSecret = env('RESEND_INBOUND_WEBHOOK_SECRET')
  const resendKey = env('RESEND_API_KEY')
  const postmark = env('POSTMARK_INBOUND_PASSWORD')
  const mailgun = env('MAILGUN_WEBHOOK_SIGNING_KEY')
  return {
    resend: resendSecret && resendKey ? { webhookSecret: resendSecret, apiKey: resendKey } : null,
    postmark: postmark ? { password: postmark } : null,
    mailgun: mailgun ? { signingKey: mailgun } : null,
  }
}

/** The receipt address is offered when its domain and at least one provider are configured. */
export function receiptEmailEnabled(): boolean {
  if (!receiptEmailDomain()) return false
  const secrets = providerSecrets()
  return Boolean(secrets.resend || secrets.postmark || secrets.mailgun)
}
