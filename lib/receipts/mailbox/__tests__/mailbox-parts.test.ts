/**
 * The receipt mailbox, without a server: the attachments found in an
 * email's MIME structure (a forwarded invoice included, a signature logo
 * left out), the host as typed, the connection options (TLS on 993 only,
 * public addresses only) and the French messages of a failed connection.
 */

import type { LookupAddress } from 'node:dns'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { attachmentParts } from '../parts'
import { IMAPS_PORT, normalizeHost, openMailboxClient } from '../imap-client'

describe('attachments of a message', () => {
  it('takes the named parts, a forwarded message included, never an inline logo nor the body', () => {
    const structure = {
      type: 'multipart/mixed',
      childNodes: [
        {
          type: 'multipart/related',
          part: '1',
          childNodes: [
            { part: '1.1', type: 'text/html' },
            { part: '1.2', type: 'image/png', id: '<logo@ovh>', disposition: 'inline', dispositionParameters: { filename: 'logo.png' } },
          ],
        },
        { part: '2', type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'facture.pdf' }, size: 40_000 },
        {
          part: '3',
          type: 'message/rfc822',
          childNodes: [
            {
              type: 'multipart/mixed',
              part: '3',
              childNodes: [
                { part: '3.1', type: 'text/plain' },
                { part: '3.2', type: 'image/jpeg', parameters: { name: 'ticket.jpg' } },
              ],
            },
          ],
        },
        { part: '4', type: 'application/octet-stream', disposition: 'attachment' },
      ],
    }
    expect(attachmentParts(structure)).toEqual([
      { part: '1.2', fileName: 'logo.png', contentType: 'image/png', inline: true, size: null },
      { part: '2', fileName: 'facture.pdf', contentType: 'application/pdf', inline: false, size: 40_000 },
      { part: '3.2', fileName: 'ticket.jpg', contentType: 'image/jpeg', inline: false, size: null },
      { part: '4', fileName: 'justificatif', contentType: 'application/octet-stream', inline: false, size: null },
    ])
    expect(attachmentParts(undefined)).toEqual([])
  })
})

describe('the IMAP connection', () => {
  it('reads the host as typed, and refuses what is not a host name', () => {
    expect(normalizeHost(' IMAPS://Imap.Gmail.com:993/ ')).toBe('imap.gmail.com')
    expect(normalizeHost('ssl0.ovh.net')).toBe('ssl0.ovh.net')
    expect(normalizeHost('127.0.0.1')).toBeNull()
    expect(normalizeHost('localhost')).toBeNull()
    expect(normalizeHost('imap example.fr')).toBeNull()
  })

  it('connects with TLS on 993, and only to a public address', async () => {
    const client = openMailboxClient({ host: 'imap.example.fr', username: 'compta@example.fr' }, { password: 'secret' })
    expect(client.options).toMatchObject({ host: 'imap.example.fr', port: IMAPS_PORT, secure: true, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' } })
    const lookup = client.options.tls?.lookup as unknown as (host: string, options: object, callback: (error: Error | null, address?: string | LookupAddress[]) => void) => void
    // localhost resolves to a loopback address: refused before any connection
    const error = await new Promise<Error | null>((resolve) => lookup('localhost', { all: true }, (e) => resolve(e)))
    expect(error?.name).toBe('BlockedAddressError')
  })
})
