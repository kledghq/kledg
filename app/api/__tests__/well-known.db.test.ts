/**
 * Public OAuth discovery documents of the MCP authorization server
 * (app/.well-known/**), against PostgreSQL: the Better Auth context seeds the
 * MCP resource on its first query. MCP clients (Claude, ChatGPT) read these
 * documents before anything else; a wrong endpoint or a missing scope makes
 * the connection fail before the user sees the consent page. Skipped without
 * the test database server.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('well_known')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

type Get = (request: Request) => Promise<Response>
let prisma: typeof import('@/lib/prisma').prisma
const routes = {} as Record<'authorizationServer' | 'protectedResource' | 'openid', Get>

async function read(get: Get, path: string) {
  const response = await get(new Request(`http://localhost:3000${path}`))
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

describe.skipIf(!available)('OAuth discovery documents', () => {
  beforeAll(async () => {
    await prepareTestDatabase('well_known')
    ;({ prisma } = await import('@/lib/prisma'))
    routes.authorizationServer = (await import('@/app/.well-known/oauth-authorization-server/[[...path]]/route')).GET
    routes.protectedResource = (await import('@/app/.well-known/oauth-protected-resource/[[...path]]/route')).GET
    routes.openid = (await import('@/app/.well-known/openid-configuration/[[...path]]/route')).GET
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('serves the RFC 8414 authorization server metadata with the Kledg scopes and dynamic registration', async () => {
    const { status, body } = await read(routes.authorizationServer, '/.well-known/oauth-authorization-server/api/auth')
    expect(status).toBe(200)
    expect(body.issuer).toBe('http://localhost:3000/api/auth')
    expect(body.authorization_endpoint).toBe('http://localhost:3000/api/auth/oauth2/authorize')
    expect(body.token_endpoint).toBe('http://localhost:3000/api/auth/oauth2/token')
    // Claude and ChatGPT register themselves (RFC 7591)
    expect(body.registration_endpoint).toBe('http://localhost:3000/api/auth/oauth2/register')
    expect(body.scopes_supported).toEqual(expect.arrayContaining(['kledg:read', 'kledg:write', 'kledg:admin', 'offline_access']))
    // OAuth 2.1: authorization code with PKCE S256 only
    expect(body.code_challenge_methods_supported).toEqual(['S256'])
    expect(body.response_types_supported).toEqual(['code'])
  })

  it('serves the OpenID configuration of the same issuer', async () => {
    const { status, body } = await read(routes.openid, '/.well-known/openid-configuration/api/auth')
    expect(status).toBe(200)
    expect(body.issuer).toBe('http://localhost:3000/api/auth')
    expect(body.jwks_uri).toBe('http://localhost:3000/api/auth/jwks')
    expect(body.userinfo_endpoint).toBe('http://localhost:3000/api/auth/oauth2/userinfo')
    expect(body.scopes_supported).toEqual(expect.arrayContaining(['openid', 'profile', 'email', 'kledg:read']))
  })

  it('describes /api/mcp as the protected resource (RFC 9728) with its own scopes only', async () => {
    const { status, body } = await read(routes.protectedResource, '/.well-known/oauth-protected-resource/api/mcp')
    expect(status).toBe(200)
    expect(body.resource).toBe('http://localhost:3000/api/mcp')
    expect(body.authorization_servers).toEqual(['http://localhost:3000/api/auth'])
    expect(body.scopes_supported).toEqual(['kledg:read', 'kledg:write', 'kledg:admin'])
  })
})
