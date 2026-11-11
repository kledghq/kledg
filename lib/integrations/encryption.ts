/**
 * Secrets at rest (bank credentials, GitHub token): AES-256-GCM under the
 * instance key (lib/crypto/encryption-key.ts).
 *
 * Format v2 (written since KLEDG-R3-INPUT-06): `v2:` + base64(iv 12 bytes,
 * tag 16 bytes, ciphertext), with additional authenticated data naming where
 * the value lives (table, owner, field: see the *Context helpers below). A
 * value copied into another row or field no longer opens, so whoever can
 * write the database cannot move a company's secret into another company's
 * integration. The tag is always 16 bytes (a truncated value is refused).
 *
 * Legacy format (no prefix): base64(salt 64 bytes, iv 16, tag 16,
 * ciphertext), no additional data. Base64 never contains `:`, so the two
 * formats cannot be confused. Since Kledg 0.4, `decrypt` refuses it
 * (LegacySecretError): a legacy value is bound to no row, so one copied into
 * another company's row would open there. Only the re-encryption pass
 * (lib/crypto/reencrypt.ts: server start, `pnpm secrets:reencrypt`) reads it,
 * through decryptForReencryption, to seal it again in v2.
 */

import crypto from 'crypto'
import { ValidationError } from '@/lib/accounting/errors'

const ALGORITHM = 'aes-256-gcm'
const TAG_LENGTH = 16

const V2_PREFIX = 'v2:'
const V2_IV_LENGTH = 12

const LEGACY_IV_LENGTH = 16
const LEGACY_SALT_LENGTH = 64
const LEGACY_TAG_POSITION = LEGACY_SALT_LENGTH + LEGACY_IV_LENGTH
const LEGACY_ENCRYPTED_POSITION = LEGACY_TAG_POSITION + TAG_LENGTH

function keyBytes(encryptionKey: string): Buffer {
  if (!encryptionKey || encryptionKey.length !== 64) {
    throw new Error('Encryption key must be 64 characters (32 bytes hex)')
  }
  return Buffer.from(encryptionKey, 'hex')
}

function aad(context: string): Buffer {
  return Buffer.from(`kledg-secret:${context}`, 'utf8')
}

/**
 * Seals a value. `context` names where it is stored (bankConnectionContext,
 * integrationContext, UPDATE_TOKEN_CONTEXT); decrypt needs the same one.
 */
export function encrypt(text: string, encryptionKey: string, context: string): string {
  const key = keyBytes(encryptionKey)
  const iv = crypto.randomBytes(V2_IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH })
  cipher.setAAD(aad(context))
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return V2_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')
}

/**
 * A value still in the legacy format, refused outside the re-encryption pass.
 * The message names the command that seals it again (docs/configuration.md).
 */
export class LegacySecretError extends ValidationError {
  constructor() {
    super(
      "Ce secret est enregistré dans l'ancien format de chiffrement, que Kledg ne lit plus. L'administrateur de l'instance doit lancer `pnpm secrets:reencrypt` (ou redémarrer le serveur), puis reconnecter l'intégration si elle reste illisible.",
    )
    this.name = 'LegacySecretError'
  }
}

/**
 * Opens a v2 value sealed for `context`. Throws when the key, the context or
 * the value is wrong, and LegacySecretError for a value in the legacy format.
 */
export function decrypt(encryptedData: string, encryptionKey: string, context: string): string {
  if (isLegacySealed(encryptedData)) throw new LegacySecretError()
  return decryptV2(encryptedData, keyBytes(encryptionKey), context)
}

/**
 * Opens a v2 value, or a legacy one (bound to no context). For the
 * re-encryption pass only (lib/crypto/reencrypt.ts), which seals what it
 * opens again in v2: everything else uses decrypt.
 */
export function decryptForReencryption(encryptedData: string, encryptionKey: string, context: string): string {
  const key = keyBytes(encryptionKey)
  if (!isLegacySealed(encryptedData)) return decryptV2(encryptedData, key, context)
  const data = Buffer.from(encryptedData, 'base64')
  // Salt, iv and a full 16 byte tag: a truncated value would leave a shorter tag
  if (data.length < LEGACY_ENCRYPTED_POSITION) throw new Error('Sealed value too short')
  const iv = data.subarray(LEGACY_SALT_LENGTH, LEGACY_TAG_POSITION)
  const tag = data.subarray(LEGACY_TAG_POSITION, LEGACY_ENCRYPTED_POSITION)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH })
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data.subarray(LEGACY_ENCRYPTED_POSITION)), decipher.final()]).toString('utf8')
}

function decryptV2(encryptedData: string, key: Buffer, context: string): string {
  const data = Buffer.from(encryptedData.slice(V2_PREFIX.length), 'base64')
  if (data.length < V2_IV_LENGTH + TAG_LENGTH) throw new Error('Sealed value too short')
  const iv = data.subarray(0, V2_IV_LENGTH)
  const tag = data.subarray(V2_IV_LENGTH, V2_IV_LENGTH + TAG_LENGTH)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH })
  decipher.setAAD(aad(context))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data.subarray(V2_IV_LENGTH + TAG_LENGTH)), decipher.final()]).toString('utf8')
}

/** A value in the legacy format (no context bound), to seal again in v2. */
export function isLegacySealed(encryptedData: string): boolean {
  return !encryptedData.startsWith(V2_PREFIX)
}

/** Context of BankConnection.secretKeyEncrypted (unique per company and provider). */
export function bankConnectionContext(companyId: string, provider: string): string {
  return `bank_connections:${companyId}:${provider}:secretKeyEncrypted`
}

/** Context of a secret field of Integration.credentials (lib/banking/credentials.ts). */
export function integrationContext(companyId: string, provider: string, field: string): string {
  return `integrations:${companyId}:${provider}:credentials.${field}`
}

/** Context of UpdateConnection.tokenEncrypted (a single row, id "default"). */
export const UPDATE_TOKEN_CONTEXT = 'update_connection:default:tokenEncrypted'
