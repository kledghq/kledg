/**
 * The receipt email address, without a database: the proof that a request
 * comes from its provider (Svix for Resend, HMAC for Mailgun, basic
 * authentication for Postmark), refused when old, forged or missing; each
 * provider's post read into one email (recipients, attachments, inline
 * images left out); the token of an address of this instance.
 */

import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { readMailgunEmail, readPostmarkEmail, readResendEmail, NotAnEmail } from '../adapters'
import { inboxTokenOf, newInboxToken } from '../address'
import { verifyBasicPassword, verifyMailgun, verifySvix } from '../signatures'

const NOW = new Date('2026-11-28T10:00:00Z')
const SECONDS = String(Math.floor(NOW.getTime() / 1000))
const SECRET = `whsec_${Buffer.from('a resend signing secret!').toString('base64')}`

function svixSignature(id: string, timestamp: string, body: string, secret = SECRET) {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
}

describe('proofs of the provider', () => {
  const body = '{"type":"email.received"}'

  it('accepts a Svix signature among several, and refuses a changed body, another secret or an old request', () => {
    const signature = `v1,bm90IGl0 v1,${svixSignature('msg_1', SECONDS, body)}`
    expect(verifySvix(body, { id: 'msg_1', timestamp: SECONDS, signature }, SECRET, NOW)).toBe(true)
    expect(verifySvix(`${body} `, { id: 'msg_1', timestamp: SECONDS, signature }, SECRET, NOW)).toBe(false)
    const other = `whsec_${Buffer.from('another secret').toString('base64')}`
    expect(verifySvix(body, { id: 'msg_1', timestamp: SECONDS, signature: `v1,${svixSignature('msg_1', SECONDS, body, other)}` }, SECRET, NOW)).toBe(false)
    const old = String(Number(SECONDS) - 6 * 60)
    expect(verifySvix(body, { id: 'msg_1', timestamp: old, signature: `v1,${svixSignature('msg_1', old, body)}` }, SECRET, NOW)).toBe(false)
    expect(verifySvix(body, { id: null, timestamp: SECONDS, signature }, SECRET, NOW)).toBe(false)
  })

  it('checks the Mailgun HMAC of timestamp and token', () => {
    const key = 'key-mailgun-signing'
    const signature = createHmac('sha256', key).update(`${SECONDS}abc123`).digest('hex')
    expect(verifyMailgun({ timestamp: SECONDS, token: 'abc123', signature }, key, NOW)).toBe(true)
    expect(verifyMailgun({ timestamp: SECONDS, token: 'abc124', signature }, key, NOW)).toBe(false)
    expect(verifyMailgun({ timestamp: '1000', token: 'abc123', signature: createHmac('sha256', key).update('1000abc123').digest('hex') }, key, NOW)).toBe(false)
  })

  it('checks the password of the Postmark basic authentication, whatever the user name', () => {
    const header = (credentials: string) => `Basic ${Buffer.from(credentials).toString('base64')}`
    expect(verifyBasicPassword(header('kledg:s3cret-long-password'), 's3cret-long-password')).toBe(true)
    expect(verifyBasicPassword(header('kledg:wrong'), 's3cret-long-password')).toBe(false)
    expect(verifyBasicPassword(null, 's3cret-long-password')).toBe(false)
    expect(verifyBasicPassword('Bearer s3cret-long-password', 's3cret-long-password')).toBe(false)
  })
})

describe('addresses', () => {
  it('reads the token of an address of this domain, plus addressing included', () => {
    const token = newInboxToken()
    expect(token).toMatch(/^[a-z0-9]{16}$/)
    expect(inboxTokenOf(`${token}@justificatifs.example.fr`, 'justificatifs.example.fr')).toBe(token)
    expect(inboxTokenOf(`${token.toUpperCase()}+ovh@Justificatifs.Example.fr`, 'justificatifs.example.fr')).toBe(token)
    expect(inboxTokenOf(`${token}@other.example.fr`, 'justificatifs.example.fr')).toBeNull()
    expect(inboxTokenOf('compta@justificatifs.example.fr', 'justificatifs.example.fr')).toBeNull()
  })
})

