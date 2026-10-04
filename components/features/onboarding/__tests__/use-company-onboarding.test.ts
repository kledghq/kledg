import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OnboardingStep } from '@/lib/onboarding/checklist'
import { type CompanyOnboardingView, useCompanyOnboarding } from '../use-company-onboarding'

const step = (id: OnboardingStep['id'], done: boolean, action: OnboardingStep['action'] = null): OnboardingStep => ({
  id,
  title: `Titre ${id}`,
  why: `Pourquoi ${id}`,
  done,
  detail: null,
  action,
})

function view(overrides: Partial<CompanyOnboardingView> = {}): CompanyOnboardingView {
  return {
    enabled: true,
    dismissed: false,
    canManage: true,
    steps: [
      step('chart', true, { label: 'Voir le plan comptable', href: '/c1/accounts' }),
      step('bank', false, null),
      step('history', false, { label: 'Importer un FEC', href: '/c1/import' }),
      step('rule', false, { label: 'Créer une règle', href: '/c1/rules' }),
    ],
    done: 1,
    total: 4,
    complete: false,
    counts: { entries: 0, bankTransactions: 0 },
    ...overrides,
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('useCompanyOnboarding', () => {
  it('loads the checklist and names the first undone step that has an action', async () => {
    fetchMock.mockResolvedValue(Response.json(view()))
    const { result } = renderHook(() => useCompanyOnboarding('c1'))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchMock).toHaveBeenCalledWith('/api/companies/c1/onboarding')
    expect(result.current.data?.done).toBe(1)
    // "bank" is undone but has no action: the next step is "history".
    expect(result.current.nextStep?.id).toBe('history')
  })

  it('has no next step when the checklist does not apply', async () => {
    fetchMock.mockResolvedValue(Response.json(view({ enabled: false })))
    const { result } = renderHook(() => useCompanyOnboarding('c1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.nextStep).toBeNull()
  })

  it('keeps data null when the request fails or is refused', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Accès refusé' }, { status: 403 }))
    const refused = renderHook(() => useCompanyOnboarding('c1'))
    await waitFor(() => expect(refused.result.current.loading).toBe(false))
    expect(refused.result.current.data).toBeNull()

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const offline = renderHook(() => useCompanyOnboarding('c1'))
    await waitFor(() => expect(offline.result.current.loading).toBe(false))
    expect(offline.result.current.data).toBeNull()
    expect(offline.result.current.nextStep).toBeNull()
  })

  it('does not fetch without a company, and setDismissed refuses', async () => {
    const { result } = renderHook(() => useCompanyOnboarding(undefined))
    let ok = true
    await act(async () => {
      ok = await result.current.setDismissed(true)
    })
    expect(ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('hides the checklist at once and posts the dismiss action', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(view()))
    const { result } = renderHook(() => useCompanyOnboarding('c1'))
    await waitFor(() => expect(result.current.data).not.toBeNull())

    fetchMock.mockResolvedValueOnce(Response.json({ ok: true }))
    let ok = false
    await act(async () => {
      ok = await result.current.setDismissed(true)
    })
    expect(ok).toBe(true)
    expect(result.current.data?.dismissed).toBe(true)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/companies/c1/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss' }),
    })
  })

  it('posts reopen, and reloads the real state when the change fails', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(view({ dismissed: true })))
    const { result } = renderHook(() => useCompanyOnboarding('c1'))
    await waitFor(() => expect(result.current.data).not.toBeNull())

    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Erreur' }, { status: 500 }))
    fetchMock.mockResolvedValueOnce(Response.json(view({ dismissed: true })))
    let ok = true
    await act(async () => {
      ok = await result.current.setDismissed(false)
    })
    expect(ok).toBe(false)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ action: 'reopen' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock.mock.calls[2]).toEqual(['/api/companies/c1/onboarding'])
    await waitFor(() => expect(result.current.data?.dismissed).toBe(true))
  })

  it('treats a network error on the change as a failure', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(view()))
    const { result } = renderHook(() => useCompanyOnboarding('c1'))
    await waitFor(() => expect(result.current.data).not.toBeNull())

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    fetchMock.mockResolvedValueOnce(Response.json(view()))
    let ok = true
    await act(async () => {
      ok = await result.current.setDismissed(true)
    })
    expect(ok).toBe(false)
    await waitFor(() => expect(result.current.data?.dismissed).toBe(false))
  })

  it('drops a slow read that started before a dismiss', async () => {
    let resolveSlow: (r: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolveSlow = r)))
    const { result } = renderHook(() => useCompanyOnboarding('c1'))

    fetchMock.mockResolvedValueOnce(Response.json({ ok: true }))
    await act(async () => {
      await result.current.setDismissed(true)
    })
    // The read started before the dismiss answers with the old state: ignored.
    await act(async () => resolveSlow(Response.json(view({ dismissed: false }))))
    expect(result.current.data).toBeNull()
  })
})
