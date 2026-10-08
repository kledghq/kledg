#!/usr/bin/env tsx
/**
 * Seals again, in the current format (v2, bound to its row) and with the
 * current key, every secret stored in the legacy format or with an older
 * auth secret, then reports what remains in the legacy format. The same pass
 * runs at every server start (lib/crypto/reencrypt.ts); this script runs it
 * on demand, before upgrading to Kledg 0.4, which no longer reads the legacy
 * format (docs/configuration.md#ancien-format-de-chiffrement).
 *
 *   pnpm secrets:reencrypt
 *
 * Uses the instance's own environment (DATABASE_URL, BETTER_AUTH_SECRET or
 * ENCRYPTION_KEY, and BETTER_AUTH_SECRETS during a rotation). Idempotent.
 * Exit code 1 when legacy values remain (each one is a value no configured
 * key opens: reconnect that bank integration, or the GitHub connection of
 * the updates page).
 */

import 'dotenv/config'
import { countLegacySecrets, reencryptStoredSecrets } from '@/lib/crypto/reencrypt'
import { prisma } from '@/lib/prisma'

async function main() {
  const result = await reencryptStoredSecrets()
  if (result === null) {
    console.error('No instance key (ENCRYPTION_KEY or BETTER_AUTH_SECRET), or another server holds the re-encryption lock: nothing sealed again.')
  } else {
    console.log(`Sealed again: ${result.resealed}. Unreadable with the configured keys: ${result.unreadable}.`)
  }
  const legacy = await countLegacySecrets()
  console.log(
    `Remaining in the legacy format: ${legacy.total} (bank connections ${legacy.bankConnections}, integration fields ${legacy.integrationFields}, update tokens ${legacy.updateTokens}).`,
  )
  return legacy.total === 0 && result !== null ? 0 : 1
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
