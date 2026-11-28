/**
 * An inbound email as each provider posts it, read into one shape
 * (InboundEmail). The email is untrusted: only its recipients (to find the
 * company), its attachments (the receipts) and a few headers for the audit
 * log are read; its body and links are never used.
 *
 * - Resend posts an `email.received` event with metadata only: the
 *   attachments are listed and downloaded through its API
 *   (GET /emails/receiving/{id}/attachments, a download_url valid one hour)
 *   https://resend.com/docs/dashboard/receiving/attachments
 * - Postmark posts JSON with the attachments inline, in base64
 *   https://postmarkapp.com/developer/webhooks/inbound-webhook
 * - Mailgun forwards the parsed message as multipart/form-data: the files
 *   are attachment-1..attachment-N, inline ones listed in content-id-map
 *   https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http
 */

import { z } from 'zod'
import { RECEIPT_MAX_BYTES } from '../file-type'

export interface InboundAttachment {
  fileName: string
  contentType: string
  /** Shown in the body (a logo of a signature), not attached: never a receipt. */
  inline: boolean
  /** Declared size in bytes, when the provider gives it. */
  size: number | null
  load(): Promise<Uint8Array>
}

export interface InboundEmail {
  messageId: string | null
  from: string | null
  /** Every address the email was sent to (To, Cc, Bcc, the original recipient), lower case. */
  recipients: string[]
  subject: string | null
  attachments: InboundAttachment[]
}

/** A provider's answer that is not an email to read (another Resend event, for instance). */
export class NotAnEmail extends Error {}

const address = (value: string | null | undefined): string | null => {
  const match = value?.match(/<([^<>\s]+@[^<>\s]+)>/) ?? value?.match(/([^\s<>,;"]+@[^\s<>,;"]+)/)
  return match ? match[1].toLowerCase() : null
}
const addresses = (values: ReadonlyArray<string | null | undefined>): string[] => [...new Set(values.map(address).filter((a): a is string => a !== null))]
const textOf = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : null)

/** Reads a response body up to the receipt size limit: a larger file is not a receipt Kledg takes. */
async function boundedBytes(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'))
  if (declared > RECEIPT_MAX_BYTES) throw new Error('attachment too large')
  const buffer = new Uint8Array(await response.arrayBuffer())
  if (buffer.length > RECEIPT_MAX_BYTES) throw new Error('attachment too large')
  return buffer
}

// ---------------------------------------------------------------------------
// Resend

const ResendEvent = z.looseObject({
  type: z.string(),
  data: z.looseObject({
    email_id: z.string().min(1),
    from: z.string().nullish(),
    to: z.array(z.string()).nullish(),
    cc: z.array(z.string()).nullish(),
    bcc: z.array(z.string()).nullish(),
    received_for: z.array(z.string()).nullish(),
    subject: z.string().nullish(),
    message_id: z.string().nullish(),
  }),
})

const ResendAttachmentList = z.looseObject({
  data: z.array(
    z.looseObject({
      filename: z.string().nullish(),
      content_type: z.string().nullish(),
      content_disposition: z.string().nullish(),
      size: z.number().nullish(),
      download_url: z.string().url(),
    }),
  ),
})

const RESEND_API = 'https://api.resend.com'

