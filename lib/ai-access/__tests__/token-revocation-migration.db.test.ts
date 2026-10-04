/**
 * Migration 20261006090000_ai_assistant_token_revocation against PostgreSQL,
 * at the SQL level. assistant-tokens.db.test.ts covers the triggers end to
 * end through Better Auth (refresh tokens deleted on revocation, narrowed
 * when the level is lowered); this file adds what it does not reach:
 * - the scope backfill: kledg:admin appended to the MCP resource and to the
 *   clients that have kledg:write and not kledg:admin, idempotently;
 * - stored (opaque) access tokens deleted and narrowed like refresh tokens;
 * - a remaining consent of the same user and client keeps the tokens.
 * Skipped without the test database server.
 */

import { readFileSync } from 'fs'
import path from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('cov_bank_token_revocation_migration')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

const SQL = readFileSync(
  path.resolve(__dirname, '../../../prisma/migrations/20261006090000_ai_assistant_token_revocation/migration.sql'),
  'utf8',
)
/** The two scope updates at the end of the migration (the triggers are already installed). */
const BACKFILL = SQL.slice(SQL.indexOf('UPDATE "oauthResource"'))

let prisma: typeof import('@/lib/prisma').prisma

async function client(clientId: string, scopes: string[]) {
  await prisma.oauthClient.create({ data: { id: `id-${clientId}`, clientId, scopes, redirectUris: ['https://claude.ai/callback'] } })
}

async function tokens(userId: string, clientId: string, scopes: string[], suffix = '') {
  await prisma.oauthRefreshToken.create({ data: { id: `rt-${userId}-${clientId}${suffix}`, token: `rt-${userId}-${clientId}${suffix}`, clientId, userId, scopes } })
  await prisma.oauthAccessToken.create({ data: { id: `at-${userId}-${clientId}${suffix}`, token: `at-${userId}-${clientId}${suffix}`, clientId, userId, scopes } })
}

const scopesOf = async (userId: string, clientId: string) => ({
  refresh: (await prisma.oauthRefreshToken.findMany({ where: { userId, clientId }, select: { scopes: true } })).map((t) => t.scopes),
  access: (await prisma.oauthAccessToken.findMany({ where: { userId, clientId }, select: { scopes: true } })).map((t) => t.scopes),
})

