import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useLedgerBankAccounts } from '../use-ledger-bank-accounts'

const fetchMock = vi.fn()
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('useLedgerBankAccounts', () => {
  it('keeps only the bank accounts (class 512) of the company chart', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, [
        { id: 'a1', code: '411000', label: 'Clients', type: 'ASSET' },
        { id: 'a2', code: '512100', label: 'Banque BNP', type: 'ASSET' },
        { id: 'a3', code: '5121', label: 'Banque Qonto', type: 'ASSET' },
        { id: 'a4', code: '514000', label: 'Chèques postaux', type: 'ASSET' },
        { id: 'a5', code: '4512', label: 'Associés', type: 'LIABILITY' },
      ]),
    )
    const { result } = renderHook(() => useLedgerBankAccounts('atelier & co'))
    expect(result.current).toEqual({ accounts: [], loading: true })

    await waitFor(() => expect(result.current.loading).toBe(false))
    // PCG art. 932-1 (chart of accounts): 512 "Banques"; 514 (Chèques postaux) and 4512 are other accounts
    expect(result.current.accounts).toEqual([
      { id: 'a2', code: '512100', label: 'Banque BNP' },
      { id: 'a3', code: '5121', label: 'Banque Qonto' },
    ])
    expect(fetchMock).toHaveBeenCalledWith('/api/accounts?companyId=atelier%20%26%20co')
  })

  it('returns no account when the request fails or the body is not a list', async () => {
    fetchMock.mockResolvedValueOnce(json(403, { error: 'Accès refusé' }))
    const refused = renderHook(() => useLedgerBankAccounts('co-1'))
    await waitFor(() => expect(refused.result.current.loading).toBe(false))
    expect(refused.result.current.accounts).toEqual([])

    fetchMock.mockResolvedValueOnce(json(200, { accounts: [{ id: 'a2', code: '512100', label: 'Banque' }] }))
    const odd = renderHook(() => useLedgerBankAccounts('co-1'))
    await waitFor(() => expect(odd.result.current.loading).toBe(false))
    expect(odd.result.current.accounts).toEqual([])

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const offline = renderHook(() => useLedgerBankAccounts('co-1'))
    await waitFor(() => expect(offline.result.current.loading).toBe(false))
    expect(offline.result.current.accounts).toEqual([])
  })

  it('waits for a company before loading anything', () => {
    const { result } = renderHook(() => useLedgerBankAccounts(undefined))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current).toEqual({ accounts: [], loading: true })
  })

  it('ignores the answer for a company the page has left', async () => {
    let resolveFirst: (r: Response) => void = () => {}
    fetchMock
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(json(200, [{ id: 'b1', code: '512300', label: 'Banque B' }]))
    const { result, rerender } = renderHook(({ id }) => useLedgerBankAccounts(id), { initialProps: { id: 'co-a' } })

    rerender({ id: 'co-b' })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.accounts).toEqual([{ id: 'b1', code: '512300', label: 'Banque B' }])

    // The late answer for co-a does not overwrite co-b's accounts
    resolveFirst(json(200, [{ id: 'a1', code: '512999', label: 'Banque A' }]))
    await new Promise((r) => setTimeout(r, 0))
    expect(result.current.accounts).toEqual([{ id: 'b1', code: '512300', label: 'Banque B' }])
  })
})
