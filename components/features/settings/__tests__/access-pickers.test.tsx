import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTOMATIC_MODE_WARNING, type AccessLevel, type CompanyAccess, type ExecutionMode } from '@/lib/ai-access/access'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { AccessLevelPicker } from '../access-level-picker'
import { ExecutionModePicker } from '../execution-mode-picker'
import { CompanyAccessPicker, accessError, describeAccess } from '../company-access-picker'
import { CompanyAccessDialog } from '../company-access-dialog'

afterEach(() => {
  vi.clearAllMocks()
})

const companies = [
  { id: 'c1', name: 'Alpha SAS', siren: '123456789' },
  { id: 'c2', name: 'Beta SARL', siren: null },
  { id: 'c3', name: 'Gamma' },
]

describe('AccessLevelPicker', () => {
  function Harness({ initial = 'write' as AccessLevel, onChange = vi.fn() }) {
    const [value, setValue] = useState<AccessLevel>(initial)
    return (
      <AccessLevelPicker
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
        unavailable={{ admin: 'Reconnectez l’assistant pour l’autoriser.' }}
      />
    )
  }

  it('shows the three levels and warns only when full control is chosen', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<AccessLevelPicker value="read" onChange={onChange} />)
    expect(screen.getByRole('radio', { name: /Lecture seule/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Contrôle total/ })).not.toBeChecked()
    expect(screen.getByText('Agir comme vous, au-delà des brouillons.')).toBeInTheDocument()
    expect(screen.queryByText(/Réservez ce choix/)).toBeNull()
    await user.click(screen.getByRole('radio', { name: /Lecture et brouillons/ }))
    expect(onChange).toHaveBeenCalledWith('write')
  })

  it('shows the full control warning when admin is the value', () => {
    render(<AccessLevelPicker value="admin" onChange={vi.fn()} />)
    expect(screen.getByText(/Réservez ce choix à un assistant en qui vous avez toute confiance/)).toBeInTheDocument()
  })

  it('disables an unavailable level and shows why instead of its description', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const admin = screen.getByRole('radio', { name: /Contrôle total/ })
    expect(admin).toBeDisabled()
    expect(screen.getByText('Reconnectez l’assistant pour l’autoriser.')).toBeInTheDocument()
    await user.click(admin)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('lists only the levels it is given', () => {
    render(<AccessLevelPicker value="read" onChange={vi.fn()} levels={['read']} />)
    expect(screen.getAllByRole('radio')).toHaveLength(1)
  })
})

describe('ExecutionModePicker', () => {
  it('warns about prompt injection in automatic mode only', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [mode, setMode] = useState<ExecutionMode>('automatic')
      return <ExecutionModePicker value={mode} onChange={setMode} />
    }
    render(<Harness />)
    expect(screen.getByRole('radio', { name: /Automatique/ })).toBeChecked()
    expect(screen.getByText(AUTOMATIC_MODE_WARNING)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /Validation dans Kledg/ }))
    expect(screen.getByRole('radio', { name: /Validation dans Kledg/ })).toBeChecked()
    expect(screen.queryByText(AUTOMATIC_MODE_WARNING)).toBeNull()
  })

  it('disables both modes when disabled', () => {
    render(<ExecutionModePicker value="validation" onChange={vi.fn()} disabled />)
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
  })
})

