/**
 * Re-encryption after a rotation of the auth secret, against PostgreSQL
 * (lib/crypto/reencrypt.ts): with BETTER_AUTH_SECRETS="2:<new>" and the old
 * BETTER_AUTH_SECRET kept, every sealed value (former Qonto connection,
 * integration secret fields, GitHub token) is sealed again with the new key,
 * the readable fields are untouched, a second run changes nothing, and the
 * pass does nothing at all while no older secret is configured.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('secret_rotation')
})

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { decrypt, encrypt } from '@/lib/integrations/encryption'
import { getEncryptionKey } from '@/lib/crypto/encryption-key'

const available = await testDatabaseAvailable()

const OLD = 'old-secret-0123456789abcdefghijklmnopqrstuvwxyz'
const NEW = 'new-secret-0123456789abcdefghijklmnopqrstuvwxyz'
const oldKey = getEncryptionKey({ BETTER_AUTH_SECRET: OLD })!
const newKey = getEncryptionKey({ BETTER_AUTH_SECRET: NEW })!

let prisma: typeof import('@/lib/prisma').prisma
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
    await prisma.bankConnection.create({
      data: { companyId: company.id, provider: 'QONTO', login: 'alpha', secretKeyEncrypted: encrypt('legacy-qonto', oldKey) },
    })
    await prisma.integration.create({
      data: {
        companyId: company.id,
        provider: 'REVOLUT',
        type: 'BANKING',
        name: 'Revolut',
        credentialsEncrypted: true,
        credentials: { clientId: 'revolut-client', privateKey: encrypt('private-key', oldKey), refreshToken: encrypt('refresh', oldKey) },
      },
    })
    await prisma.updateConnection.create({
      data: { owner: 'acme', repo: 'kledg', tokenEncrypted: encrypt('github-token', oldKey), tokenLast4: 'oken' },
    })
  })

  afterAll(async () => {
    delete process.env.BETTER_AUTH_SECRETS
    await prisma.$disconnect()
  })

  it('does nothing while no older secret is configured', async () => {
    expect(await reencryptStoredSecrets()).toBeNull()
    const row = await prisma.updateConnection.findFirstOrThrow()
    expect(decrypt(row.tokenEncrypted, oldKey)).toBe('github-token')
  })

  it('seals every value again with the new key, once', async () => {
    process.env.BETTER_AUTH_SECRETS = `2:${NEW}`
    expect(await reencryptStoredSecrets()).toEqual({ resealed: 4, unreadable: 0 })

    const connection = await prisma.bankConnection.findFirstOrThrow()
    expect(decrypt(connection.secretKeyEncrypted, newKey)).toBe('legacy-qonto')
    const integration = await prisma.integration.findFirstOrThrow()
    const credentials = integration.credentials as Record<string, string>
    expect(credentials.clientId).toBe('revolut-client')
    expect(decrypt(credentials.privateKey, newKey)).toBe('private-key')
    expect(decrypt(credentials.refreshToken, newKey)).toBe('refresh')
    const update = await prisma.updateConnection.findFirstOrThrow()
    expect(decrypt(update.tokenEncrypted, newKey)).toBe('github-token')

    expect(await reencryptStoredSecrets()).toEqual({ resealed: 0, unreadable: 0 })
  })
})
