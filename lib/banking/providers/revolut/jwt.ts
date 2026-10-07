/**
 * Client assertion for the Revolut Business token endpoint (RFC 7523,
 * private_key_jwt), signed RS256 with the key whose certificate was uploaded
 * in Revolut Business.
 * https://developer.revolut.com/docs/guides/manage-accounts/get-started/make-your-first-api-request
 *
 * Claims expected by Revolut:
 * - iss: the domain of the OAuth redirect URI, without "https://"
 * - sub: the client id Revolut gave when the certificate was added
 * - aud: "https://revolut.com"
 * - exp: expiry (unix seconds); kept short since a new assertion is signed per call
 */

import { sign } from 'crypto'

const REVOLUT_JWT_AUDIENCE = 'https://revolut.com'
export const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'

const base64url = (data: Buffer | string) => Buffer.from(data).toString('base64url')

/** Domain of the redirect URI, the JWT issuer ("https://kledg.example.com/x" gives "kledg.example.com"). */
export function issuerFromRedirectUri(redirectUri: string): string {
  return new URL(redirectUri).host
}

export function buildClientAssertion(options: {
  clientId: string
  issuer: string
  privateKeyPem: string
  now?: Date
  ttlSeconds?: number
}): string {
  const iat = Math.floor((options.now ?? new Date()).getTime() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: options.issuer,
    sub: options.clientId,
    aud: REVOLUT_JWT_AUDIENCE,
    iat,
    exp: iat + (options.ttlSeconds ?? 300),
  }
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), options.privateKeyPem)
  return `${signingInput}.${base64url(signature)}`
}