describe('CompanyAccessPicker', () => {
  function Harness({ initial, onChange }: { initial: CompanyAccess; onChange: (v: CompanyAccess) => void }) {
    const [value, setValue] = useState(initial)
    return (
      <CompanyAccessPicker
        companies={companies}
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
    )
  }

  it('switches to chosen companies and keeps them in the list order', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness initial={{ allCompanies: true, companyIds: [] }} onChange={onChange} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    await user.click(screen.getByRole('radio', { name: 'Seulement les sociétés choisies' }))
    expect(onChange).toHaveBeenLastCalledWith({ allCompanies: false, companyIds: [] })
    expect(screen.getByText('123456789')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /Gamma/ }))
    await user.click(screen.getByRole('checkbox', { name: /Alpha SAS/ }))
    expect(onChange).toHaveBeenLastCalledWith({ allCompanies: false, companyIds: ['c1', 'c3'] })
    await user.click(screen.getByRole('checkbox', { name: /Gamma/ }))
    expect(onChange).toHaveBeenLastCalledWith({ allCompanies: false, companyIds: ['c1'] })

    await user.click(screen.getByRole('radio', { name: 'Toutes mes sociétés, y compris les futures' }))
    expect(onChange).toHaveBeenLastCalledWith({ allCompanies: true, companyIds: [] })
  })

  it('offers only every company when the user has none', () => {
    render(<CompanyAccessPicker companies={[]} value={{ allCompanies: true, companyIds: [] }} onChange={vi.fn()} />)
    expect(screen.getByRole('radio', { name: /Seulement les sociétés choisies/ })).toBeDisabled()
    expect(screen.getByText(/il n'y a rien à choisir/)).toBeInTheDocument()
  })

  it('says the companies failed to load instead of showing an empty list', () => {
    render(
      <CompanyAccessPicker companies={[]} loadFailed value={{ allCompanies: false, companyIds: [] }} onChange={vi.fn()} />,
    )
    expect(screen.getByText(/Vos sociétés n'ont pas pu être chargées/)).toBeInTheDocument()
    expect(screen.queryByText(/aucune société pour le moment/)).toBeNull()
    expect(screen.getByRole('radio', { name: /Seulement les sociétés choisies/ })).toBeDisabled()
  })

  it('shows a busy skeleton while loading and the error under the fieldset', () => {
    render(
      <CompanyAccessPicker
        companies={[]}
        loading
        value={{ allCompanies: false, companyIds: [] }}
        onChange={vi.fn()}
        error="Choisissez au moins une société, ou toutes vos sociétés."
      />,
    )
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    const fieldset = screen.getByRole('group')
    const errorId = fieldset.getAttribute('aria-describedby')!
    expect(document.getElementById(errorId)).toHaveTextContent('Choisissez au moins une société, ou toutes vos sociétés.')
  })

  it('describes an access by the names the user can still see', () => {
    expect(describeAccess(undefined, companies)).toBe('Toutes les sociétés')
    expect(describeAccess({ allCompanies: true, companyIds: [] }, companies)).toBe('Toutes les sociétés')
    expect(describeAccess({ allCompanies: false, companyIds: ['c3', 'gone', 'c1'] }, companies)).toBe('Gamma, Alpha SAS')
    expect(describeAccess({ allCompanies: false, companyIds: ['gone'] }, companies)).toBe('Aucune société')
  })

  it('refuses an empty list of chosen companies', () => {
    expect(accessError({ allCompanies: false, companyIds: [] })).toBe('Choisissez au moins une société, ou toutes vos sociétés.')
    expect(accessError({ allCompanies: false, companyIds: ['c1'] })).toBeNull()
    expect(accessError({ allCompanies: true, companyIds: [] })).toBeNull()
  })
})

describe('CompanyAccessDialog', () => {
  it('refuses to save an empty choice, then saves companies, level and mode', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => {})
    const onOpenChange = vi.fn()
    render(
      <CompanyAccessDialog
        open
        onOpenChange={onOpenChange}
        title="Accès de Claude"
        companies={companies}
        companiesLoading={false}
        initial={{ allCompanies: false, companyIds: [] }}
        level={{ initial: 'write' }}
        executionMode="automatic"
        onSave={onSave}
      />,
    )
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Choisissez ce que cet assistant peut faire/)).toBeInTheDocument()
    // Execution mode only appears with full control.
    expect(within(dialog).queryByText('Exécution des actions importantes')).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: "Enregistrer l'accès" }))
    expect(within(dialog).getByText('Choisissez au moins une société, ou toutes vos sociétés.')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('checkbox', { name: /Beta SARL/ }))
    expect(within(dialog).queryByText('Choisissez au moins une société, ou toutes vos sociétés.')).toBeNull()
    await user.click(within(dialog).getByRole('radio', { name: /Contrôle total/ }))
    await user.click(within(dialog).getByRole('radio', { name: /Validation dans Kledg/ }))
    await user.click(within(dialog).getByRole('button', { name: "Enregistrer l'accès" }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onSave).toHaveBeenCalledWith({ allCompanies: false, companyIds: ['c2'] }, 'admin', 'validation')
    expect(toast.success).toHaveBeenCalledWith('Accès mis à jour')
  })

  it('sends no execution mode when the assistant is not on full control', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => {})
    render(
      <CompanyAccessDialog
        open
        onOpenChange={vi.fn()}
        title="Accès de Claude"
        companies={companies}
        companiesLoading={false}
        initial={undefined}
        level={{ initial: 'read' }}
        executionMode="automatic"
        onSave={onSave}
      />,
    )
    await user.click(screen.getByRole('button', { name: "Enregistrer l'accès" }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ allCompanies: true, companyIds: [] }, 'read', undefined))
  })

  it('shows the mode for an API key and keeps the dialog open with the error when saving fails', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSave = vi.fn(async () => {
      throw new Error('Société introuvable')
    })
    render(
      <CompanyAccessDialog
        open
        onOpenChange={onOpenChange}
        title="Accès de la clé « CI »"
        companies={companies}
        companiesLoading={false}
        initial={{ allCompanies: true, companyIds: [] }}
        executionMode="validation"
        onSave={onSave}
      />,
    )
    expect(screen.getByText(/comment elle exécute les actions importantes/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Validation dans Kledg/ })).toBeChecked()
    await user.click(screen.getByRole('button', { name: "Enregistrer l'accès" }))
    expect(await screen.findByText('Société introuvable')).toBeInTheDocument()
    expect(onSave).toHaveBeenCalledWith({ allCompanies: true, companyIds: [] }, undefined, 'validation')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
