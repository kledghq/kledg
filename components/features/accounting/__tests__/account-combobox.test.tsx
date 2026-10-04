import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { AccountCombobox } from '../account-combobox'

type Account = {
  id: string
  code: string
  label: string
  parentId?: string | null
  isPCG?: boolean
}

const ACCOUNTS: Account[] = [
  { id: '1', code: '411000', label: 'Clients', isPCG: true },
  { id: '2', code: '512000', label: 'Banque', isPCG: true },
  { id: '3', code: '512001', label: 'Banque secondaire', parentId: '2', isPCG: false },
  { id: '4', code: '606100', label: 'Fournitures non stockables', isPCG: true },
  { id: '5', code: '707000', label: 'Ventes de marchandises', isPCG: true },
  { id: '6', code: '218400', label: 'Mobilier', isPCG: true },
  // Custom (non-PCG) root account used by the isPCG={false} test. Without a
  // root, the component's hierarchy walker can't surface orphaned children.
  { id: '7', code: '999000', label: 'Compte personnalisé', isPCG: false },
]

async function openPopover(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const trigger = screen.getByRole('combobox')
  await user.click(trigger)
  await waitFor(() => {
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })
}

describe('AccountCombobox', () => {
  describe('rendering', () => {
    it('shows the placeholder when no value is selected', () => {
      render(
        <AccountCombobox
          accounts={ACCOUNTS}
          onValueChange={vi.fn()}
          placeholder="Choisir un compte"
        />
      )
      expect(screen.getByPlaceholderText('Choisir un compte')).toBeInTheDocument()
    })

    it('shows the selected account code and label', () => {
      render(
        <AccountCombobox
          accounts={ACCOUNTS}
          value="1"
          onValueChange={vi.fn()}
        />
      )
      expect(screen.getByDisplayValue('411000 - Clients')).toBeInTheDocument()
    })

    it('shows the none-option label when value="none" and showNoneOption is set', () => {
      render(
        <AccountCombobox
          accounts={ACCOUNTS}
          value="none"
          showNoneOption
          noneOptionLabel="Aucun compte"
          onValueChange={vi.fn()}
        />
      )
      expect(screen.getByDisplayValue('Aucun compte')).toBeInTheDocument()
    })

    it('applies a custom id to the trigger', () => {
      render(
        <AccountCombobox
          accounts={ACCOUNTS}
          onValueChange={vi.fn()}
          id="compte-select"
        />
      )
      expect(screen.getByRole('combobox')).toHaveAttribute('id', 'compte-select')
    })
  })

  describe('filtering', () => {
    it('filters by codePrefix', async () => {
      const user = userEvent.setup()
      render(
        <AccountCombobox
          accounts={ACCOUNTS}
          onValueChange={vi.fn()}
          codePrefix="5"
        />
      )

      await openPopover(user)

      // 512000, 512001 visible; 411000 / 707000 / 606100 / 218400 filtered out.
      expect(screen.getByText('512000')).toBeInTheDocument()
      expect(screen.getByText('512001')).toBeInTheDocument()
      expect(screen.queryByText('411000')).not.toBeInTheDocument()
      expect(screen.queryByText('707000')).not.toBeInTheDocument()
    })

    it('filters by a single accountClass', async () => {
      const user = userEvent.setup()
      render(
        <AccountCombobox
          accounts={ACCOUNTS}
          onValueChange={vi.fn()}
          accountClass={4}
        />
      )

      await openPopover(user)

      expect(screen.getByText('411000')).toBeInTheDocument()
      expect(screen.queryByText('512000')).not.toBeInTheDocument()
    })

    it('filters by multiple accountClasses', async () => {
      const user = userEvent.setup()
      render(
        <AccountCombobox
          accounts={ACCOUNTS}
          onValueChange={vi.fn()}
          accountClasses={[4, 5]}
        />
      )

      await openPopover(user)

      expect(screen.getByText('411000')).toBeInTheDocument()
      expect(screen.getByText('512000')).toBeInTheDocument()
      expect(screen.queryByText('606100')).not.toBeInTheDocument()
    })

    it('filters by isPCG flag', async () => {
      const user = userEvent.setup()
      render(
        <AccountCombobox
          accounts={ACCOUNTS}
          onValueChange={vi.fn()}
          isPCG={false}
        />
      )

      await openPopover(user)

      expect(screen.getByText('999000')).toBeInTheDocument()
      expect(screen.queryByText('411000')).not.toBeInTheDocument()
      expect(screen.queryByText('512000')).not.toBeInTheDocument()
    })

    it('excludes accounts via excludeAccountIds', async () => {
      const user = userEvent.setup()
      render(
        <AccountCombobox
          accounts={ACCOUNTS}
          onValueChange={vi.fn()}
          excludeAccountIds={['1', '2']}
        />
      )

      await openPopover(user)

      expect(screen.queryByText('411000')).not.toBeInTheDocument()
      expect(screen.queryByText('512000')).not.toBeInTheDocument()
      expect(screen.getByText('707000')).toBeInTheDocument()
    })

    it('includeAccountIds overrides other filters', async () => {
      const user = userEvent.setup()
      render(
        <AccountCombobox
          accounts={ACCOUNTS}
          onValueChange={vi.fn()}
          includeAccountIds={['1']}
          // These would normally filter 411000 out, but includeAccountIds wins.
          codePrefix="5"
          accountClass={6}
        />
      )

      await openPopover(user)

      expect(screen.getByText('411000')).toBeInTheDocument()
      expect(screen.queryByText('512000')).not.toBeInTheDocument()
    })

    it('always keeps the currently selected account visible even if filtered out', async () => {
      const user = userEvent.setup()
      render(
        <AccountCombobox
          accounts={ACCOUNTS}
          onValueChange={vi.fn()}
          value="1" // 411000
          codePrefix="5"
        />
      )

      await openPopover(user)

      // 411000 would be filtered by codePrefix='5' but must still be visible
      // because it's the selected account.
      expect(screen.getByText('411000')).toBeInTheDocument()
    })
  })

  describe('selection', () => {
    it('calls onValueChange with the account id when an account is selected', async () => {
      const onValueChange = vi.fn()
      const user = userEvent.setup()

      render(<AccountCombobox accounts={ACCOUNTS} onValueChange={onValueChange} />)

      await openPopover(user)
      await user.click(screen.getByText('411000'))

      expect(onValueChange).toHaveBeenCalledWith('1')
    })

    it('clears the selection when the already-selected account is clicked again', async () => {
      const onValueChange = vi.fn()
      const user = userEvent.setup()

      render(
        <AccountCombobox
          accounts={ACCOUNTS}
          onValueChange={onValueChange}
          value="1"
        />
      )

      await openPopover(user)
      await user.click(screen.getByText('411000'))

      expect(onValueChange).toHaveBeenCalledWith('')
    })
  })
})
