import { describe, expect, it } from 'vitest'
import { instanceStatus } from '../instance-status'

const allowed = { sendEmailAllowed: true }

describe('instanceStatus', () => {
  it('tells whether emails leave the instance', () => {
    expect(instanceStatus({}, allowed).email).toBe('log-only')
    expect(instanceStatus({ RESEND_API_KEY: 're_x' }, allowed).email).toBe('test-sender')
    const configured = instanceStatus({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'Kledg <compta@exemple.fr>' }, allowed)
    expect(configured.email).toBe('configured')
    expect(configured.emailFrom).toBe('Kledg <compta@exemple.fr>')
    expect(instanceStatus({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.fr' }, { sendEmailAllowed: false }).email).toBe('disabled')
  })

  it('never returns a secret', () => {
    const status = instanceStatus({ RESEND_API_KEY: 're_secret_value', CRON_SECRET: 'cron-secret-value' }, allowed)
    expect(JSON.stringify(status)).not.toMatch(/secret_value|secret-value/)
    expect(status.cronSecretSet).toBe(true)
  })

  it('says what the configuration page needs, never a value', () => {
    const env = {
      SETUP_TOKEN: 'setup-token-value',
      BETTER_AUTH_SECRETS: '2:new-secret-value',
      ENCRYPTION_KEY: 'a'.repeat(64),
      KLEDG_RLS: 'enforce',
      BETTER_AUTH_URL: 'https://compta.exemple.fr/',
    }
    const status = instanceStatus(env, allowed)
    expect(status).toMatchObject({
      setupTokenSet: true,
      secretRotation: true,
      encryptionKey: 'own',
      rls: 'enforce',
      appUrl: 'https://compta.exemple.fr/',
      effectiveUrl: 'https://compta.exemple.fr',
    })
    expect(JSON.stringify(status)).not.toMatch(/token-value|secret-value|aaaa/)
    const plain = instanceStatus({ VERCEL: '1', VERCEL_PROJECT_PRODUCTION_URL: 'kledg-x.vercel.app' }, allowed)
    expect(plain).toMatchObject({ setupTokenSet: false, secretRotation: false, encryptionKey: 'derived', rls: 'off', appUrl: null })
    expect(plain.effectiveUrl).toBe('https://kledg-x.vercel.app')
  })

  it('detects the hosting platform', () => {
    expect(instanceStatus({ VERCEL: '1' }, allowed).platform).toBe('vercel')
    expect(instanceStatus({ KLEDG_RUNTIME: 'docker' }, allowed).platform).toBe('docker')
    expect(instanceStatus({ KLEDG_RUNTIME: 'docker', RENDER: 'true' }, allowed).platform).toBe('render')
    expect(instanceStatus({ KLEDG_RUNTIME: 'docker', FLY_APP_NAME: 'kledg' }, allowed).platform).toBe('fly')
    expect(instanceStatus({}, allowed).platform).toBe('node')
  })
})
