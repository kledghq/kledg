/**
 * SIREN lookup in the public company directory (API Recherche d'entreprises).
 * Fixtures follow the shape the API returned on 2026-10-03
 * (GET /search?q=<siren>&minimal=true&include=siege), with fictitious
 * companies. No network: fetch is injected.
 */

import { describe, expect, it, vi } from 'vitest'
import sas from './fixtures/recherche-entreprises-sas.json'
import sciOtherFirst from './fixtures/recherche-entreprises-sci-other-first.json'
import { mapSearchResponse, normalizeSiren, sirenChecksumValid } from '../siren-lookup'
import { lookupSiren, RECHERCHE_ENTREPRISES_API } from '../lookup-siren.service'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('mapSearchResponse', () => {
  it('maps name, legal form, NAF code, creation date and head office', () => {
    expect(mapSearchResponse('912345675', sas)).toEqual({
      siren: '912345675',
      name: 'ATELIER LUMEN',
      legalType: 'SAS',
      natureJuridique: '5710',
      activityCode: '74.10Z',
      creationDate: '2025-03-14',
      active: true,
      headOffice: {
        siret: '91234567500012',
        street: '12 BIS RUE DES ARTISANS',
        street2: 'BATIMENT B',
        postalCode: '69007',
        city: 'LYON',
      },
    })
  })

  it('only takes the exact SIREN, not the first result of the text search', () => {
    const result = mapSearchResponse('552100009', sciOtherFirst)
    expect(result?.name).toBe('SCI LES TILLEULS')
    expect(result?.legalType).toBe('SCI')
    expect(result?.active).toBe(false)
    // No structured street: the one-line address without postal code and city
    expect(result?.headOffice).toEqual({
      siret: null,
      street: 'LIEU DIT LES TILLEULS',
      street2: null,
      postalCode: '24200',
      city: 'SARLAT-LA-CANEDA',
    })
    expect(mapSearchResponse('912345683', sciOtherFirst)?.legalType).toBe('SARL')
  })

  it('returns null when the SIREN is not among the results', () => {
    expect(mapSearchResponse('123456782', sas)).toBeNull()
    expect(mapSearchResponse('912345675', { results: [] })).toBeNull()
  })

  it('drops a malformed creation date', () => {
    const odd = { results: [{ ...sas.results[0], date_creation: '14/03/2025' }] }
    expect(mapSearchResponse('912345675', odd)?.creationDate).toBeNull()
  })
})

describe('normalizeSiren and checksum', () => {
  it('accepts 9 digits with spaces, refuses the rest', () => {
    expect(normalizeSiren('912 345 675')).toBe('912345675')
    expect(normalizeSiren('91234567')).toBeNull()
    expect(normalizeSiren('91234567A')).toBeNull()
  })

  it('checks the Luhn key of a SIREN', () => {
    expect(sirenChecksumValid('912345675')).toBe(true)
    expect(sirenChecksumValid('552032534')).toBe(true)
    expect(sirenChecksumValid('123456789')).toBe(false)
  })
})

describe('lookupSiren', () => {
  it('calls only the directory host, with the SIREN, no redirect and a timeout', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json(sas))
    const outcome = await lookupSiren('912345675', { fetch: fetchMock })
    expect(outcome).toMatchObject({ status: 'found', company: { name: 'ATELIER LUMEN', legalType: 'SAS' } })
    const [url, init] = fetchMock.mock.calls[0]
    const called = new URL(String(url))
    expect(called.origin).toBe(RECHERCHE_ENTREPRISES_API)
    expect(called.pathname).toBe('/search')
    expect(called.searchParams.get('q')).toBe('912345675')
    expect(init?.redirect).toBe('error')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('answers not_found for an unknown SIREN and never calls the API for an invalid one', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ results: [], total_results: 0 }))
    expect(await lookupSiren('123456782', { fetch: fetchMock })).toEqual({ status: 'not_found' })
    expect(await lookupSiren('12', { fetch: fetchMock })).toEqual({ status: 'not_found' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('answers unavailable, without throwing, when the API is down, slow, rate limited or odd', async () => {
    const cases: Array<typeof fetch> = [
      async () => {
        throw new TypeError('fetch failed')
      },
      async () => json({ erreur: 'Too many requests' }, 429),
      async () => json({ message: 'Service unavailable' }, 503),
      async () => new Response('<html>maintenance</html>', { status: 200 }),
      async () => json({ unexpected: true }),
    ]
    for (const fake of cases) {
      expect(await lookupSiren('912345675', { fetch: fake })).toEqual({ status: 'unavailable' })
    }
  })

  it('gives up after the timeout', async () => {
    const hanging: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError')))
      })
    expect(await lookupSiren('912345675', { fetch: hanging, timeoutMs: 20 })).toEqual({ status: 'unavailable' })
  })
})
