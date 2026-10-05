import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; name: string | null; role: string | null },
  allowed: { onboarding: true, 'send-email': true } as Record<string, boolean>,
}))

vi.mock('@/lib/session', () => ({ getCurrentUser: vi.fn(async () => state.user) }))
vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/instance', () => ({ isActionAllowed: vi.fn(async (action: string) => state.allowed[action] ?? true) }))
vi.mock('@/lib/updates/version', () => ({ getDeployedVersion: () => ({ version: '1.3.0', commit: null }) }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  }),
}))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import ConfigurationPage from '../page'

const db = asPrismaMock(prisma)

const PLATFORM_VARS = ['VERCEL', 'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_PROJECT_ID', 'RENDER', 'FLY_APP_NAME', 'CC_DEPLOYMENT_ID', 'APP_ID', 'COOLIFY_RESOURCE_UUID', 'COOLIFY_CONTAINER_NAME', 'KLEDG_RUNTIME']

beforeEach(() => {
  state.user = { id: 'a1', email: 'admin@acme.fr', name: null, role: 'admin' }
  state.allowed = { onboarding: true, 'send-email': true }
  db.company.count.mockResolvedValue(0)
  for (const name of [...PLATFORM_VARS, 'RESEND_API_KEY', 'EMAIL_FROM', 'CRON_SECRET', 'SETUP_TOKEN', 'BETTER_AUTH_SECRETS', 'ENCRYPTION_KEY', 'KLEDG_RLS', 'BETTER_AUTH_URL']) vi.stubEnv(name, '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

/**
 * Settings, Configuration (formerly the welcome page): the instance's
 * settings with their status and steps, in the host's words. Client parts
 * (test email, secret generator) render as buttons here.
 */
describe('configuration page', () => {
  it('sends an anonymous visitor to the sign-in page', async () => {
    state.user = null
    await expect(ConfigurationPage()).rejects.toThrow('NEXT_REDIRECT /login')
  })

  it('is for instance administrators only, and an instance may hide it', async () => {
    state.user = { id: 'u1', email: 'u1@acme.fr', name: null, role: 'user' }
    await expect(ConfigurationPage()).rejects.toThrow('NEXT_REDIRECT /companies')
    state.user = { id: 'a1', email: 'admin@acme.fr', name: null, role: 'admin' }
    state.allowed.onboarding = false
    await expect(ConfigurationPage()).rejects.toThrow('NEXT_REDIRECT /companies')
    expect(db.company.count).not.toHaveBeenCalled()
  })

  it('says emails only go to the logs without a Resend key, and leads to the first company', async () => {
    render(await ConfigurationPage())
    expect(screen.getByText('Non configuré')).toBeInTheDocument()
    expect(screen.getByText(/Aucun email ne part/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ajouter les emails/ })).toHaveAttribute('href', 'https://www.kledg.com/docs/installer-kledg#ajouter-les-emails')
    expect(screen.queryByRole('button', { name: 'Envoyer un email de test' })).toBeNull()
    expect(screen.getByText('1.3.0')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Créer ma première société/ })).toHaveAttribute('href', '/companies/new')
    // A server without a managed database: daily pg_dump.
    expect(screen.getByText(/de la base, copiez les fichiers/)).toBeInTheDocument()
  })

  it('names the sender when emails are configured, offers a test email, and skips the first steps once a company exists', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_123')
    vi.stubEnv('EMAIL_FROM', 'Kledg <compta@acme.fr>')
    db.company.count.mockResolvedValue(3)
    render(await ConfigurationPage())
    expect(screen.getByText('Configuré')).toBeInTheDocument()
    expect(screen.getByText('Kledg <compta@acme.fr>')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Envoyer un email de test' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Ajouter les emails/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Créer ma première société/ })).toBeNull()
  })

  it('explains the Resend test sender without EMAIL_FROM, with the Vercel steps', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_123')
    vi.stubEnv('VERCEL', '1')
    render(await ConfigurationPage())
    expect(screen.getByText('Expéditeur de test')).toBeInTheDocument()
    expect(screen.getByText(/claim ownership/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Envoyer un email de test' })).toBeInTheDocument()
  })

  it('says emails are disabled when the instance refuses to send them', async () => {
    state.allowed['send-email'] = false
    vi.stubEnv('RESEND_API_KEY', 're_123')
    render(await ConfigurationPage())
    expect(screen.getByText('Désactivé sur cette instance')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Ajouter les emails/ })).toBeNull()
  })

  it('shows the address, and the steps for a custom domain', async () => {
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'kledg-acme.vercel.app')
    const { unmount } = render(await ConfigurationPage())
    expect(screen.getByText("Adresse de l'hébergeur")).toBeInTheDocument()
    expect(screen.getByText('https://kledg-acme.vercel.app')).toBeInTheDocument()
    expect(screen.getByText(/Settings, Domains/)).toBeInTheDocument()
    unmount()
    vi.stubEnv('BETTER_AUTH_URL', 'https://compta.acme.fr')
    render(await ConfigurationPage())
    expect(screen.getByText('Domaine personnalisé')).toBeInTheDocument()
    expect(screen.queryByText(/Settings, Domains/)).toBeNull()
  })

  it('tells whether the bank sync is protected, and generates a CRON_SECRET to paste', async () => {
    const { unmount } = render(await ConfigurationPage())
    expect(screen.getByText('Ouverte, limitée')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Générer CRON_SECRET' })).toBeInTheDocument()
    unmount()
    vi.stubEnv('CRON_SECRET', 'cron-secret-value')
    render(await ConfigurationPage())
    expect(screen.getByText('Protégée')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('cron-secret-value')
  })

  it('flags a leftover SETUP_TOKEN and a secret rotation under way, never their values', async () => {
    vi.stubEnv('SETUP_TOKEN', 'setup-token-value')
    vi.stubEnv('BETTER_AUTH_SECRETS', '2:new-secret-value')
    vi.stubEnv('KLEDG_RLS', 'enforce')
    render(await ConfigurationPage())
    expect(screen.getByText('À supprimer')).toBeInTheDocument()
    expect(screen.getByText('Rotation en cours')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/token-value|secret-value/)
  })

  it.each([
    ['VERCEL', '1', /Votre base est chez Neon/],
    ['RAILWAY_PROJECT_ID', 'p1', /Vérifiez dans la console Railway/],
  ])('explains backups for the host (%s)', async (name, value, text) => {
    vi.stubEnv(name, value)
    render(await ConfigurationPage())
    expect(screen.getByText(text)).toBeInTheDocument()
  })
})
