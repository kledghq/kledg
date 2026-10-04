import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountApi } from '../account-api'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('accountApi', () => {
  it('sends a JSON body with its content type and never caches', async () => {
    fetchMock.mockResolvedValue(Response.json({ name: 'Marie' }))
    const result = await accountApi<{ name: string }>('/api/account/profile', { method: 'PATCH', body: { name: 'Marie' } })
    expect(result).toEqual({ name: 'Marie' })
    expect(fetchMock).toHaveBeenCalledWith('/api/account/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"Marie"}',
      cache: 'no-store',
    })
  })

  it('makes a GET without body nor content type by default', async () => {
    fetchMock.mockResolvedValue(Response.json([]))
    await accountApi('/api/account/sessions')
    expect(fetchMock).toHaveBeenCalledWith('/api/account/sessions', {
      method: 'GET',
      headers: undefined,
      body: undefined,
      cache: 'no-store',
    })
  })

  it('returns undefined on 204 No Content', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(accountApi('/api/account/sessions', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('throws the French message of the route on an error response', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'Mot de passe incorrect' }, { status: 400 }))
    await expect(accountApi('/api/account/password', { method: 'POST', body: {} })).rejects.toThrow('Mot de passe incorrect')
  })

  it('falls back to a generic message when the error body is not JSON or has no message', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>502</html>', { status: 502 }))
    await expect(accountApi('/api/account')).rejects.toThrow('La requête a échoué. Réessayez.')
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: 42 } }, { status: 500 }))
    await expect(accountApi('/api/account')).rejects.toThrow('La requête a échoué. Réessayez.')
  })

  it('returns null for a successful response without JSON body', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }))
    await expect(accountApi('/api/account')).resolves.toBeNull()
  })
})
