/**
 * Layout notice of the statement pages: nothing for the current default, an
 * information after an automatic upgrade, and for a customized layout a
 * reset button that posts the variant to .../config/default, toasts the
 * outcome in French and reloads the statement on success only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: toasts }))

import { LayoutNotice } from '../layout-notice'

const fetchMock = vi.fn<typeof fetch>()

function renderNotice(props: Partial<Parameters<typeof LayoutNotice>[0]> = {}) {
  const onReset = vi.fn()
  render(
    <LayoutNotice companyId="atelier" kind="balance-sheet" variant="simplified" status="customized" hasWarnings={false} onReset={onReset} {...props} />,
  )
  return onReset
}

describe('LayoutNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders nothing for the default layout or an unknown status', () => {
    const { container, rerender } = render(
      <LayoutNotice companyId="atelier" kind="balance-sheet" variant="complete" status="default" hasWarnings={false} onReset={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
    rerender(<LayoutNotice companyId="atelier" kind="balance-sheet" variant="complete" status={undefined} hasWarnings onReset={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('tells that an untouched layout was upgraded, without a reset button', () => {
    renderNotice({ kind: 'income-statement', status: 'upgraded' })
    expect(screen.getByText('Mise en page du compte de résultat mise à jour')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('resets a customized layout to the default and reloads the statement', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 201 }))
    const onReset = renderNotice()
    expect(screen.getByText('Mise en page du bilan personnalisée')).toBeInTheDocument()
    expect(screen.getByRole('alert')).not.toHaveClass('text-destructive')

    await userEvent.click(screen.getByRole('button', { name: 'Rétablir la mise en page par défaut' }))
    await waitFor(() => expect(onReset).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/companies/atelier/balance-sheet/config/default', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant: 'simplified' }),
    })
    expect(toasts.success).toHaveBeenCalledWith('Mise en page par défaut rétablie')
    expect(screen.getByRole('button', { name: 'Rétablir la mise en page par défaut' })).toBeEnabled()
  })

  it('shows the error of the server and keeps the statement when the reset fails', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Vous n'avez pas les droits nécessaires" }), { status: 403 }))
    const onReset = renderNotice({ kind: 'income-statement', variant: 'complete', hasWarnings: true })
    await userEvent.click(screen.getByRole('button', { name: 'Rétablir la mise en page par défaut' }))
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith("Vous n'avez pas les droits nécessaires"))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/companies/atelier/income-statement/config/default')
    expect(onReset).not.toHaveBeenCalled()
  })

  it('falls back to a French message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('Bad gateway', { status: 502 }))
    renderNotice()
    await userEvent.click(screen.getByRole('button', { name: 'Rétablir la mise en page par défaut' }))
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Impossible de rétablir la mise en page par défaut'))
  })
})
