/**
 * "Saisies du mode simple à valider": the status filter is a segmented
 * control over one list (no tabs, docs/design-system.md); each choice
 * reloads the list with its status.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { SimpleEntriesReview } from '../simple-entries-review'

const SUMMARY = { classifiedCount: 4, validatedCount: 1, toValidateCount: 3, accountantReview: true, accountants: [] }

describe('SimpleEntriesReview', () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/simple/entries')) return new Response(JSON.stringify({ items: [], summary: SUMMARY }), { status: 200 })
    return new Response(JSON.stringify({ error: 'inattendu' }), { status: 500 })
  })
  beforeEach(() => vi.stubGlobal('fetch', fetchMock))
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('filters by status with a segmented control, not tabs', async () => {
    const user = userEvent.setup()
    render(<SimpleEntriesReview companyId="acme" />)
    expect(await screen.findByText(/3 à valider/)).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByRole('group', { name: 'Saisies à afficher' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'À valider' })).toHaveAttribute('aria-checked', 'true')
    expect(fetchMock).toHaveBeenCalledWith('/api/simple/entries?companyId=acme&status=to-validate')

    await user.click(screen.getByRole('radio', { name: 'Validées' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/simple/entries?companyId=acme&status=validated'))
    expect(screen.getByRole('radio', { name: 'Validées' })).toHaveAttribute('aria-checked', 'true')
  })
})
