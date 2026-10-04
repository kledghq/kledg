import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { DisplayModeStep } from '../display-mode-step'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

describe('DisplayModeStep', () => {
  it('shows the two cards of the mockup, simple chosen and recommended', () => {
    render(<DisplayModeStep companySlug="atelier-lumen" />)
    expect(screen.getByRole('radiogroup', { name: "Mode d'affichage" })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Simple/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Expert/ })).not.toBeChecked()
    expect(screen.getByText('Recommandé si vous débutez')).toBeInTheDocument()
    expect(screen.getByText('Vos dépenses classées automatiquement')).toBeInTheDocument()
    expect(screen.getByText('Clôture, bilan, liasse et FEC')).toBeInTheDocument()
    expect(screen.getByText(/seul l'affichage change/)).toBeInTheDocument()
  })

  it('saves the expert mode and opens the dashboard', async () => {
    fetchMock.mockResolvedValue(Response.json({ mode: 'expert', chosen: true }))
    const user = userEvent.setup()
    render(<DisplayModeStep companySlug="atelier-lumen" />)
    await user.click(screen.getByRole('radio', { name: /Expert/ }))
    await user.click(screen.getByRole('button', { name: /Continuer/ }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/atelier-lumen'))
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ mode: 'expert' })
    expect(router.refresh).toHaveBeenCalled()
  })

  it('stays on the step with the error when saving fails', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "Trop d'enregistrements de l'apparence en une minute. Patientez une minute." }, { status: 429 }))
    const user = userEvent.setup()
    render(<DisplayModeStep companySlug="atelier-lumen" />)
    await user.click(screen.getByRole('button', { name: /Continuer/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Trop d'enregistrements de l'apparence en une minute. Patientez une minute."))
    expect(router.push).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Continuer/ })).toBeEnabled()
  })
})
