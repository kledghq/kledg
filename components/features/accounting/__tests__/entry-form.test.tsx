import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EntryForm } from '../entry-form'

const pushMock = vi.fn()
const refreshMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

// Stub the DatePicker with a simple native input so we don't fight Radix popovers.
vi.mock('@/components/ui/date-picker', () => ({
  DatePicker: ({
    date,
    onDateChange,
    id,
  }: {
    date?: Date
    onDateChange: (d: Date | undefined) => void
    id?: string
  }) => (
    <input
      data-testid="date-picker"
      id={id}
      type="date"
      value={date ? date.toISOString().slice(0, 10) : ''}
      onChange={(e) => {
        const v = e.target.value
        onDateChange(v ? new Date(v + 'T00:00:00') : undefined)
      }}
    />
  ),
}))

// Stub AccountCombobox with a plain <select> so tests can interact without Radix.
vi.mock('@/components/features/accounting/account-combobox', () => ({
  AccountCombobox: ({
    accounts,
    value,
    onValueChange,
  }: {
    accounts: Array<{ id: string; code: string; label: string }>
    value: string
    onValueChange: (v: string) => void
  }) => (
    <select
      data-testid="account-combobox"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="none">Sélectionner un compte</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.code} - {a.label}
        </option>
      ))}
    </select>
  ),
}))

const journals = [
  { id: 'journal-od', code: 'OD', label: 'Opérations diverses' },
  { id: 'journal-ac', code: 'AC', label: 'Achats' },
]

const accounts = [
  { id: 'acc-1', code: '411000', label: 'Clients' },
  { id: 'acc-2', code: '707000', label: 'Ventes de marchandises' },
]

const FY_2024 = {
  id: 'fy-2024',
  year: 2024,
  startDate: '2024-01-01',
  endDate: '2024-12-31',
  isClosed: false,
}

const FY_2025 = {
  id: 'fy-2025',
  year: 2025,
  startDate: '2025-01-01',
  endDate: '2025-12-31',
  isClosed: false,
}

interface FetchHandlers {
  fiscalYears?: unknown[]
  nextNumber?: string
  entry?: Record<string, unknown>
  onEntrySubmit?: (payload: unknown, method: string) => Response | Promise<Response>
}

function installFetchMock(handlers: FetchHandlers = {}): void {
  const json = (data: unknown): Response =>
    ({ ok: true, json: async () => data }) as unknown as Response

  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()

    if (url.includes('/api/companies/') && url.includes('/fiscal-years')) {
      return json(handlers.fiscalYears ?? [FY_2025])
    }
    if (url.includes('/api/entries/next-number')) {
      return json({ nextNumber: handlers.nextNumber ?? '1' })
    }
    if (url.match(/\/api\/entries\/[^/]+$/) && (!init || init.method === undefined)) {
      return json(handlers.entry ?? {})
    }
    if (url.includes('/api/accounts')) {
      return json(accounts)
    }
    if (url === '/api/entries' || url.match(/\/api\/entries\/[^/]+$/)) {
      const body = init?.body ? JSON.parse(init.body as string) : {}
      if (handlers.onEntrySubmit) {
        return await handlers.onEntrySubmit(body, init?.method ?? 'POST')
      }
      return json({ id: 'new-entry' })
    }
    return json({})
  }) as unknown as typeof fetch
}

