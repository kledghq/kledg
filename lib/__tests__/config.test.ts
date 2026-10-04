/**
 * Public URL and trusted origins of the instance (lib/config.ts): explicit
 * BETTER_AUTH_URL first, then the default URL each host gives the
 * deployment, never anything that is not a plain http(s) origin.
 */

import { describe, expect, it } from 'vitest'
import { getAppUrl, getTrustedOrigins } from '../config'

const prod = { NODE_ENV: 'production' }

describe('getAppUrl', () => {
  it('prefers BETTER_AUTH_URL, without its trailing slash', () => {
    expect(getAppUrl({ BETTER_AUTH_URL: 'https://compta.example.fr/', RAILWAY_PUBLIC_DOMAIN: 'kledg.up.railway.app' })).toBe(
      'https://compta.example.fr',
    )
    expect(getAppUrl({ NEXT_PUBLIC_APP_URL: 'https://compta.example.fr' })).toBe('https://compta.example.fr')
  })

  it('falls back to the Vercel production URL, then the deployment URL', () => {
    expect(getAppUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'kledg.vercel.app', VERCEL_URL: 'kledg-abc.vercel.app' })).toBe(
      'https://kledg.vercel.app',
    )
    expect(getAppUrl({ VERCEL_URL: 'kledg-abc.vercel.app' })).toBe('https://kledg-abc.vercel.app')
  })

  it('uses the Railway public domain', () => {
    expect(getAppUrl({ RAILWAY_PUBLIC_DOMAIN: 'kledg-production.up.railway.app' })).toBe('https://kledg-production.up.railway.app')
  })

  it('uses the Render external URL', () => {
    expect(getAppUrl({ RENDER: 'true', RENDER_EXTERNAL_URL: 'https://kledg.onrender.com' })).toBe('https://kledg.onrender.com')
  })

  it('derives the fly.dev host from the Fly.io app name', () => {
    expect(getAppUrl({ FLY_APP_NAME: 'kledg-acme' })).toBe('https://kledg-acme.fly.dev')
  })

  it('uses the first Coolify URL', () => {
    expect(getAppUrl({ COOLIFY_URL: 'https://compta.example.fr,https://kledg.example.fr' })).toBe('https://compta.example.fr')
  })

  it('ignores values that are not a bare host or an http(s) origin', () => {
    expect(getAppUrl({ RAILWAY_PUBLIC_DOMAIN: 'evil.com/path' })).toBe('http://localhost:3000')
    expect(getAppUrl({ RAILWAY_PUBLIC_DOMAIN: 'user@evil.com' })).toBe('http://localhost:3000')
    expect(getAppUrl({ RENDER_EXTERNAL_URL: 'http://kledg.onrender.com' })).toBe('http://localhost:3000')
    expect(getAppUrl({ RENDER_EXTERNAL_URL: 'javascript:alert(1)' })).toBe('http://localhost:3000')
    expect(getAppUrl({ FLY_APP_NAME: 'Kledg.evil.com' })).toBe('http://localhost:3000')
    expect(getAppUrl({ COOLIFY_URL: 'ftp://kledg.example.fr' })).toBe('http://localhost:3000')
    expect(getAppUrl({ COOLIFY_URL: 'https://user:pass@kledg.example.fr' })).toBe('http://localhost:3000')
  })

  it('keeps only the origin of a URL with a path', () => {
    expect(getAppUrl({ COOLIFY_URL: 'https://kledg.example.fr/app' })).toBe('https://kledg.example.fr')
  })

  it('falls back to localhost', () => {
    expect(getAppUrl({})).toBe('http://localhost:3000')
  })
})

describe('getTrustedOrigins', () => {
  it('trusts the custom domain and the default domain of the host', () => {
    expect(getTrustedOrigins({ ...prod, BETTER_AUTH_URL: 'https://compta.example.fr', RENDER_EXTERNAL_URL: 'https://kledg.onrender.com' })).toEqual([
      'https://compta.example.fr',
      'https://kledg.onrender.com',
    ])
    expect(getTrustedOrigins({ ...prod, BETTER_AUTH_URL: 'https://compta.example.fr', FLY_APP_NAME: 'kledg' })).toEqual([
      'https://compta.example.fr',
      'https://kledg.fly.dev',
    ])
  })

  it('trusts Vercel preview and branch URLs', () => {
    expect(
      getTrustedOrigins({
        ...prod,
        VERCEL_PROJECT_PRODUCTION_URL: 'kledg.vercel.app',
        VERCEL_URL: 'kledg-abc.vercel.app',
        VERCEL_BRANCH_URL: 'kledg-git-main.vercel.app',
      }),
    ).toEqual(['https://kledg.vercel.app', 'https://kledg-abc.vercel.app', 'https://kledg-git-main.vercel.app'])
  })

  it('adds localhost outside production only', () => {
    expect(getTrustedOrigins({ ...prod })).toEqual(['http://localhost:3000'])
    expect(getTrustedOrigins({ NODE_ENV: 'development', BETTER_AUTH_URL: 'https://compta.example.fr' })).toEqual([
      'https://compta.example.fr',
      'http://localhost:3000',
    ])
  })
})
