/**
 * Transactional email (lib/email/index.ts) with the Resend SDK and the
 * instance policy mocked (no network): without RESEND_API_KEY, or when the
 * instance refuses "send-email", the message goes to the server log instead;
 * otherwise it is sent through Resend from EMAIL_FROM, and a refused
 * delivery throws.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  refused: new Set<string>(),
  send: vi.fn(),
  keys: [] as Array<string | undefined>,
}))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: state.send }
    constructor(key?: string) {
      state.keys.push(key)
    }
  },
}))
// The real policy (every hook and constant of the extension point), with the two refusals replaced.
vi.mock('@/lib/instance/policy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/instance/policy')>()),
  isActionAllowed: vi.fn(async (action: string) => !state.refused.has(action)),
  actionRefusalMessage: vi.fn(() => 'Refusé.'),
}))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { logger } from '@/lib/logger'
import { isEmailEnabled, sendEmail, type EmailMessage } from '@/lib/email'

const MESSAGE: EmailMessage = {
  to: 'marie@example.fr',
  subject: 'Réinitialisation de votre mot de passe Kledg',
  html: '<p>Lien</p>',
  text: 'Réinitialisez votre mot de passe : https://kledg.example.com/reset-password?token=abc',
}

beforeEach(() => {
  vi.clearAllMocks()
  state.refused = new Set()
  delete process.env.RESEND_API_KEY
  delete process.env.EMAIL_FROM
  state.send.mockResolvedValue({ data: { id: 'email-1' }, error: null })
})

afterEach(() => {
  delete process.env.RESEND_API_KEY
  delete process.env.EMAIL_FROM
})

describe('without delivery', () => {
  it('logs the message, link included, instead of sending it when no Resend key is set', async () => {
    expect(await isEmailEnabled()).toBe(false)
    await sendEmail(MESSAGE)
    expect(logger.info).toHaveBeenCalledWith(
      '[email disabled] To: marie@example.fr | Réinitialisation de votre mot de passe Kledg\n' +
        'Réinitialisez votre mot de passe : https://kledg.example.com/reset-password?token=abc',
    )
    expect(state.send).not.toHaveBeenCalled()
    expect(state.keys).toEqual([])
  })

  it('logs it too when the instance policy refuses send-email, even with a key', async () => {
    process.env.RESEND_API_KEY = 're_test_key'
    state.refused.add('send-email')
    expect(await isEmailEnabled()).toBe(false)
    await sendEmail(MESSAGE)
    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(state.send).not.toHaveBeenCalled()
  })
})

describe('with Resend', () => {
  it('sends from the default sender, then from EMAIL_FROM, with one client', async () => {
    process.env.RESEND_API_KEY = 're_test_key'
    expect(await isEmailEnabled()).toBe(true)
    await sendEmail(MESSAGE)
    expect(state.send).toHaveBeenCalledWith({ from: 'Kledg <onboarding@resend.dev>', ...MESSAGE })

    process.env.EMAIL_FROM = 'Compta <compta@acme.fr>'
    await sendEmail(MESSAGE)
    expect(state.send).toHaveBeenLastCalledWith({ from: 'Compta <compta@acme.fr>', ...MESSAGE })
    expect(state.keys).toEqual(['re_test_key'])
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('throws and logs when Resend refuses the delivery', async () => {
    process.env.RESEND_API_KEY = 're_test_key'
    const refusal = { name: 'validation_error', message: 'The acme.fr domain is not verified' }
    state.send.mockResolvedValue({ data: null, error: refusal })
    await expect(sendEmail(MESSAGE)).rejects.toThrow('Email delivery failed: The acme.fr domain is not verified')
    expect(logger.error).toHaveBeenCalledWith('Failed to send email:', refusal)
  })
})
