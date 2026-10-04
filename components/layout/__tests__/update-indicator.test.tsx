import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UpdateIndicator } from '../update-indicator'

const fetchMock = vi.fn<typeof fetch>()

/** In-memory Storage: recent Node versions shadow jsdom's localStorage with their own, unusable without a file. */
function memoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('UpdateIndicator', () => {
  it('links to the updates page when a version is available', async () => {
    fetchMock.mockResolvedValue(Response.json({ state: 'available', latest: { version: '1.4.0' } }))
    render(<UpdateIndicator />)
    expect(await screen.findByRole('link', { name: /Mise à jour disponible/ })).toHaveAttribute('href', '/settings/updates')
    expect(screen.getByRole('button', { name: 'Kledg 1.4.0 est disponible' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/updates?light=1', { cache: 'no-store' })
  })

  it('hides itself until the next version once dismissed', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(Response.json({ state: 'available', latest: { version: '1.4.0' } }))
    const { unmount } = render(<UpdateIndicator />)
    await user.click(await screen.findByRole('button', { name: 'Masquer' }))
    expect(screen.queryByRole('link', { name: /Mise à jour disponible/ })).toBeNull()
    expect(window.localStorage.getItem('kledg:update-dismissed')).toBe('1.4.0')
    unmount()

    render(<UpdateIndicator />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('link', { name: /Mise à jour disponible/ })).toBeNull()
    unmount()

    fetchMock.mockResolvedValue(Response.json({ state: 'available', latest: { version: '1.5.0' } }))
    render(<UpdateIndicator />)
    expect(await screen.findByRole('link', { name: /Mise à jour disponible/ })).toBeInTheDocument()
  })

  it('dismisses from the compact menu too', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(Response.json({ state: 'available', latest: { version: '1.4.0' } }))
    render(<UpdateIndicator />)
    await user.click(await screen.findByRole('button', { name: 'Kledg 1.4.0 est disponible' }))
    expect(await screen.findByRole('menuitem', { name: /Voir la mise à jour/ })).toHaveAttribute('href', '/settings/updates')
    await user.click(screen.getByRole('menuitem', { name: /Masquer jusqu'à la prochaine version/ }))
    await waitFor(() => expect(screen.queryByRole('link', { name: /Mise à jour disponible/ })).toBeNull())
    expect(window.localStorage.getItem('kledg:update-dismissed')).toBe('1.4.0')
  })

  it.each([
    ['up to date', () => Response.json({ state: 'up-to-date', latest: { version: '1.3.0' } })],
    ['forbidden to non administrators', () => Response.json({ error: 'Interdit' }, { status: 403 })],
  ])('renders nothing when %s', async (_label, response) => {
    fetchMock.mockImplementation(async () => response())
    const { container } = render(<UpdateIndicator />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the request fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'))
    const { container } = render(<UpdateIndicator />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
