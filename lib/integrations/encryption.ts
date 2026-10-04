/**
 * Utilitaires de chiffrement génériques pour les intégrations
 * Utilise la même logique que Qonto (aes-256-gcm)
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const TAG_POSITION = SALT_LENGTH + IV_LENGTH;
const ENCRYPTED_POSITION = TAG_POSITION + TAG_LENGTH;

/**
 * Chiffre une valeur avec la clé de chiffrement
 */
export function encrypt(text: string, encryptionKey: string): string {
  if (!encryptionKey || encryptionKey.length !== 64) {
    throw new Error('Encryption key must be 64 characters (32 bytes hex)');
  }

  const key = Buffer.from(encryptionKey, 'hex');
  const iv = crypto.randomBytes(IV_LENGTH);
  const salt = crypto.randomBytes(SALT_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
}

/**
 * Déchiffre une valeur avec la clé de chiffrement
 */
export function decrypt(encryptedData: string, encryptionKey: string): string {
  if (!encryptionKey || encryptionKey.length !== 64) {
    throw new Error('Encryption key must be 64 characters (32 bytes hex)');
  }

  const key = Buffer.from(encryptionKey, 'hex');
  const data = Buffer.from(encryptedData, 'base64');

  const salt = data.subarray(0, SALT_LENGTH);
  const iv = data.subarray(SALT_LENGTH, TAG_POSITION);
  const tag = data.subarray(TAG_POSITION, ENCRYPTED_POSITION);
  const encrypted = data.subarray(ENCRYPTED_POSITION);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return decipher.update(encrypted) + decipher.final('utf8');
}
