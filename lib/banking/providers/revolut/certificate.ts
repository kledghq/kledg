/**
 * Key pair and self-signed X.509 certificate for the Revolut Business API.
 *
 * Revolut asks for an RSA private key and a public X.509 certificate: the
 * certificate is uploaded in Revolut Business (Settings > APIs > Business
 * API), the private key signs the client assertion JWT.
 * https://developer.revolut.com/docs/guides/manage-accounts/get-started/make-your-first-api-request
 * (the guide uses `openssl genrsa` and `openssl req -new -x509`).
 *
 * Node's crypto creates keys but not certificates, so the certificate is
 * encoded here in DER (RFC 5280 version 3, with the subject key identifier,
 * authority key identifier and basic constraints extensions that
 * `openssl req -x509` adds by default) and signed with
 * sha256WithRSAEncryption. Kept dependency free on purpose.
 */

import { createHash, generateKeyPairSync, randomBytes, sign } from 'crypto'

// --- Minimal DER encoder ----------------------------------------------------

function length(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n])
  const bytes: number[] = []
  while (n > 0) {
    bytes.unshift(n & 0xff)
    n >>= 8
  }
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

function tlv(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), length(value.length), value])
}

const sequence = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items))
const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items))
const nullValue = () => Buffer.from([0x05, 0x00])
const utf8String = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'))
const bitString = (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0x00]), b]))
const octetString = (b: Buffer) => tlv(0x04, b)
const boolean = (v: boolean) => Buffer.from([0x01, 0x01, v ? 0xff : 0x00])
/** Context specific tag: [n] EXPLICIT (constructed) or IMPLICIT primitive. */
const explicit = (n: number, value: Buffer) => tlv(0xa0 + n, value)
const implicit = (n: number, value: Buffer) => tlv(0x80 + n, value)

function integer(b: Buffer): Buffer {
  // Positive INTEGER: strip leading zeros, then prefix 0x00 if the high bit is set
  let i = 0
  while (i < b.length - 1 && b[i] === 0) i++
  let v = b.subarray(i)
  if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0x00]), v])
  return tlv(0x02, v)
}

function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number)
  const bytes = [40 * parts[0] + parts[1]]
  for (const part of parts.slice(2)) {
    const chunk: number[] = []
    let n = part
    chunk.unshift(n & 0x7f)
    n = Math.floor(n / 128)
    while (n > 0) {
      chunk.unshift((n & 0x7f) | 0x80)
      n = Math.floor(n / 128)
    }
    bytes.push(...chunk)
  }
  return tlv(0x06, Buffer.from(bytes))
}

/** UTCTime until 2049, GeneralizedTime after (RFC 5280 4.1.2.5). */
function time(date: Date): Buffer {
  const iso = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) // YYYYMMDDHHMMSS
  const year = date.getUTCFullYear()
  return year < 2050 ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${iso}Z`))
}

const SHA256_WITH_RSA = '1.2.840.113549.1.1.11'
const SUBJECT_KEY_IDENTIFIER = '2.5.29.14'
const AUTHORITY_KEY_IDENTIFIER = '2.5.29.35'
const BASIC_CONSTRAINTS = '2.5.29.19'
const COMMON_NAME = '2.5.4.3'
const ORGANIZATION = '2.5.4.10'

function name(commonName: string, organization: string): Buffer {
  return sequence(
    set(sequence(oid(ORGANIZATION), utf8String(organization))),
    set(sequence(oid(COMMON_NAME), utf8String(commonName))),
  )
}

function pem(label: string, der: Buffer): string {
  const body = der.toString('base64').match(/.{1,64}/g)?.join('\n') ?? ''
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`
}

export interface RevolutKeyMaterial {
  /** PKCS#8 PEM, to store encrypted. */
  privateKeyPem: string
  /** X.509 PEM, to paste in Revolut Business. */
  certificatePem: string
  /** Certificate expiry. */
  notAfter: Date
}

/**
 * RSA 2048 key pair and a self-signed certificate valid `validityDays`
 * (Revolut's guide uses 1825 days, five years).
 */
export function generateRevolutKeyMaterial(options: {
  commonName: string
  organization?: string
  validityDays?: number
  now?: Date
}): RevolutKeyMaterial {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const now = options.now ?? new Date()
  const notBefore = new Date(Math.floor(now.getTime() / 1000) * 1000 - 60_000)
  const notAfter = new Date(notBefore.getTime() + (options.validityDays ?? 1825) * 86_400_000)
  const subject = name(options.commonName, options.organization ?? 'Kledg')
  const algorithm = sequence(oid(SHA256_WITH_RSA), nullValue())
  const serial = randomBytes(16)
  serial[0] &= 0x7f

  const spki = publicKey.export({ type: 'spki', format: 'der' })
  // Key identifier: SHA-1 of the subjectPublicKey bits (RFC 5280 4.2.1.2, method 1)
  const keyBits = publicKey.export({ type: 'pkcs1', format: 'der' })
  const keyId = createHash('sha1').update(keyBits).digest()
  const extensions = explicit(
    3,
    sequence(
      sequence(oid(SUBJECT_KEY_IDENTIFIER), octetString(octetString(keyId))),
      sequence(oid(AUTHORITY_KEY_IDENTIFIER), octetString(sequence(implicit(0, keyId)))),
      sequence(oid(BASIC_CONSTRAINTS), boolean(true), octetString(sequence(boolean(true)))),
    ),
  )

  const tbs = sequence(
    explicit(0, integer(Buffer.from([2]))), // version 3
    integer(serial),
    algorithm,
    subject, // issuer: self-signed
    sequence(time(notBefore), time(notAfter)),
    subject,
    spki,
    extensions,
  )
  const signature = sign('sha256', tbs, privateKey)
  const certificate = sequence(tbs, algorithm, bitString(signature))

  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    certificatePem: pem('CERTIFICATE', certificate),
    notAfter,
  }
}