describe('provider posts', () => {
  const pdf = Buffer.from('%PDF-1.4 facture')

  it('reads a Postmark message: every recipient, attachments decoded, a signature logo left out', async () => {
    const email = readPostmarkEmail({
      MessageID: 'pm-1',
      FromFull: { Email: 'Factures@OVH.com', Name: 'OVH' },
      ToFull: [{ Email: 'compta@atelier.fr' }],
      CcFull: [],
      BccFull: [{ Email: 'TOKEN@justificatifs.example.fr' }],
      OriginalRecipient: 'token@justificatifs.example.fr',
      Subject: 'Votre facture',
      Attachments: [
        { Name: 'facture.pdf', Content: pdf.toString('base64'), ContentType: 'application/pdf', ContentLength: pdf.length },
        { Name: 'logo.png', Content: 'iVBORw0KGgo=', ContentType: 'image/png', ContentLength: 8, ContentID: 'logo@ovh' },
      ],
    })
    expect(email).toMatchObject({ messageId: 'pm-1', from: 'factures@ovh.com', recipients: ['compta@atelier.fr', 'token@justificatifs.example.fr'], subject: 'Votre facture' })
    expect(email.attachments.map((a) => [a.fileName, a.inline])).toEqual([
      ['facture.pdf', false],
      ['logo.png', true],
    ])
    expect(Buffer.from(await email.attachments[0].load()).toString()).toBe('%PDF-1.4 facture')
    expect(() => readPostmarkEmail({ Attachments: 'nope' })).toThrow(NotAnEmail)
  })

  it('reads a Mailgun form: its recipient, attachment-1..N, inline ones from the content-id map', async () => {
    const form = new FormData()
    form.set('recipient', 'token@justificatifs.example.fr')
    form.set('from', 'OVH <factures@ovh.com>')
    form.set('subject', 'Votre facture')
    form.set('Message-Id', '<mg-1@ovh.com>')
    form.set('attachment-count', '2')
    form.set('attachment-1', new File([pdf], 'facture.pdf', { type: 'application/pdf' }))
    form.set('attachment-2', new File([new Uint8Array([0x89, 0x50])], 'logo.png', { type: 'image/png' }))
    form.set('content-id-map', JSON.stringify({ '<logo@ovh>': 'attachment-2' }))
    const email = readMailgunEmail(form)
    expect(email).toMatchObject({ from: 'factures@ovh.com', recipients: ['token@justificatifs.example.fr'], messageId: '<mg-1@ovh.com>' })
    expect(email.attachments.map((a) => [a.fileName, a.inline, a.size])).toEqual([
      ['facture.pdf', false, pdf.length],
      ['logo.png', true, 2],
    ])
  })

  it('reads a Resend event, then lists and downloads its attachments through the API', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'https://api.resend.com/emails/receiving/em_1/attachments?limit=100') {
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer re_key')
        return Response.json({ object: 'list', has_more: false, data: [{ id: 'a1', filename: 'facture.pdf', content_type: 'application/pdf', content_disposition: 'attachment', size: pdf.length, download_url: 'https://cdn.resend.com/a1?sig=x' }] })
      }
      if (url.startsWith('https://cdn.resend.com/a1')) {
        // A signed URL: never the API key
        expect(init?.headers).toBeUndefined()
        return new Response(pdf)
      }
      return new Response(null, { status: 404 })
    })
    const email = await readResendEmail(
      { type: 'email.received', data: { email_id: 'em_1', from: 'factures@ovh.com', to: ['token@justificatifs.example.fr'], received_for: [], subject: 'Votre facture', message_id: '<r-1@ovh.com>' } },
      're_key',
      fetchMock as unknown as typeof fetch,
    )
    expect(email.recipients).toEqual(['token@justificatifs.example.fr'])
    expect(Buffer.from(await email.attachments[0].load()).toString()).toBe('%PDF-1.4 facture')
    await expect(readResendEmail({ type: 'email.sent', data: { email_id: 'em_2' } }, 're_key', fetchMock as unknown as typeof fetch)).rejects.toThrow(NotAnEmail)
  })
})
