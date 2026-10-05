/**
 * POST /api/instance/test-email, the "Envoyer un email de test" button of
 * Settings, Configuration:
 * - instance administrators only (401 signed out, 403 for other users),
 *   and cross-site requests are refused;
 * - the email goes to the caller's own address, never elsewhere;
 * - rate limited per administrator;
 * - without email delivery, or when Resend refuses, a French reason says
 *   what to configure, and nothing claims the email was sent.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string; name: null; role: string | null } }))
const mail = vi.hoisted(() => ({
  enabled: true,
  sendEmail: vi.fn(async (message: { to: string; subject: string }) => void message),
  enforceRateLimit: vi.fn(async () => {}),
}))

vi.mock('@/lib/session', () => ({ getCurrentUser: vi.fn(async () => session.user) }))
vi.mock('@/lib/email', () => ({ isEmailEnabled: vi.fn(async () => mail.enabled), sendEmail: mail.sendEmail }))
vi.mock('@/lib/rate-limit', async () => ({
  ...(await vi.importActual<typeof import('@/lib/rate-limit')>('@/lib/rate-limit')),
  enforceRateLimit: mail.enforceRateLimit,
}))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { RateLimitError } from '@/lib/accounting/errors'
import { POST } from '../instance/test-email/route'

const admin = { id: 'admin-1', email: 'admin@example.com', name: null, role: 'admin' }
const member = { id: 'user-1', email: 'user@example.com', name: null, role: null }

function request(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/instance/test-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: '{}',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mail.enabled = true
  session.user = admin
})

describe('POST /api/instance/test-email', () => {
  it('answers 401 signed out and 403 to a user who is not an instance administrator', async () => {
    session.user = null
    expect((await POST(request())).status).toBe(401)
    session.user = member
    expect((await POST(request())).status).toBe(403)
    expect(mail.sendEmail).not.toHaveBeenCalled()
  })

  it('refuses another origin and a cross-site fetch', async () => {
    expect((await POST(request({ origin: 'https://evil.example' }))).status).toBe(403)
    expect((await POST(request({ 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    expect(mail.sendEmail).not.toHaveBeenCalled()
  })

  it("sends the test email to the administrator's own address, within the rate limit", async () => {
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sentTo: 'admin@example.com' })
    expect(mail.enforceRateLimit).toHaveBeenCalledWith('test-email', 'admin-1')
    expect(mail.sendEmail).toHaveBeenCalledTimes(1)
    expect(mail.sendEmail.mock.calls[0]![0].to).toBe('admin@example.com')
  })

  it('says what to configure when the instance sends no email', async () => {
    mail.enabled = false
    const res = await POST(request())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/RESEND_API_KEY/)
    expect(mail.sendEmail).not.toHaveBeenCalled()
  })

  it("explains Resend's test sender when the delivery is refused", async () => {
    mail.sendEmail.mockRejectedValueOnce(new Error('You can only send testing emails to your own email address'))
    const res = await POST(request())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Resend a refusé l'envoi/)
  })

  it('stops at the rate limit', async () => {
    mail.enforceRateLimit.mockRejectedValueOnce(new RateLimitError("Trop d'emails de test en une heure. Réessayez plus tard."))
    const res = await POST(request())
    expect(res.status).toBe(429)
    expect(mail.sendEmail).not.toHaveBeenCalled()
  })
})
