/**
 * Re-encryption after a rotation of the auth secret (lib/crypto/encryption-key.ts),
 * and upgrade of values sealed in the legacy format (no context bound,
 * lib/integrations/encryption.ts) to the v2 format bound to their row.
 *
 * Every value sealed at rest is tried with the current key; one that only an
 * older key opens is sealed again with the current key. Run at server start
 * (instrumentation.ts) while older secrets are still configured, so the
 * operator rotates by setting BETTER_AUTH_SECRETS="2:<new>,1:<old>",
 * redeploying, then dropping the old secret. Idempotent, and serialized by a
 * PostgreSQL advisory lock: concurrent server starts skip it.
 *
 * Sealed values: BankConnection.secretKeyEncrypted (former Qonto
 * connections), the secret fields of Integration.credentials
 * (lib/banking/credentials.ts) and UpdateConnection.tokenEncrypted.
 */

import { prisma } from '@/lib/prisma'
import { bankConnectionContext, decrypt, encrypt, integrationContext, isLegacySealed, UPDATE_TOKEN_CONTEXT } from '@/lib/integrations/encryption'
import { SECRET_FIELDS } from '@/lib/banking/credentials'
import { withSystemContext } from '@/lib/rls/context'
import { logger } from '@/lib/logger'
import { getEncryptionKey, previousEncryptionKeys } from './encryption-key'

/** Arbitrary constant identifying the re-encryption advisory lock. */
const REENCRYPT_LOCK_KEY = 4_217_002

export interface ReencryptResult {
  /** Values sealed again with the current key. */
  resealed: number
  /** Values no configured key opens: the integration must be reconnected. */
  unreadable: number
}

type Outcome = { kind: 'current' } | { kind: 'resealed'; value: string } | { kind: 'unreadable' }

/**
 * What the current key makes of a sealed value stored at `context`: already
 * current (v2), sealed again (an older key opens it, or it is in the legacy
 * format), or unreadable.
 */
export function reseal(sealed: string, current: string, previous: readonly string[], context: string): Outcome {
  for (const key of [current, ...previous]) {
    const plain = tryDecrypt(sealed, key, context)
    if (plain === null) continue
    if (key === current && !isLegacySealed(sealed)) return { kind: 'current' }
    return { kind: 'resealed', value: encrypt(plain, current, context) }
  }
  return { kind: 'unreadable' }
}

function tryDecrypt(sealed: string, key: string, context: string): string | null {
  try {
    return decrypt(sealed, key, context)
  } catch {
    return null
  }
}

/**
 * Seals again, with the current key and in the v2 format, every value an
 * older key opens or still in the legacy format. Does nothing without an
 * instance key.
 */
