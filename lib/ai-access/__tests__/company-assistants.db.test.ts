/**
 * Which assistants a user connected to one company
 * (lib/ai-access/company-assistants.service.ts), the condition of the
 * "Proposer avec l'IA" button, against PostgreSQL:
 * - a verified Claude or ChatGPT client with a consent and a grant reaching
 *   the company (every company or the company in its list);
 * - no button for a revoked consent (deleted), a disabled client, a grant
 *   naming another company, a connection without grant (fail closed), or
 *   another user's connection;
 * - an enabled, unexpired API key of the user counts as another assistant
 *   (the request is copied), a disabled or expired one does not;
 * - an unverified client is 'other', whatever its client id resembles.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('company_assistants')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let companyAssistants: typeof import('../company-assistants.service').companyAssistants

const OWNER = 'u-owner'
const OTHER = 'u-other'
const CLAUDE = 'https://claude.ai/oauth/mcp-oauth-client-metadata'
const CHATGPT = 'https://chatgpt.com/oauth/client-metadata.json'
const LOOKALIKE = 'https://claude.ai.example.test/oauth/client'
const NOW = new Date('2026-10-05T12:00:00Z')
const companies = {} as Record<'a' | 'b', string>

async function client(clientId: string, disabled = false) {
  await prisma.oauthClient.create({ data: { id: `oc-${clientId.length}-${clientId.slice(-12)}`, clientId, disabled, redirectUris: ['https://example.test/cb'] } })
}

async function consent(userId: string, clientId: string) {
  await prisma.oauthConsent.create({ data: { id: `consent-${userId}-${clientId.slice(-20)}`, userId, clientId, scopes: ['kledg:read'] } })
}

async function grant(userId: string, target: { clientId?: string; apiKeyId?: string }, companyIds: string[] | 'all') {
  await prisma.aiAccessGrant.create({
    data: {
      userId,
      ...target,
      allCompanies: companyIds === 'all',
      ...(companyIds !== 'all' && { companies: { create: companyIds.map((companyId) => ({ companyId })) } }),
    },
  })
}

async function apiKey(id: string, userId: string, data: { enabled?: boolean; expiresAt?: Date | null } = {}) {
  await prisma.apikey.create({
    data: { id, referenceId: userId, key: `hash-${id}`, createdAt: NOW, updatedAt: NOW, enabled: data.enabled ?? true, expiresAt: data.expiresAt ?? null },
  })
}

describe.skipIf(!available)('companyAssistants', () => {
  beforeAll(async () => {
    await prepareTestDatabase('company_assistants')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ companyAssistants } = await import('../company-assistants.service'))
    for (const id of [OWNER, OTHER]) await prisma.user.create({ data: { id, email: `${id}@test.local`, name: id } })
    companies.a = (await prisma.company.create({ data: { name: 'Atelier Alpha', slug: 'atelier-alpha', siren: '111111111' } })).id
    companies.b = (await prisma.company.create({ data: { name: 'Bureau Beta', slug: 'bureau-beta', siren: '222222222' } })).id
    for (const id of [CLAUDE, CHATGPT, LOOKALIKE]) await client(id)
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('offers nothing to a user without any connection', async () => {
    expect(await companyAssistants(OWNER, companies.a, NOW)).toEqual([])
  })

  it('needs a consent and a grant reaching the company (fail closed without a grant)', async () => {
    await consent(OWNER, CLAUDE)
    expect(await companyAssistants(OWNER, companies.a, NOW)).toEqual([])
    await grant(OWNER, { clientId: CLAUDE }, [companies.a])
    expect(await companyAssistants(OWNER, companies.a, NOW)).toEqual(['claude'])
    expect(await companyAssistants(OWNER, companies.b, NOW)).toEqual([])
    expect(await companyAssistants(OTHER, companies.a, NOW)).toEqual([])
  })

  it('lists ChatGPT with every company, Claude first', async () => {
    await consent(OWNER, CHATGPT)
    await grant(OWNER, { clientId: CHATGPT }, 'all')
    expect(await companyAssistants(OWNER, companies.a, NOW)).toEqual(['claude', 'chatgpt'])
    expect(await companyAssistants(OWNER, companies.b, NOW)).toEqual(['chatgpt'])
  })

  it('drops a revoked consent and a disabled client', async () => {
    await prisma.oauthConsent.deleteMany({ where: { userId: OWNER, clientId: CHATGPT } })
    expect(await companyAssistants(OWNER, companies.b, NOW)).toEqual([])
    await prisma.oauthClient.update({ where: { clientId: CLAUDE }, data: { disabled: true } })
    expect(await companyAssistants(OWNER, companies.a, NOW)).toEqual([])
    await prisma.oauthClient.update({ where: { clientId: CLAUDE }, data: { disabled: false } })
  })

  it('counts an unverified client as another assistant, never as Claude', async () => {
    await consent(OTHER, LOOKALIKE)
    await grant(OTHER, { clientId: LOOKALIKE }, 'all')
    expect(await companyAssistants(OTHER, companies.a, NOW)).toEqual(['other'])
  })

  it('counts an enabled, unexpired API key, not a disabled or expired one', async () => {
    await apiKey('key-off', OTHER, { enabled: false })
    await grant(OTHER, { apiKeyId: 'key-off' }, [companies.b])
    await apiKey('key-old', OTHER, { expiresAt: new Date('2026-10-01T00:00:00Z') })
    await grant(OTHER, { apiKeyId: 'key-old' }, [companies.b])
    expect(await companyAssistants(OTHER, companies.b, NOW)).toEqual(['other'])
    await prisma.aiAccessGrant.deleteMany({ where: { userId: OTHER, clientId: LOOKALIKE } })
    expect(await companyAssistants(OTHER, companies.b, NOW)).toEqual([])
    await apiKey('key-on', OTHER, { expiresAt: new Date('2027-01-01T00:00:00Z') })
    await grant(OTHER, { apiKeyId: 'key-on' }, [companies.b])
    expect(await companyAssistants(OTHER, companies.b, NOW)).toEqual(['other'])
    expect(await companyAssistants(OTHER, companies.a, NOW)).toEqual([])
  })
})
