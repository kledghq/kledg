/**
 * The token of a receipt address (pure module): 16 characters from 36,
 * about 82 bits, so the address cannot be guessed; the database checks the
 * same pattern (companies_receipt_inbox_token_check).
 */

import { randomInt } from 'node:crypto'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const TOKEN_LENGTH = 16

export function newInboxToken(): string {
  let token = ''
  for (let i = 0; i < TOKEN_LENGTH; i++) token += ALPHABET[randomInt(ALPHABET.length)]
  return token
}

/** The token of a receipt address of this instance ("token@domain", or "token+anything@domain"), else null. */
export function inboxTokenOf(recipient: string, domain: string): string | null {
  const at = recipient.lastIndexOf('@')
  if (at < 0 || recipient.slice(at + 1).toLowerCase() !== domain) return null
  const local = recipient.slice(0, at).toLowerCase().split('+')[0]
  return /^[a-z0-9]{16}$/.test(local) ? local : null
}