export async function readResendEmail(body: unknown, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<InboundEmail> {
  const event = ResendEvent.safeParse(body)
  if (!event.success || event.data.type !== 'email.received') throw new NotAnEmail('not an email.received event')
  const { data } = event.data
  const email: InboundEmail = {
    messageId: textOf(data.message_id) ?? data.email_id,
    from: address(data.from),
    recipients: addresses([...(data.to ?? []), ...(data.cc ?? []), ...(data.bcc ?? []), ...(data.received_for ?? [])]),
    subject: textOf(data.subject),
    attachments: [],
  }
  const response = await fetchImpl(`${RESEND_API}/emails/receiving/${encodeURIComponent(data.email_id)}/attachments?limit=100`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Resend attachments: HTTP ${response.status}`)
  const list = ResendAttachmentList.parse(await response.json())
  email.attachments = list.data.map((item) => ({
    fileName: item.filename || 'justificatif',
    contentType: item.content_type || 'application/octet-stream',
    inline: item.content_disposition === 'inline',
    size: item.size ?? null,
    load: async () => {
      const url = new URL(item.download_url)
      if (url.protocol !== 'https:') throw new Error('attachment URL not https')
      // A signed URL: no credentials sent, no redirect followed
      return boundedBytes(await fetchImpl(url, { redirect: 'error' }))
    },
  }))
  return email
}

// ---------------------------------------------------------------------------
// Postmark

const PostmarkAddress = z.looseObject({ Email: z.string() })
const PostmarkEmail = z.looseObject({
  MessageID: z.string().nullish(),
  From: z.string().nullish(),
  FromFull: PostmarkAddress.nullish(),
  ToFull: z.array(PostmarkAddress).nullish(),
  CcFull: z.array(PostmarkAddress).nullish(),
  BccFull: z.array(PostmarkAddress).nullish(),
  OriginalRecipient: z.string().nullish(),
  Subject: z.string().nullish(),
  Attachments: z
    .array(
      z.looseObject({
        Name: z.string().nullish(),
        Content: z.string(),
        ContentType: z.string().nullish(),
        ContentLength: z.number().nullish(),
        ContentID: z.string().nullish(),
      }),
    )
    .nullish(),
})

export function readPostmarkEmail(body: unknown): InboundEmail {
  const parsed = PostmarkEmail.safeParse(body)
  if (!parsed.success) throw new NotAnEmail('not a Postmark inbound message')
  const m = parsed.data
  const emails = (list: Array<{ Email: string }> | null | undefined) => (list ?? []).map((a) => a.Email)
  return {
    messageId: textOf(m.MessageID),
    from: address(m.FromFull?.Email ?? m.From),
    recipients: addresses([...emails(m.ToFull), ...emails(m.CcFull), ...emails(m.BccFull), m.OriginalRecipient]),
    subject: textOf(m.Subject),
    attachments: (m.Attachments ?? []).map((a) => ({
      fileName: a.Name || 'justificatif',
      contentType: a.ContentType || 'application/octet-stream',
      // An image referenced from the body by its Content-ID: a logo, a signature
      inline: Boolean(a.ContentID) && (a.ContentType ?? '').startsWith('image/'),
      size: a.ContentLength ?? null,
      load: async () => {
        // base64 is 4/3 of the bytes: refuse before decoding what cannot fit
        if (a.Content.length > Math.ceil((RECEIPT_MAX_BYTES * 4) / 3) + 4) throw new Error('attachment too large')
        return new Uint8Array(Buffer.from(a.Content, 'base64'))
      },
    })),
  }
}

// ---------------------------------------------------------------------------
// Mailgun

/** Most attachments read from one Mailgun post (attachment-1..attachment-N). */
const MAX_FORM_ATTACHMENTS = 20

export function readMailgunEmail(form: FormData): InboundEmail {
  const field = (name: string) => {
    const value = form.get(name)
    return typeof value === 'string' ? value : null
  }
  const inlineFields = new Set<string>()
  try {
    const map = JSON.parse(field('content-id-map') ?? '{}') as Record<string, unknown>
    for (const value of Object.values(map)) if (typeof value === 'string') inlineFields.add(value)
  } catch {
    // No map, or an unreadable one: no attachment is taken for inline
  }
  const count = Math.min(Number(field('attachment-count') ?? 0) || 0, MAX_FORM_ATTACHMENTS)
  const attachments: InboundAttachment[] = []
  for (let n = 1; n <= count; n++) {
    const file = form.get(`attachment-${n}`)
    if (!file || typeof file === 'string') continue
    attachments.push({
      fileName: file.name || 'justificatif',
      contentType: file.type || 'application/octet-stream',
      inline: inlineFields.has(`attachment-${n}`),
      size: file.size,
      load: async () => {
        if (file.size > RECEIPT_MAX_BYTES) throw new Error('attachment too large')
        return new Uint8Array(await file.arrayBuffer())
      },
    })
  }
  return {
    messageId: textOf(field('Message-Id')),
    from: address(field('from') ?? field('sender')),
    recipients: addresses((field('recipient') ?? '').split(',')),
    subject: textOf(field('subject')),
    attachments,
  }
}
