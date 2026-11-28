import { handleInboundEmail } from '@/lib/receipts/inbound/handle-webhook'

export const dynamic = 'force-dynamic'

/**
 * POST /api/inbound-email/{resend|postmark|mailgun}
 * An email sent to a company's receipt address, posted by the inbound email
 * provider (docs/justificatifs-email.md). No session: the provider's
 * signature (Resend, Mailgun) or basic authentication (Postmark) is checked
 * by the handler; proxy.ts lets the path through.
 */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  return handleInboundEmail((await params).provider, request)
}
