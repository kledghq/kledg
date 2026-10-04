import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

const router = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { DisplayModeCard } from '../display-mode-card'

const fetchMock = vi.fn()

beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

describe('DisplayModeCard (Paramètres, Apparence)', () => {
  it('shows the saved mode and saves a new one at once', async () => {
    fetchMock.mockResolvedValue(Response.json({ mode: 'simple', chosen: true }))
    const user = userEvent.setup()
    render(<DisplayModeCard initial="expert" />)
    expect(screen.getByText("Mode d'affichage")).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Expert/ })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: /Simple/ }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Mode simple activé'))
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ mode: 'simple' })
    expect(router.refresh).toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: /Simple/ })).toBeChecked()
  })

  it('goes back to the saved mode when saving fails', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'Requête refusée.' }, { status: 403 }))
    const user = userEvent.setup()
    render(<DisplayModeCard initial="simple" />)
    await user.click(screen.getByRole('radio', { name: /Expert/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Requête refusée.'))
    expect(screen.getByRole('radio', { name: /Simple/ })).toBeChecked()
  })
})
