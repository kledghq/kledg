/**
 * Sign out (app/auth/signout/route.ts): a same-origin POST signs out and
 * clears the cookies; a GET or a request from another site never signs out
 * and lands on the confirmation page. Better Auth is mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const signOut = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth', () => ({ auth: { api: { signOut } } }))

import { GET, POST } from '@/app/auth/signout/route'

const ORIGIN = 'http://localhost:3000'

function request(method: 'GET' | 'POST', headers: Record<string, string> = {}) {
  return new NextRequest(`${ORIGIN}/auth/signout`, {
    method,
    headers: { cookie: 'better-auth.session_token=abc', ...headers },
  })
}

describe('sign out', () => {
  beforeEach(() => {
    signOut.mockReset()
    const headers = new Headers()
    headers.append('set-cookie', 'better-auth.session_token=; Max-Age=0; Path=/')
    headers.append('set-cookie', 'better-auth.session_data=; Max-Age=0; Path=/')
    signOut.mockResolvedValue({ headers })
  })

  it('signs out on a same-origin POST, clears the session cookies and goes to /login', async () => {
    const response = await POST(request('POST', { origin: ORIGIN, 'sec-fetch-site': 'same-origin' }))
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login`)
    const cookies = response.headers.getSetCookie()
    expect(cookies.some((c) => c.startsWith('better-auth.session_token=;'))).toBe(true)
    expect(cookies.some((c) => c.startsWith('better-auth.session_data=;'))).toBe(true)
  })

  it('never signs out on a GET: an image or a link on another site cannot log the user out', async () => {
    const response = await GET(request('GET', { 'sec-fetch-site': 'cross-site' }))
    expect(signOut).not.toHaveBeenCalled()
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${ORIGIN}/auth/signout/confirm`)
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it.each([
    ['another origin', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }],
    ['a sibling site', { 'sec-fetch-site': 'same-site' }],
    ['a forged origin only', { origin: 'https://evil.example' }],
  ])('refuses a POST from %s and asks to confirm instead', async (_label, headers) => {
    const response = await POST(request('POST', headers))
    expect(signOut).not.toHaveBeenCalled()
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${ORIGIN}/auth/signout/confirm`)
  })

  it('still goes to /login when there was no session to revoke', async () => {
    signOut.mockRejectedValue(new Error('FAILED_TO_GET_SESSION'))
    const response = await POST(request('POST', { origin: ORIGIN }))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login`)
  })
})
