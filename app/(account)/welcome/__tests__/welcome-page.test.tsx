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
import WelcomePage from '../page'

const db = asPrismaMock(prisma)

const PLATFORM_VARS = ['VERCEL', 'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_PROJECT_ID', 'RENDER', 'FLY_APP_NAME', 'CC_DEPLOYMENT_ID', 'APP_ID', 'COOLIFY_RESOURCE_UUID', 'COOLIFY_CONTAINER_NAME', 'KLEDG_RUNTIME']

beforeEach(() => {
  state.user = { id: 'a1', email: 'admin@acme.fr', name: null, role: 'admin' }
  state.allowed = { onboarding: true, 'send-email': true }
  db.company.count.mockResolvedValue(0)
  for (const name of [...PLATFORM_VARS, 'RESEND_API_KEY', 'EMAIL_FROM']) vi.stubEnv(name, '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('welcome page', () => {
  it('sends an anonymous visitor to the sign-in page', async () => {
    state.user = null
    await expect(WelcomePage()).rejects.toThrow('NEXT_REDIRECT /login')
  })

  it('is for instance administrators only, and an instance may hide it', async () => {
    state.user = { id: 'u1', email: 'u1@acme.fr', name: null, role: 'user' }
    await expect(WelcomePage()).rejects.toThrow('NEXT_REDIRECT /companies')
    state.user = { id: 'a1', email: 'admin@acme.fr', name: null, role: 'admin' }
    state.allowed.onboarding = false
    await expect(WelcomePage()).rejects.toThrow('NEXT_REDIRECT /companies')
    expect(db.company.count).not.toHaveBeenCalled()
  })

  it('says emails only go to the logs without a Resend key, and leads to the first company', async () => {
    render(await WelcomePage())
    expect(screen.getByText('Non configuré')).toBeInTheDocument()
    expect(screen.getByText(/Sans RESEND_API_KEY, aucun email ne part/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Configurer les emails/ })).toHaveAttribute('href', 'https://www.kledg.com/fr/self-hosting')
    expect(screen.getByText('1.3.0')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Créer ma première société/ })).toHaveAttribute('href', '/companies/new')
    // A server without a managed database: daily pg_dump.
    expect(screen.getByText(/Planifiez chaque jour un/)).toBeInTheDocument()
  })

  it('names the sender when emails are configured, and leads to the companies once one exists', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_123')
    vi.stubEnv('EMAIL_FROM', 'Kledg <compta@acme.fr>')
    db.company.count.mockResolvedValue(3)
    render(await WelcomePage())
    expect(screen.getByText('Configuré')).toBeInTheDocument()
    expect(screen.getByText('Kledg <compta@acme.fr>')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Configurer les emails/ })).toBeNull()
    expect(screen.getByRole('link', { name: /Aller à mes sociétés/ })).toHaveAttribute('href', '/companies')
  })

  it('warns about the Resend test sender without EMAIL_FROM', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_123')
    render(await WelcomePage())
    expect(screen.getByText('Expéditeur de test')).toBeInTheDocument()
    expect(screen.getByText(/l'expéditeur de test de Resend ne livre qu'à/)).toBeInTheDocument()
  })

  it('says emails are disabled when the instance refuses to send them', async () => {
    state.allowed['send-email'] = false
    vi.stubEnv('RESEND_API_KEY', 're_123')
    render(await WelcomePage())
    expect(screen.getByText('Désactivé sur cette instance')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Configurer les emails/ })).toBeNull()
  })

  it.each([
    ['VERCEL', '1', /Votre base est chez Neon/],
    ['RAILWAY_PROJECT_ID', 'p1', /Vérifiez dans la console Railway/],
  ])('explains backups for the host (%s)', async (name, value, text) => {
    vi.stubEnv(name, value)
    render(await WelcomePage())
    expect(screen.getByText(text)).toBeInTheDocument()
  })
})
