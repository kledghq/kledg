/**
 * Keys of stored objects: `<namespace>/<companyId>/<random>`. The company
 * is in the key, so a company's objects can be listed and deleted together;
 * the random part (24 bytes, base64url) makes a key impossible to guess,
 * even for someone who has the file (a key never holds the file's SHA-256).
 * Deduplication stays in the database (receipt_files: one row per content
 * in a company).
 */

import { randomBytes } from 'node:crypto'
import { assertObjectKey } from './types'

export function newObjectKey(namespace: string, companyId: string): string {
  return assertObjectKey(`${namespace}/${companyId}/${randomBytes(24).toString('base64url')}`)
}
