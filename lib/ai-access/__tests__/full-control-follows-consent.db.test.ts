/**
 * Migration 20261213090000_ai_grant_full_control_follows_consent against
 * PostgreSQL: the password confirmation of an assistant's full control
 * (ai_access_grants."fullControlConfirmedAt") is cleared once its consent
 * no longer grants kledg:admin, so full control comes back only with the
 * password again (lib/mcp/auth.ts reads fullControlConfirmed on each call);
 * and the backfill clears the grants of 20261208090000 whose assistant has
 * no full control consent. Skipped without the test database server.
 */

import { readFileSync } from 'fs'
import path from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('ai_full_control_consent')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

const SQL = readFileSync(
  path.resolve(__dirname, '../../../prisma/migrations/20261213090000_ai_grant_full_control_follows_consent/migration.sql'),
  'utf8',
)
/** The backfill at the end of the migration (the triggers are already installed). */
const BACKFILL = SQL.slice(SQL.indexOf('UPDATE "ai_access_grants" g'))

const ALL = ['kledg:read', 'kledg:write', 'kledg:admin']
const DRAFTS = ['kledg:read', 'kledg:write']

let prisma: typeof import('@/lib/prisma').prisma
let fullControlConfirmed: typeof import('@/lib/ai-access/manage-grants.service').fullControlConfirmed

const confirmedAt = async (userId: string, clientId: string) =>
  (await prisma.aiAccessGrant.findFirst({ where: { userId, clientId }, select: { fullControlConfirmedAt: true } }))?.fullControlConfirmedAt ?? null

describe.skipIf(!available)('full control confirmation follows the consent', () => {
  beforeAll(async () => {
    await prepareTestDatabase('ai_full_control_consent')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ fullControlConfirmed } = await import('@/lib/ai-access/manage-grants.service'))
  }, 180_000)

  beforeEach(async () => {
    await prepareTestDatabase('ai_full_control_consent')
    for (const id of ['u-owner', 'u-other']) await prisma.user.create({ data: { id, email: `${id}@example.fr`, name: id } })
    for (const clientId of ['claude', 'other-app']) {
      await prisma.oauthClient.create({ data: { id: `id-${clientId}`, clientId, scopes: ALL, redirectUris: ['https://claude.ai/callback'] } })
    }
    const confirmed = new Date('2026-11-01T10:00:00.000Z')
    await prisma.oauthConsent.create({ data: { id: 'c-owner', userId: 'u-owner', clientId: 'claude', scopes: ALL } })
    await prisma.oauthConsent.create({ data: { id: 'c-other', userId: 'u-other', clientId: 'claude', scopes: ALL } })
    await prisma.oauthConsent.create({ data: { id: 'c-app', userId: 'u-owner', clientId: 'other-app', scopes: ALL } })
    for (const [userId, clientId] of [['u-owner', 'claude'], ['u-other', 'claude'], ['u-owner', 'other-app']]) {
      await prisma.aiAccessGrant.create({ data: { userId, clientId, executionMode: 'automatic', fullControlConfirmedAt: confirmed } })
    }
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('clears the confirmation when the level is lowered below full control (update-consent)', async () => {
    expect(await fullControlConfirmed('u-owner', 'claude')).toBe(true)
    await prisma.oauthConsent.update({ where: { id: 'c-owner' }, data: { scopes: DRAFTS } })

    expect(await confirmedAt('u-owner', 'claude')).toBeNull()
    expect(await fullControlConfirmed('u-owner', 'claude')).toBe(false)
    // Another user of the client, and another client of the user, keep theirs
    expect(await confirmedAt('u-other', 'claude')).not.toBeNull()
    expect(await confirmedAt('u-owner', 'other-app')).not.toBeNull()
  })

  it('does not bring full control back when the consent gets kledg:admin again: the password does', async () => {
    await prisma.oauthConsent.update({ where: { id: 'c-owner' }, data: { scopes: DRAFTS } })
    await prisma.oauthConsent.update({ where: { id: 'c-owner' }, data: { scopes: ALL } })
    expect(await fullControlConfirmed('u-owner', 'claude')).toBe(false)
  })

  it('clears it when a new consent without kledg:admin is recorded', async () => {
    await prisma.oauthConsent.create({ data: { id: 'c-owner-2', userId: 'u-owner', clientId: 'claude', scopes: ['kledg:read'] } })
    expect(await confirmedAt('u-owner', 'claude')).toBeNull()
  })

  it('keeps it while the consent keeps kledg:admin', async () => {
    await prisma.oauthConsent.update({ where: { id: 'c-owner' }, data: { scopes: [...ALL, 'openid'] } })
    expect(await fullControlConfirmed('u-owner', 'claude')).toBe(true)
  })

  it('backfill: clears the grants confirmed by 20261208090000 whose assistant has no full control consent', async () => {
    // Confirmed by 20261208090000 while its consent gives drafts only, or no consent of this user at all
    await prisma.oauthConsent.create({ data: { id: 'c-other-app', userId: 'u-other', clientId: 'other-app', scopes: DRAFTS } })
    await prisma.aiAccessGrant.create({ data: { userId: 'u-other', clientId: 'other-app', fullControlConfirmedAt: new Date() } })
    expect(await confirmedAt('u-other', 'other-app')).not.toBeNull()

    await prisma.$executeRawUnsafe(BACKFILL)

    expect(await confirmedAt('u-other', 'other-app')).toBeNull()
    // Grants whose consent gives full control keep their confirmation
    expect(await confirmedAt('u-owner', 'claude')).not.toBeNull()
    expect(await confirmedAt('u-other', 'claude')).not.toBeNull()
    expect(await confirmedAt('u-owner', 'other-app')).not.toBeNull()
  })
})