describe('EntryForm', () => {
  beforeEach(() => {
    pushMock.mockReset()
    refreshMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('edit mode', () => {
    const initialData = {
      journalId: 'journal-od',
      date: '2024-10-01',
      description: 'Description existante',
      reference: 'REF-42',
      fiscalYearId: 'fy-2024',
      lines: [
        { accountId: 'acc-1', debit: 39448.52, credit: 0, description: 'ligne 1' },
        { accountId: 'acc-2', debit: 0, credit: 39448.52, description: 'ligne 2' },
      ],
    }

    it('uses the entry fiscal year even when another year is the active one (bug regression)', async () => {
      // Returns both 2024 and 2025. 2025 is active; the entry belongs to 2024. The form
      // must not drift to 2025 on mount. This is the form-level counterpart to the
      // fiscal-year-selector race condition regression.
      installFetchMock({ fiscalYears: [FY_2025, FY_2024] })

      render(
        <EntryForm
          companyId="company-1"
          journals={journals}
          accounts={accounts}
          entryId="entry-1"
          initialData={initialData}
        />
      )

      // Wait for the selector's fetch + render to settle.
      await waitFor(() => {
        expect(screen.getByText('2024')).toBeInTheDocument()
      })
      // The active (2025) year must NOT be the displayed/selected one.
      // The selector renders the selected year inside the trigger; the other only appears
      // in the (closed) dropdown, so it should not be visible.
      expect(screen.queryByText('2025')).not.toBeInTheDocument()
    })

    it('submits PATCH with the entry fiscal year', async () => {
      const onEntrySubmit = vi.fn(async (_payload: unknown, _method: string) => ({
        ok: true,
        json: async () => ({ id: 'entry-1' }),
      }) as unknown as Response)

      installFetchMock({ fiscalYears: [FY_2025, FY_2024], onEntrySubmit })

      const user = userEvent.setup()
      render(
        <EntryForm
          companyId="company-1"
          journals={journals}
          accounts={accounts}
          entryId="entry-1"
          initialData={initialData}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('2024')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /Enregistrer/i }))

      await waitFor(() => {
        expect(onEntrySubmit).toHaveBeenCalled()
      })

      const [payload, method] = onEntrySubmit.mock.calls[0]
      expect(method).toBe('PATCH')
      expect(payload).toMatchObject({
        companyId: 'company-1',
        fiscalYearId: 'fy-2024',
        journalId: 'journal-od',
        date: '2024-10-01',
        description: 'Description existante',
        reference: 'REF-42',
      })
      expect((payload as { lines: unknown[] }).lines).toHaveLength(2)
    })

    it('disables the fiscal year selector', async () => {
      installFetchMock({ fiscalYears: [FY_2025, FY_2024] })

      render(
        <EntryForm
          companyId="company-1"
          journals={journals}
          accounts={accounts}
          entryId="entry-1"
          initialData={initialData}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('2024')).toBeInTheDocument()
      })

      // The FiscalYearSelector trigger has role=combobox and is disabled in edit mode.
      const comboboxes = screen.getAllByRole('combobox')
      const fiscalYearTrigger = comboboxes.find(
        (el) => el.id === 'fiscal-year-select'
      )
      expect(fiscalYearTrigger).toBeDefined()
      expect(fiscalYearTrigger).toBeDisabled()
    })

    it('prefills description and reference from initialData', async () => {
      installFetchMock({ fiscalYears: [FY_2025, FY_2024] })

      render(
        <EntryForm
          companyId="company-1"
          journals={journals}
          accounts={accounts}
          entryId="entry-1"
          initialData={initialData}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('2024')).toBeInTheDocument()
      })

      expect(screen.getByLabelText(/^Description/)).toHaveValue(
        'Description existante'
      )
      expect(screen.getByLabelText(/^Référence/)).toHaveValue('REF-42')
      // Amounts shown the French way
      expect(screen.getByLabelText('Débit, ligne 1')).toHaveValue('39 448,52')
    })
  })

  describe('create mode', () => {
    it('auto-selects the active fiscal year when creating a new entry', async () => {
      installFetchMock({ fiscalYears: [FY_2025, FY_2024] })

      render(
        <EntryForm
          companyId="company-1"
          journals={journals}
          accounts={accounts}
        />
      )

      // Active year 2025 should be selected & displayed in the trigger.
      await waitFor(() => {
        expect(screen.getByText('2025')).toBeInTheDocument()
      })
    })

    it('submits POST with the selected fiscal year', async () => {
      const onEntrySubmit = vi.fn(async (_payload: unknown, _method: string) => ({
        ok: true,
        json: async () => ({ id: 'new-entry' }),
      }) as unknown as Response)

      installFetchMock({ fiscalYears: [FY_2025], onEntrySubmit })

      const user = userEvent.setup()
      render(
        <EntryForm
          companyId="company-1"
          journals={journals}
          accounts={accounts}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('2025')).toBeInTheDocument()
      })

      // Fill required fields.
      // Radix Select interactions are flaky in jsdom (pointer/portal quirks), so
      // we open the journal select with the keyboard and pick the first option.
      const comboboxes = screen.getAllByRole('combobox')
      const journalTrigger = comboboxes.find(
        (el) => el.id !== 'fiscal-year-select'
      )!
      journalTrigger.focus()
      await user.keyboard('{Enter}')
      await user.keyboard('{ArrowDown}{Enter}')

      // Date
      const datePicker = screen.getByTestId('date-picker') as HTMLInputElement
      await user.clear(datePicker)
      await user.type(datePicker, '2025-06-15')

      // Lines: pick accounts and amounts
      const accountSelects = screen.getAllByTestId('account-combobox')
      await user.selectOptions(accountSelects[0], 'acc-1')
      await user.selectOptions(accountSelects[1], 'acc-2')

      await user.type(screen.getByLabelText('Débit, ligne 1'), '100,50')
      await user.type(screen.getByLabelText('Crédit, ligne 2'), '100,5')

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /Enregistrer/i })
        ).not.toBeDisabled()
      })

      await user.click(screen.getByRole('button', { name: /Enregistrer/i }))

      await waitFor(() => {
        expect(onEntrySubmit).toHaveBeenCalled()
      })

      const [payload, method] = onEntrySubmit.mock.calls[0]
      expect(method).toBe('POST')
      expect(payload).toMatchObject({
        companyId: 'company-1',
        fiscalYearId: 'fy-2025',
      })
      // Journal selected via Radix keyboard nav, exact id depends on Radix's
      // internal ordering, so we just assert it's one of the valid ids.
      expect(journals.map((j) => j.id)).toContain(
        (payload as { journalId: string }).journalId
      )
      // French amounts typed, euros sent as before
      expect((payload as { lines: Array<{ debit: number; credit: number }> }).lines.map((l) => [l.debit, l.credit])).toEqual([
        [100.5, 0],
        [0, 100.5],
      ])
    })
  })

  describe('accessibility', () => {
    it('labels every field of every line and names the line buttons', async () => {
      installFetchMock({ fiscalYears: [FY_2025] })
      const user = userEvent.setup()
      render(<EntryForm companyId="company-1" journals={journals} accounts={accounts} />)
      await waitFor(() => expect(screen.getByText('2025')).toBeInTheDocument())

      expect(screen.getByRole('heading', { level: 1, name: 'Nouvelle écriture' })).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: /Journal/ })).toBeInTheDocument()
      for (const n of [1, 2]) {
        for (const label of ['Libellé', 'Débit', 'Crédit']) {
          expect(screen.getByLabelText(`${label}, ligne ${n}`)).toBeInTheDocument()
        }
      }
      await user.click(screen.getByRole('button', { name: 'Ajouter une ligne' }))
      expect(screen.getByLabelText('Débit, ligne 3')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Supprimer la ligne 3' }))
      expect(screen.queryByLabelText('Débit, ligne 3')).not.toBeInTheDocument()
    })

    // One markup for every width: a grid row on wide containers, a card per
    // line on phones (container queries), so typed values survive a rotation.
    it('groups the fields of each line in one item, a card on narrow screens', async () => {
      installFetchMock({ fiscalYears: [FY_2025] })
      const user = userEvent.setup()
      render(<EntryForm companyId="company-1" journals={journals} accounts={accounts} />)
      await waitFor(() => expect(screen.getByText('2025')).toBeInTheDocument())

      const lines = screen.getAllByRole('listitem').filter((item) => /^Ligne \d$/.test(item.getAttribute('aria-label') ?? ''))
      expect(lines.map((item) => item.getAttribute('aria-label'))).toEqual(['Ligne 1', 'Ligne 2'])
      const first = lines[0]
      expect(first.closest('[class*="@container/lines"]')).not.toBeNull()
      expect(first).toContainElement(screen.getByText('Compte, ligne 1'))
      for (const label of ['Libellé, ligne 1', 'Débit, ligne 1', 'Crédit, ligne 1']) {
        expect(first).toContainElement(screen.getByLabelText(label))
      }

      await user.type(screen.getByLabelText('Débit, ligne 1'), '100,50')
      await user.type(screen.getByLabelText('Crédit, ligne 2'), '100,5')
      // Totals named for the cards, and the balance shown next to the sticky actions on phones
      expect(screen.getByText('Total débit').parentElement).toHaveTextContent('100,50 €')
      expect(screen.getByText('Total crédit').parentElement).toHaveTextContent('100,50 €')
      expect(screen.getByText('Écriture équilibrée')).toBeInTheDocument()
    })
  })

  describe('validation', () => {
    it('disables the submit button when lines are unbalanced', async () => {
      installFetchMock({ fiscalYears: [FY_2025] })

      const user = userEvent.setup()
      render(
        <EntryForm
          companyId="company-1"
          journals={journals}
          accounts={accounts}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('2025')).toBeInTheDocument()
      })

      await user.type(screen.getByLabelText('Débit, ligne 1'), '100')
      // Leave credit at 0, unbalanced.

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /Enregistrer/i })
        ).toBeDisabled()
      })

      expect(
        screen.getByText(/doit être égal au total crédit/i)
      ).toBeInTheDocument()
    })
  })
})
