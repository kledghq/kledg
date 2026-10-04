/**
 * Pages the instance policy opens without a session (PUBLIC_PAGES,
 * lib/instance/policy.ts): the request proxy lets them through like /login,
 * every other page still redirects to /login. Kledg declares none.
 */

import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const pages = vi.hoisted(() => ({ list: [] as string[] }))

vi.mock('@/lib/instance/policy', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/instance/policy')>()
  return {
    ...real,
    get PUBLIC_PAGES() {
      return pages.list
    },
  }
})

import * as policy from '../policy'
import { isInstancePublicPage } from '../api-paths'
import { proxy } from '@/proxy'

describe('public pages of the instance', () => {
  it('are none in Kledg', async () => {
    const real = await vi.importActual<typeof import('../policy')>('../policy')
    expect(real.PUBLIC_PAGES).toEqual([])
    expect(isInstancePublicPage('/signup', real.PUBLIC_PAGES)).toBe(false)
  })

  it('match the page and the paths under it, never a longer name', () => {
    expect(isInstancePublicPage('/signup', ['/signup'])).toBe(true)
    expect(isInstancePublicPage('/signup/verified', ['/signup'])).toBe(true)
    expect(isInstancePublicPage('/signups', ['/signup'])).toBe(false)
    expect(isInstancePublicPage('/companies', ['/signup'])).toBe(false)
  })

  it('are let through by the proxy without a session; other pages still redirect to /login', async () => {
    pages.list = ['/signup', '/legal']
    expect(policy.PUBLIC_PAGES).toEqual(['/signup', '/legal'])
    expect((await proxy(new NextRequest('http://localhost/signup'))).status).toBe(200)
    expect((await proxy(new NextRequest('http://localhost/legal/cgu'))).status).toBe(200)
    const other = await proxy(new NextRequest('http://localhost/companies'))
    expect(other.status).toBe(307)
    expect(other.headers.get('location')).toBe('http://localhost/login?redirect=%2Fcompanies')
    pages.list = []
    expect((await proxy(new NextRequest('http://localhost/signup'))).status).toBe(307)
  })
})
