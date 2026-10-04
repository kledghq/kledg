/**
 * Bank picker list of lib/banking/ponto-connection.service.ts
 * (listPontoInstitutions), with an injected fetch (no network): deprecated
 * banks and the banks Kledg connects directly (Qonto, Revolut) are left out,
 * names are sorted the French way, and the list is kept 24 hours per country.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())

import { clearInstitutionsCache, listPontoInstitutions } from '@/lib/banking/ponto-connection.service'

const institution = (id: string, name: string, deprecated = false) => ({
  id,
  type: 'financialInstitution',
  attributes: { name, status: 'stable', deprecated, country: 'FR', logoUrl: null, primaryColor: null, expectedAuthorizationLifetime: 180 },
})

const page = {
  data: [
    institution('i-1', 'Société Générale'),
    institution('i-2', 'Qonto'),
    institution('i-3', 'Revolut Business'),
    institution('i-4', 'Crédit Agricole'),
    institution('i-5', 'Ancienne banque', true),
    institution('i-6', 'BNP Paribas'),
    institution('i-7', 'Écureuil Caisse d’Épargne'),
  ],
  links: {},
  meta: { paging: { limit: 100 } },
}

function fakeFetch() {
  const urls: string[] = []
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    urls.push(String(input))
    return new Response(JSON.stringify(page), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  return { urls, fetch: fetchImpl as unknown as typeof fetch }
}

const NOW = Date.UTC(2026, 9, 4, 8, 0, 0)

beforeEach(() => clearInstitutionsCache())

describe('listPontoInstitutions', () => {
  it('leaves out deprecated and directly connected banks and sorts names the French way', async () => {
    const { fetch } = fakeFetch()
    const list = await listPontoInstitutions('FR', { fetch, now: NOW })
    expect(list.map((i) => i.name)).toEqual(['BNP Paribas', 'Crédit Agricole', 'Écureuil Caisse d’Épargne', 'Société Générale'])
    expect(list[0]).toEqual({ id: 'i-6', name: 'BNP Paribas', country: 'FR', logoUrl: null, primaryColor: null, status: 'stable', expectedAuthorizationLifetime: 180 })
  })

  it('keeps the list 24 hours for a country, then reads it again', async () => {
    const { urls, fetch } = fakeFetch()
    await listPontoInstitutions('FR', { fetch, now: NOW })
    await listPontoInstitutions('FR', { fetch, now: NOW + 24 * 3_600_000 - 1 })
    expect(urls).toHaveLength(1)
    await listPontoInstitutions('FR', { fetch, now: NOW + 24 * 3_600_000 })
    expect(urls).toHaveLength(2)
  })

  it('reads again for another country', async () => {
    const { urls, fetch } = fakeFetch()
    await listPontoInstitutions('FR', { fetch, now: NOW })
    await listPontoInstitutions('BE', { fetch, now: NOW })
    expect(urls.map((u) => new URL(u).searchParams.get('filter[country][eq]'))).toEqual(['FR', 'BE'])
  })
})