export async function reencryptStoredSecrets(): Promise<ReencryptResult | null> {
  const current = getEncryptionKey()
  const previous = previousEncryptionKeys()
  if (!current) return null

  return withSystemContext('secret-rotation', () =>
    prisma.$transaction(
      async (tx) => {
        const [{ locked }] = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(${REENCRYPT_LOCK_KEY}) AS locked`
        if (!locked) return null
        const result: ReencryptResult = { resealed: 0, unreadable: 0 }
        const count = (outcome: Outcome) => {
          if (outcome.kind === 'resealed') result.resealed++
          if (outcome.kind === 'unreadable') result.unreadable++
        }

        const connections = await tx.bankConnection.findMany({
          where: { secretKeyEncrypted: { not: '' } },
          select: { id: true, companyId: true, provider: true, secretKeyEncrypted: true },
        })
        for (const row of connections) {
          const outcome = reseal(row.secretKeyEncrypted, current, previous, bankConnectionContext(row.companyId, row.provider))
          count(outcome)
          if (outcome.kind === 'resealed') {
            await tx.bankConnection.update({ where: { id: row.id }, data: { secretKeyEncrypted: outcome.value } })
          }
        }

        const integrations = await tx.integration.findMany({
          where: { credentialsEncrypted: true },
          select: { id: true, companyId: true, provider: true, credentials: true },
        })
        for (const row of integrations) {
          const credentials = row.credentials && typeof row.credentials === 'object' ? { ...(row.credentials as Record<string, unknown>) } : null
          if (!credentials) continue
          let changed = false
          for (const field of SECRET_FIELDS[row.provider] ?? ['secretKey']) {
            const value = credentials[field]
            if (typeof value !== 'string' || value.length === 0) continue
            const outcome = reseal(value, current, previous, integrationContext(row.companyId, row.provider, field))
            count(outcome)
            if (outcome.kind === 'resealed') {
              credentials[field] = outcome.value
              changed = true
            }
          }
          if (changed) await tx.integration.update({ where: { id: row.id }, data: { credentials: credentials as object } })
        }

        const updates = await tx.updateConnection.findMany({ select: { id: true, tokenEncrypted: true } })
        for (const row of updates) {
          if (!row.tokenEncrypted) continue
          const outcome = reseal(row.tokenEncrypted, current, previous, UPDATE_TOKEN_CONTEXT)
          count(outcome)
          if (outcome.kind === 'resealed') {
            await tx.updateConnection.update({ where: { id: row.id }, data: { tokenEncrypted: outcome.value } })
          }
        }

        if (result.resealed > 0 || result.unreadable > 0) {
          logger.info(`Secret rotation: ${result.resealed} value(s) sealed again with the current key, ${result.unreadable} unreadable`)
        }
        return result
      },
      { timeout: 60_000, maxWait: 30_000 },
    ),
  )
}

/**
 * Values still sealed in the legacy format (no context bound, readable only
 * until Kledg 0.4, docs/configuration.md#ancien-format-de-chiffrement), by
 * kind. The start-up pass above seals every value it can open again in v2:
 * what remains is a value no configured key opens (the integration must be
 * reconnected), or a pass that did not run (no instance key, another server
 * holding the lock, an error in the log). Reads the format only (no key
 * needed), across every company.
 */
export interface LegacySecretsReport {
  total: number
  /** BankConnection.secretKeyEncrypted (former Qonto connections). */
  bankConnections: number
  /** Secret fields of Integration.credentials. */
  integrationFields: number
  /** UpdateConnection.tokenEncrypted (the GitHub token of the updates page). */
  updateTokens: number
}

export async function countLegacySecrets(): Promise<LegacySecretsReport> {
  return withSystemContext('secret-rotation', async () => {
    const legacy = (value: unknown) => typeof value === 'string' && value.length > 0 && isLegacySealed(value)
    const connections = await prisma.bankConnection.findMany({ where: { secretKeyEncrypted: { not: '' } }, select: { secretKeyEncrypted: true } })
    const integrations = await prisma.integration.findMany({ where: { credentialsEncrypted: true }, select: { provider: true, credentials: true } })
    const updates = await prisma.updateConnection.findMany({ select: { tokenEncrypted: true } })
    const bankConnections = connections.filter((row) => legacy(row.secretKeyEncrypted)).length
    let integrationFields = 0
    for (const row of integrations) {
      const credentials = row.credentials && typeof row.credentials === 'object' ? (row.credentials as Record<string, unknown>) : {}
      for (const field of SECRET_FIELDS[row.provider] ?? ['secretKey']) if (legacy(credentials[field])) integrationFields++
    }
    const updateTokens = updates.filter((row) => legacy(row.tokenEncrypted)).length
    return { total: bankConnections + integrationFields + updateTokens, bankConnections, integrationFields, updateTokens }
  })
}

/** Start-up check: warns in the log when legacy values remain after the re-encryption pass. */
export async function warnAboutLegacySecrets(): Promise<LegacySecretsReport> {
  const report = await countLegacySecrets()
  if (report.total > 0) {
    logger.warn(
      `Secrets in the legacy encryption format: ${report.total} (bank connections ${report.bankConnections}, integration fields ${report.integrationFields}, update tokens ${report.updateTokens}). ` +
        'Kledg 0.4 no longer reads them: run `pnpm secrets:reencrypt` (or restart the server) and reconnect the integrations it reports unreadable. See docs/configuration.md.',
    )
  }
  return report
}
