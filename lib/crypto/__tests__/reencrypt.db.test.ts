/**
 * Re-encryption after a rotation of the auth secret, against PostgreSQL
 * (lib/crypto/reencrypt.ts): with BETTER_AUTH_SECRETS="2:<new>" and the old
 * BETTER_AUTH_SECRET kept, every sealed value (former Qonto connection,
 * integration secret fields, GitHub token) is sealed again with the new key,
 * the readable fields are untouched and a second run changes nothing. Values
 * in the legacy format are sealed again in v2, bound to their row.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('secret_rotation')
})

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { bankConnectionContext, decrypt, encrypt, integrationContext, UPDATE_TOKEN_CONTEXT } from '@/lib/integrations/encryption'
import { getEncryptionKey } from '@/lib/crypto/encryption-key'

const available = await testDatabaseAvailable()

const OLD = 'old-secret-0123456789abcdefghijklmnopqrstuvwxyz'
const NEW = 'new-secret-0123456789abcdefghijklmnopqrstuvwxyz'
const oldKey = getEncryptionKey({ BETTER_AUTH_SECRET: OLD })!
const newKey = getEncryptionKey({ BETTER_AUTH_SECRET: NEW })!

let prisma: typeof import('@/lib/prisma').prisma
let companyId = ''
const qontoCtx = () => bankConnectionContext(companyId, 'QONTO')
const revolutCtx = (field: string) => integrationContext(companyId, 'REVOLUT', field)
let reencryptStoredSecrets: typeof import('@/lib/crypto/reencrypt').reencryptStoredSecrets

describe.skipIf(!available)('reencryptStoredSecrets', () => {
  beforeAll(async () => {
    await prepareTestDatabase('secret_rotation')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ reencryptStoredSecrets } = await import('@/lib/crypto/reencrypt'))
  })

  beforeEach(async () => {
    await prepareTestDatabase('secret_rotation')
    delete process.env.ENCRYPTION_KEY
    delete process.env.BETTER_AUTH_SECRETS
    process.env.BETTER_AUTH_SECRET = OLD
    const company = await prisma.company.create({ data: { name: 'Atelier Alpha', slug: 'atelier-alpha', siren: '111111111' } })
    companyId = company.id
    await prisma.bankConnection.create({
      data: { companyId: company.id, provider: 'QONTO', login: 'alpha', secretKeyEncrypted: encrypt('legacy-qonto', oldKey, qontoCtx()) },
    })
    await prisma.integration.create({
      data: {
        companyId: company.id,
        provider: 'REVOLUT',
        type: 'BANKING',
        name: 'Revolut',
        credentialsEncrypted: true,
        credentials: { clientId: 'revolut-client', privateKey: encrypt('private-key', oldKey, revolutCtx('privateKey')), refreshToken: encrypt('refresh', oldKey, revolutCtx('refreshToken')) },
      },
    })
    await prisma.updateConnection.create({
      data: { owner: 'acme', repo: 'kledg', tokenEncrypted: encrypt('github-token', oldKey, UPDATE_TOKEN_CONTEXT), tokenLast4: 'oken' },
    })
  })

  afterAll(async () => {
    delete process.env.BETTER_AUTH_SECRETS
    await prisma.$disconnect()
  })

  it('changes nothing while no older secret is configured and every value is current', async () => {
    expect(await reencryptStoredSecrets()).toEqual({ resealed: 0, unreadable: 0 })
    const row = await prisma.updateConnection.findFirstOrThrow()
    expect(decrypt(row.tokenEncrypted, oldKey, UPDATE_TOKEN_CONTEXT)).toBe('github-token')
  })

  it('[KLEDG-R3-INPUT-06] seals legacy values again in v2, bound to their row, once', async () => {
    const crypto = await import('crypto')
    const legacy = (text: string) => {
      const iv = crypto.randomBytes(16)
      const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(oldKey, 'hex'), iv)
      const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
      return Buffer.concat([crypto.randomBytes(64), iv, cipher.getAuthTag(), body]).toString('base64')
    }
    await prisma.bankConnection.updateMany({ data: { secretKeyEncrypted: legacy('legacy-qonto') } })
    await prisma.updateConnection.updateMany({ data: { tokenEncrypted: legacy('github-token') } })
    expect(await reencryptStoredSecrets()).toEqual({ resealed: 2, unreadable: 0 })
    const connection = await prisma.bankConnection.findFirstOrThrow()
    expect(connection.secretKeyEncrypted.startsWith('v2:')).toBe(true)
    expect(decrypt(connection.secretKeyEncrypted, oldKey, qontoCtx())).toBe('legacy-qonto')
    const update = await prisma.updateConnection.findFirstOrThrow()
    expect(decrypt(update.tokenEncrypted, oldKey, UPDATE_TOKEN_CONTEXT)).toBe('github-token')
    expect(await reencryptStoredSecrets()).toEqual({ resealed: 0, unreadable: 0 })
  })

  it('reports the values left in the legacy format, by kind, and warns at start-up until they are sealed again', async () => {
    const crypto = await import('crypto')
    const { countLegacySecrets, warnAboutLegacySecrets } = await import('@/lib/crypto/reencrypt')
    const { logger } = await import('@/lib/logger')
    const legacy = (text: string, key: string) => {
      const iv = crypto.randomBytes(16)
      const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv)
      const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
      return Buffer.concat([crypto.randomBytes(64), iv, cipher.getAuthTag(), body]).toString('base64')
    }
    expect(await countLegacySecrets()).toEqual({ total: 0, bankConnections: 0, integrationFields: 0, updateTokens: 0 })

    await prisma.bankConnection.updateMany({ data: { secretKeyEncrypted: legacy('legacy-qonto', oldKey) } })
    const integration = await prisma.integration.findFirstOrThrow()
    // One field under a key nobody has any more: it stays legacy after the pass.
    const lost = getEncryptionKey({ BETTER_AUTH_SECRET: 'lost-secret-0123456789abcdefghijklmnopqrstuvwxyz' })!
    await prisma.integration.update({
      where: { id: integration.id },
      data: { credentials: { ...(integration.credentials as object), privateKey: legacy('private-key', oldKey), refreshToken: legacy('refresh', lost) } },
    })
    await prisma.updateConnection.updateMany({ data: { tokenEncrypted: legacy('github-token', oldKey) } })
    expect(await countLegacySecrets()).toEqual({ total: 4, bankConnections: 1, integrationFields: 2, updateTokens: 1 })
    vi.mocked(logger.warn).mockClear()
    await warnAboutLegacySecrets()
    expect(vi.mocked(logger.warn).mock.calls[0]?.[0]).toMatch(/legacy encryption format: 4 .*pnpm secrets:reencrypt/)

    expect(await reencryptStoredSecrets()).toEqual({ resealed: 3, unreadable: 1 })
    expect(await countLegacySecrets()).toEqual({ total: 1, bankConnections: 0, integrationFields: 1, updateTokens: 0 })

    // Reconnected (sealed again by the app), nothing remains and nothing is logged.
    await prisma.integration.update({
      where: { id: integration.id },
      data: { credentials: { ...((await prisma.integration.findFirstOrThrow()).credentials as object), refreshToken: encrypt('refresh', oldKey, revolutCtx('refreshToken')) } },
    })
    vi.mocked(logger.warn).mockClear()
    expect((await warnAboutLegacySecrets()).total).toBe(0)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('seals every value again with the new key, once', async () => {
    process.env.BETTER_AUTH_SECRETS = `2:${NEW}`
    expect(await reencryptStoredSecrets()).toEqual({ resealed: 4, unreadable: 0 })

    const connection = await prisma.bankConnection.findFirstOrThrow()
    expect(decrypt(connection.secretKeyEncrypted, newKey, qontoCtx())).toBe('legacy-qonto')
    const integration = await prisma.integration.findFirstOrThrow()
    const credentials = integration.credentials as Record<string, string>
    expect(credentials.clientId).toBe('revolut-client')
    expect(decrypt(credentials.privateKey, newKey, revolutCtx('privateKey'))).toBe('private-key')
    expect(decrypt(credentials.refreshToken, newKey, revolutCtx('refreshToken'))).toBe('refresh')
    const update = await prisma.updateConnection.findFirstOrThrow()
    expect(decrypt(update.tokenEncrypted, newKey, UPDATE_TOKEN_CONTEXT)).toBe('github-token')

    expect(await reencryptStoredSecrets()).toEqual({ resealed: 0, unreadable: 0 })
  })
})
