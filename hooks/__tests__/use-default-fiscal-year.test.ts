import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loggerError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/logger', () => ({
  logger: { error: loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { useDefaultFiscalYear } from '@/hooks/use-default-fiscal-year'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  loggerError.mockReset()
})

const fy = (id: string, year: number, isClosed: boolean) => ({ id, year, isClosed })

describe('useDefaultFiscalYear', () => {
  it('picks the first open year, from the company fiscal years route', async () => {
    fetchMock.mockResolvedValue(
      Response.json([fy('fy-2023', 2023, true), fy('fy-2024', 2024, false), fy('fy-2025', 2025, false)]),
    )
    const { result } = renderHook(() => useDefaultFiscalYear('c1'))
    expect(result.current.ready).toBe(false)
    expect(result.current.fiscalYearId).toBeUndefined()

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(fetchMock).toHaveBeenCalledWith('/api/companies/c1/fiscal-years')
    expect(result.current.fiscalYearId).toBe('fy-2024')
  })

  it('falls back to the most recent year when every year is closed', async () => {
    fetchMock.mockResolvedValue(
      Response.json([fy('fy-2022', 2022, true), fy('fy-2024', 2024, true), fy('fy-2023', 2023, true)]),
    )
    const { result } = renderHook(() => useDefaultFiscalYear('c1'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.fiscalYearId).toBe('fy-2024')
  })

  it('is ready without a year when the company has none or the request fails', async () => {
    fetchMock.mockResolvedValueOnce(Response.json([]))
    const empty = renderHook(() => useDefaultFiscalYear('c1'))
    await waitFor(() => expect(empty.result.current.ready).toBe(true))
    expect(empty.result.current.fiscalYearId).toBeUndefined()

    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Accès refusé' }, { status: 403 }))
    const forbidden = renderHook(() => useDefaultFiscalYear('c2'))
    await waitFor(() => expect(forbidden.result.current.ready).toBe(true))
    expect(forbidden.result.current.fiscalYearId).toBeUndefined()
  })

  it('logs a network error and still turns ready', async () => {
    const failure = new TypeError('Failed to fetch')
    fetchMock.mockRejectedValue(failure)
    const { result } = renderHook(() => useDefaultFiscalYear('c1'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.fiscalYearId).toBeUndefined()
    expect(loggerError).toHaveBeenCalledWith('Error loading fiscal years:', failure)
  })

  it('does nothing and is never ready without a company', () => {
    const { result } = renderHook(() => useDefaultFiscalYear(undefined))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.ready).toBe(false)
  })

  it('keeps a year chosen by the user before the list arrives', async () => {
    let resolve: (r: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)))
    const { result } = renderHook(() => useDefaultFiscalYear('c1'))
    act(() => result.current.setFiscalYearId('fy-2021'))
    await act(async () => resolve(Response.json([fy('fy-2025', 2025, false)])))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.fiscalYearId).toBe('fy-2021')
  })

  it('ignores the answer for a company the user has left, and is not ready for the new one until its years load', async () => {
    let resolveFirst: (r: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolveFirst = r)))
    let resolveSecond: (r: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolveSecond = r)))

    const { result, rerender } = renderHook(({ id }) => useDefaultFiscalYear(id), { initialProps: { id: 'c1' } })
    rerender({ id: 'c2' })
    await act(async () => resolveFirst(Response.json([fy('c1-fy', 2025, false)])))
    expect(result.current.fiscalYearId).toBeUndefined()
    expect(result.current.ready).toBe(false)

    await act(async () => resolveSecond(Response.json([fy('c2-fy', 2025, false)])))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.fiscalYearId).toBe('c2-fy')
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/companies/c2/fiscal-years')
  })
})
