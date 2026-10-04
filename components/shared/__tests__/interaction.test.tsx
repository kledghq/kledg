import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Input } from '@/components/ui/input'
import { ConfirmDialog, useConfirm } from '../confirm-dialog'
import { ConfirmDeleteDialog } from '../confirm-delete-dialog'
import { EmptyState } from '../empty-state'
import { Field } from '../field'
import { HelpTip } from '../help-tip'
import { PageHeader } from '../page-header'

describe('Field', () => {
  it('links the label, hint and error to the control', () => {
    render(
      <Field label="Code" required hint="2 à 3 caractères" error="Le code est requis">
        <Input />
      </Field>,
    )
    const input = screen.getByLabelText(/Code/)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-required', 'true')
    const describedBy = input.getAttribute('aria-describedby') ?? ''
    expect(describedBy.split(' ')).toHaveLength(2)
    expect(screen.getByRole('alert')).toHaveTextContent('Le code est requis')
  })

  it('keeps an id given by the caller', () => {
    render(
      <Field label="Libellé" htmlFor="label-id">
        <Input id="label-id" />
      </Field>,
    )
    expect(screen.getByLabelText('Libellé')).toHaveAttribute('id', 'label-id')
  })

  it('marks optional fields', () => {
    render(
      <Field label="Nom" optional>
        <Input />
      </Field>,
    )
    expect(screen.getByText('(facultatif)')).toBeInTheDocument()
  })
})

describe('ConfirmDialog', () => {
  it('names the action, focuses cancel first and confirms on click', async () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Supprimer le journal BQ ?"
        description="Seul un journal sans écriture peut être supprimé."
        confirmLabel="Supprimer"
        onConfirm={onConfirm}
      />,
    )
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Supprimer le journal BQ ?')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Annuler' })).toHaveFocus())
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('disables both buttons while the action runs', () => {
    render(
      <ConfirmDialog open onOpenChange={() => {}} title="Retirer ?" confirmLabel="Retirer" loading onConfirm={() => {}} />,
    )
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Retirer\.\.\./ })).toBeDisabled()
  })

  it('keeps the ConfirmDeleteDialog defaults', () => {
    render(<ConfirmDeleteDialog open onOpenChange={() => {}} title="Supprimer ?" description="x" onConfirm={() => {}} />)
    expect(screen.getByRole('button', { name: 'Supprimer' })).toHaveAttribute('data-variant', 'destructive')
  })
})

function ConfirmHarness({ onResult }: { onResult: (ok: boolean) => void }) {
  const { confirm, dialog } = useConfirm()
  const [, setTick] = useState(0)
  return (
    <>
      <button
        onClick={async () => {
          onResult(await confirm({ title: 'Révoquer la clé ?', confirmLabel: 'Révoquer' }))
          setTick((t) => t + 1)
        }}
      >
        Ouvrir
      </button>
      {dialog}
    </>
  )
}

describe('useConfirm', () => {
  it('resolves true when confirmed', async () => {
    const onResult = vi.fn()
    render(<ConfirmHarness onResult={onResult} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Révoquer' }))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true))
  })

  it('resolves false on Escape', async () => {
    const onResult = vi.fn()
    render(<ConfirmHarness onResult={onResult} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir' }))
    await screen.findByRole('alertdialog')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false))
  })
})

describe('EmptyState', () => {
  it('says what is missing, what to do and links the docs', () => {
    render(
      <EmptyState
        title="Aucun exercice"
        description="Créez le premier exercice."
        action={<button>Créer un exercice</button>}
        docsHref="https://www.kledg.com/docs/l-exercice-et-la-cloture"
      />,
    )
    expect(screen.getByRole('heading', { name: 'Aucun exercice' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Créer un exercice' })).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Comprendre/ })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })
})

describe('PageHeader', () => {
  it('renders one h1 and the docs link', () => {
    render(<PageHeader title="Journaux" description="Les journaux." docsHref="https://example.test/docs" actions={<button>Ajouter</button>} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Journaux' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Aide/ })).toHaveAttribute('href', 'https://example.test/docs')
  })
})

describe('HelpTip', () => {
  it('opens with the keyboard and closes with Escape', async () => {
    render(<HelpTip term="Exercice">Période de 12 mois.</HelpTip>)
    const trigger = screen.getByRole('button', { name: 'Aide\u00a0: Exercice' })
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByText('Période de 12 mois.')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText('Période de 12 mois.')).not.toBeInTheDocument())
  })
})
