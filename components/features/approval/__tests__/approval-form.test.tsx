/**
 * The approval form (components/features/approval/approval-form.tsx):
 * labels follow the legal form (gérant for a SARL, président for a SASU,
 * no attendance for an associé unique), an edit shows the unsaved changes
 * bar and cancelling it removes it (regression: optional fields missing
 * from the defaults kept the form dirty after a save), and the saved values
 * are sent through the shared schema.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApprovalForm } from '../approval-form'
import { buildApprovalPack } from '@/lib/approval/pack'
import type { ApprovalView } from '@/lib/approval/get-approval.service'
import { complete, contextFor, details } from '@/lib/approval/__tests__/fixtures'

function viewFor(legalType: string, saved = details()): ApprovalView {
  const context = contextFor(legalType)
  return { context, details: saved, saved: null, pack: buildApprovalPack(context, saved), persons: [{ id: 'p1', name: 'Jeanne Martin' }], sources: [] }
}

describe('ApprovalForm', () => {
  it('asks a SARL for its gérant, the presence of each associé and the votes', () => {
    render(<ApprovalForm view={viewFor('SARL')} saving={false} onSave={vi.fn()} />)
    expect(screen.getByText('Le gérant signe les documents.')).toBeInTheDocument()
    expect(screen.getByText('Présence et votes')).toBeInTheDocument()
    expect(screen.getByLabelText("Date de l'assemblée")).toBeInTheDocument()
    expect(screen.getByText('Résultat des votes')).toBeInTheDocument()
    expect(screen.getByText('Deuxième consultation')).toBeInTheDocument()
  })

  it('asks a SASU for its président and the date of the decision, without votes', () => {
    render(<ApprovalForm view={viewFor('SASU')} saving={false} onSave={vi.fn()} />)
    expect(screen.getByText(/Le président signe les documents/)).toBeInTheDocument()
    expect(screen.queryByText(/gérant/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Date de la décision')).toBeInTheDocument()
    expect(screen.queryByText('Résultat des votes')).not.toBeInTheDocument()
    expect(screen.getByText('Associé unique', { selector: 'span' })).toBeInTheDocument()
  })

  it('shows the unsaved changes bar after an edit, and removes it when the edit is cancelled', async () => {
    const user = userEvent.setup()
    render(<ApprovalForm view={viewFor('SARL', complete())} saving={false} onSave={vi.fn()} />)
    expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument()
    const rcs = screen.getByLabelText('Ville du greffe (RCS)')
    await user.clear(rcs)
    await user.type(rcs, 'Villeurbanne')
    expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Annuler les modifications' }))
    await waitFor(() => expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Ville du greffe (RCS)')).toHaveValue('Lyon')
  })

  it('sends the details validated by the shared schema', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => {})
    render(<ApprovalForm view={viewFor('SARL', complete())} saving={false} onSave={onSave} />)
    const city = screen.getByLabelText('Ville de signature')
    await user.clear(city)
    await user.type(city, '  Lyon 2e  ')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const sent = (onSave.mock.calls[0] as unknown[])[0] as { signatureCity: string; rcsCity: string; decisionMode: string; votes: Record<string, unknown> }
    expect(sent).toMatchObject({ signatureCity: 'Lyon 2e', rcsCity: 'Lyon', decisionMode: 'meeting' })
    expect(sent.votes.allocation).toEqual({ unanimous: false, for: 600, against: 400, abstain: 0 })
  })
})