describe.skipIf(!available)('migration 20261006090000_ai_assistant_token_revocation', () => {
  beforeAll(async () => {
    await prepareTestDatabase('cov_bank_token_revocation_migration')
    ;({ prisma } = await import('@/lib/prisma'))
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('cov_bank_token_revocation_migration')
    for (const id of ['u-owner', 'u-other']) await prisma.user.create({ data: { id, email: `${id}@example.fr`, name: id } })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('scope backfill', () => {
    it('lets the MCP resource and the clients that write ask for kledg:admin, once', async () => {
      await prisma.oauthResource.create({
        data: { id: 'res-mcp', identifier: 'http://localhost:3000/api/mcp', name: 'Kledg MCP', allowedScopes: ['kledg:read', 'kledg:write'] },
      })
      await prisma.oauthResource.create({ data: { id: 'res-read', identifier: 'urn:read-only', name: 'Lecture', allowedScopes: ['kledg:read'] } })
      await client('writer', ['openid', 'offline_access', 'kledg:read', 'kledg:write'])
      await client('reader', ['openid', 'kledg:read'])
      await client('admin', ['kledg:read', 'kledg:write', 'kledg:admin'])

      await prisma.$executeRawUnsafe(BACKFILL)
      await prisma.$executeRawUnsafe(BACKFILL)

      const resources = await prisma.oauthResource.findMany({ orderBy: { id: 'asc' }, select: { id: true, allowedScopes: true } })
      expect(resources).toEqual([
        { id: 'res-mcp', allowedScopes: ['kledg:read', 'kledg:write', 'kledg:admin'] },
        { id: 'res-read', allowedScopes: ['kledg:read'] },
      ])
      const clients = await prisma.oauthClient.findMany({ orderBy: { clientId: 'asc' }, select: { clientId: true, scopes: true } })
      expect(clients).toEqual([
        { clientId: 'admin', scopes: ['kledg:read', 'kledg:write', 'kledg:admin'] },
        { clientId: 'reader', scopes: ['openid', 'kledg:read'] },
        { clientId: 'writer', scopes: ['openid', 'offline_access', 'kledg:read', 'kledg:write', 'kledg:admin'] },
      ])
    })
  })

  describe('triggers on oauthConsent', () => {
    const ALL = ['kledg:read', 'kledg:write', 'kledg:admin']

    beforeEach(async () => {
      await client('claude', ALL)
      await client('other-app', ALL)
    })

    it("deletes the user's stored access and refresh tokens for the client when the last consent goes", async () => {
      await prisma.oauthConsent.create({ data: { id: 'c-1', userId: 'u-owner', clientId: 'claude', scopes: ALL } })
      await prisma.oauthConsent.create({ data: { id: 'c-other', userId: 'u-other', clientId: 'claude', scopes: ALL } })
      await prisma.oauthConsent.create({ data: { id: 'c-app', userId: 'u-owner', clientId: 'other-app', scopes: ALL } })
      await tokens('u-owner', 'claude', ALL)
      await tokens('u-other', 'claude', ALL)
      await tokens('u-owner', 'other-app', ALL)

      await prisma.oauthConsent.delete({ where: { id: 'c-1' } })

      expect(await scopesOf('u-owner', 'claude')).toEqual({ refresh: [], access: [] })
      // Another user of the client, and another client of the user, keep theirs
      expect(await scopesOf('u-other', 'claude')).toEqual({ refresh: [ALL], access: [ALL] })
      expect(await scopesOf('u-owner', 'other-app')).toEqual({ refresh: [ALL], access: [ALL] })
    })

    it('keeps the tokens while another consent of the same user and client remains', async () => {
      await prisma.oauthConsent.create({ data: { id: 'c-1', userId: 'u-owner', clientId: 'claude', scopes: ALL } })
      await prisma.oauthConsent.create({ data: { id: 'c-2', userId: 'u-owner', clientId: 'claude', scopes: ['kledg:read'] } })
      await tokens('u-owner', 'claude', ALL)

      await prisma.oauthConsent.delete({ where: { id: 'c-1' } })
      expect(await scopesOf('u-owner', 'claude')).toEqual({ refresh: [ALL], access: [ALL] })

      await prisma.oauthConsent.delete({ where: { id: 'c-2' } })
      expect(await scopesOf('u-owner', 'claude')).toEqual({ refresh: [], access: [] })
    })

    it('narrows stored access and refresh tokens to the consented scopes, keeping their order', async () => {
      await prisma.oauthConsent.create({ data: { id: 'c-1', userId: 'u-owner', clientId: 'claude', scopes: ALL } })
      await tokens('u-owner', 'claude', ['openid', 'kledg:read', 'kledg:write', 'kledg:admin'])
      await tokens('u-owner', 'claude', ['kledg:read'], '-ro')
      await tokens('u-other', 'claude', ALL)

      await prisma.oauthConsent.update({ where: { id: 'c-1' }, data: { scopes: ['openid', 'kledg:read'] } })

      const narrowed = await scopesOf('u-owner', 'claude')
      expect(narrowed.refresh.sort()).toEqual([['kledg:read'], ['openid', 'kledg:read']].sort())
      expect(narrowed.access.sort()).toEqual([['kledg:read'], ['openid', 'kledg:read']].sort())
      expect(await scopesOf('u-other', 'claude')).toEqual({ refresh: [ALL], access: [ALL] })
    })

    it('leaves tokens alone when the consent widens or other columns change', async () => {
      await prisma.oauthConsent.create({ data: { id: 'c-1', userId: 'u-owner', clientId: 'claude', scopes: ['kledg:read'] } })
      await tokens('u-owner', 'claude', ['kledg:read'])

      await prisma.oauthConsent.update({ where: { id: 'c-1' }, data: { scopes: ALL } })
      await prisma.oauthConsent.update({ where: { id: 'c-1' }, data: { updatedAt: new Date('2026-10-04T00:00:00Z') } })
      expect(await scopesOf('u-owner', 'claude')).toEqual({ refresh: [['kledg:read']], access: [['kledg:read']] })
    })
  })
})
