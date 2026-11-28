/**
 * IMAP connection to a receipt mailbox (imapflow), with the guards a host
 * typed by a user needs:
 * - TLS from the first byte, port 993 only (IMAPS, RFC 8314): the password
 *   or the token never travels before encryption, and the certificate is
 *   checked against the host name;
 * - the connection only opens to a public address, checked in the lookup
 *   of the socket (lib/integrations/public-https-fetch.ts, publicOnlyLookup):
 *   a host that resolves to 127.0.0.1, a private network or a cloud metadata
 *   address is refused, a DNS rebinding included, so the server running
 *   Kledg cannot be turned against its own network;
 * - bounded waits (connection, greeting, socket) and literals (maxLiteralSize):
 *   a slow or hostile server cannot hold a job or its memory.
 */

import { ImapFlow } from 'imapflow'
import { publicOnlyLookup } from '@/lib/integrations/public-https-fetch'
import { RECEIPT_MAX_BYTES } from '../file-type'

export const IMAPS_PORT = 993

export interface MailboxServer {
  host: string
  username: string
}

export type MailboxSecret = { password: string } | { accessToken: string }

/** A literal larger than a receipt and its base64 overhead is never buffered. */
const MAX_LITERAL_BYTES = Math.ceil((RECEIPT_MAX_BYTES * 4) / 3) + 64 * 1024

export function openMailboxClient(server: MailboxServer, secret: MailboxSecret): ImapFlow {
  return new ImapFlow({
    host: server.host,
    port: IMAPS_PORT,
    secure: true,
    auth: 'password' in secret ? { user: server.username, pass: secret.password } : { user: server.username, accessToken: secret.accessToken },
    tls: { lookup: publicOnlyLookup(), rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
    maxLiteralSize: MAX_LITERAL_BYTES,
    clientInfo: { name: 'Kledg' },
  })
}

/** A host name as typed: lower case, without scheme, path or port. */
export function normalizeHost(value: string): string | null {
  const host = value.trim().toLowerCase().replace(/^imaps?:\/\//, '').replace(/[/:].*$/, '')
  return /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ? host : null
}
