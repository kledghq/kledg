import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { FiscalYearSelector } from '../fiscal-year-selector'
import { logger } from '@/lib/logger'

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

type FiscalYear = {
  id: string
  year: number
  startDate: string
  endDate: string
  isClosed: boolean
}

const FY_2024_CLOSED: FiscalYear = {
  id: 'fy-2024',
  year: 2024,
  startDate: '2024-01-01',
  endDate: '2024-12-31',
  isClosed: true,
}

const FY_2025_ACTIVE: FiscalYear = {
  id: 'fy-2025',
  year: 2025,
  startDate: '2025-01-01',
  endDate: '2025-12-31',
  isClosed: false,
}

const FY_2023_CLOSED: FiscalYear = {
  id: 'fy-2023',
  year: 2023,
  startDate: '2023-01-01',
  endDate: '2023-12-31',
  isClosed: true,
}

function mockFetchFiscalYears(data: FiscalYear[]): {
  resolve: () => void
  reject: (err: unknown) => void
} {
  let resolve!: () => void
  let reject!: (err: unknown) => void
  const gate = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  const response = {
    ok: true,
    json: async () => data,
  } as unknown as Response
  global.fetch = vi.fn(async () => {
    await gate
    return response
  }) as unknown as typeof fetch
  return { resolve, reject }
}

function mockFetchFailure(): void {
  const response = { ok: false, json: async () => ({}) } as unknown as Response
  global.fetch = vi.fn(async () => response) as unknown as typeof fetch
}

function mockFetchReject(): void {
  global.fetch = vi.fn(async () => {
    throw new Error('network down')
  }) as unknown as typeof fetch
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
}

describe('FiscalYearSelector', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('race condition (regression)', () => {
    it('does not overwrite a value that the parent provides after mount', async () => {
      // Simulates the edit page: parent initially passes value='', then updates to the entry's
      // fiscal year via a useEffect after mount. The selector's fetch resolves *after* the parent
      // has propagated the real value. The selector must NOT call onValueChange with the active
      // fiscal year in this case, because it would silently overwrite the entry's fiscal year.
      const onValueChange = vi.fn()
      const { resolve } = mockFetchFiscalYears([FY_2025_ACTIVE, FY_2024_CLOSED])

      function Parent() {
        const [value, setValue] = useState('')
        useEffect(() => {
          setValue('fy-2024')
        }, [])
        return (
          <FiscalYearSelector
            companyId="company-1"
            value={value}
            onValueChange={onValueChange}
          />
        )
      }

      render(<Parent />)

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/companies/company-1/fiscal-years'
        )
      })

      resolve()
      await flushMicrotasks()
      await flushMicrotasks()

      expect(onValueChange).not.toHaveBeenCalled()
    })
  })

  describe('auto-selection', () => {
    it('auto-selects the active fiscal year when no value is provided', async () => {
      const onValueChange = vi.fn()
      const { resolve } = mockFetchFiscalYears([FY_2025_ACTIVE, FY_2024_CLOSED])

      render(
        <FiscalYearSelector
          companyId="company-1"
          value=""
          onValueChange={onValueChange}
        />
      )

      await waitFor(() => expect(global.fetch).toHaveBeenCalled())
      resolve()

      await waitFor(() => {
        expect(onValueChange).toHaveBeenCalledWith('fy-2025')
      })
      expect(onValueChange).toHaveBeenCalledTimes(1)
    })

    it('falls back to the most recent year when no active year exists', async () => {
      const onValueChange = vi.fn()
      const { resolve } = mockFetchFiscalYears([FY_2023_CLOSED, FY_2024_CLOSED])

      render(
        <FiscalYearSelector
          companyId="company-1"
          value=""
          onValueChange={onValueChange}
        />
      )

      await waitFor(() => expect(global.fetch).toHaveBeenCalled())
      resolve()

      await waitFor(() => {
        expect(onValueChange).toHaveBeenCalledWith('fy-2024')
      })
    })

    it('does not auto-select when the parent already provided a value on mount', async () => {
      const onValueChange = vi.fn()
      const { resolve } = mockFetchFiscalYears([FY_2025_ACTIVE, FY_2024_CLOSED])

      render(
        <FiscalYearSelector
          companyId="company-1"
          value="fy-2024"
          onValueChange={onValueChange}
        />
      )

      await waitFor(() => expect(global.fetch).toHaveBeenCalled())
      resolve()
      await flushMicrotasks()
      await flushMicrotasks()

      expect(onValueChange).not.toHaveBeenCalled()
    })
  })

  describe('loading and empty states', () => {
    it('shows a loading skeleton while the fetch is in flight', async () => {
      const { resolve } = mockFetchFiscalYears([FY_2025_ACTIVE])

      const { container } = render(
        <FiscalYearSelector
          companyId="company-1"
          value=""
          onValueChange={vi.fn()}
        />
      )

      await waitFor(() => expect(global.fetch).toHaveBeenCalled())

      expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()

      resolve()
      await waitFor(() => {
        expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
      })
    })

    it('renders an empty-state message when the company has no fiscal years', async () => {
      const { resolve } = mockFetchFiscalYears([])

      render(
        <FiscalYearSelector
          companyId="company-1"
          value=""
          onValueChange={vi.fn()}
        />
      )

      await waitFor(() => expect(global.fetch).toHaveBeenCalled())
      resolve()

      await waitFor(() => {
        expect(
          screen.getByText('Aucun exercice. Créez le premier dans Exercices.')
        ).toBeInTheDocument()
      })
    })

    it('does not fetch when companyId is empty', async () => {
      global.fetch = vi.fn() as unknown as typeof fetch

      render(
        <FiscalYearSelector
          companyId=""
          value=""
          onValueChange={vi.fn()}
        />
      )

      await flushMicrotasks()
      expect(global.fetch).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('logs and stops loading when the response is not ok', async () => {
      mockFetchFailure()
      const onValueChange = vi.fn()

      const { container } = render(
        <FiscalYearSelector
          companyId="company-1"
          value=""
          onValueChange={onValueChange}
        />
      )

      await waitFor(() => {
        expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
      })

      expect(onValueChange).not.toHaveBeenCalled()
    })

    it('logs and stops loading when fetch throws', async () => {
      mockFetchReject()
      const onValueChange = vi.fn()

      const { container } = render(
        <FiscalYearSelector
          companyId="company-1"
          value=""
          onValueChange={onValueChange}
        />
      )

      await waitFor(() => {
        expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
      })

      expect(logger.error).toHaveBeenCalled()
      expect(onValueChange).not.toHaveBeenCalled()
    })
  })

  describe('rendering', () => {
    it('hides the label when showLabel is false', async () => {
      const { resolve } = mockFetchFiscalYears([FY_2025_ACTIVE])

      render(
        <FiscalYearSelector
          companyId="company-1"
          value="fy-2025"
          onValueChange={vi.fn()}
          showLabel={false}
        />
      )

      await waitFor(() => expect(global.fetch).toHaveBeenCalled())
      resolve()

      await waitFor(() => {
        expect(screen.queryByText('Exercice')).not.toBeInTheDocument()
      })
    })

    it('in a toolbar: takes the id of an outside label and hides the period', async () => {
      const { resolve } = mockFetchFiscalYears([FY_2025_ACTIVE, FY_2024_CLOSED])

      render(
        <>
          <label htmlFor="toolbar-year">Exercice</label>
          <FiscalYearSelector
            companyId="company-1"
            value="fy-2024"
            onValueChange={vi.fn()}
            showLabel={false}
            showPeriod={false}
            id="toolbar-year"
          />
        </>
      )

      await waitFor(() => expect(global.fetch).toHaveBeenCalled())
      resolve()

      await waitFor(() => {
        expect(screen.getByRole('combobox', { name: /Exercice/ })).toHaveAttribute('id', 'toolbar-year')
      })
      expect(screen.queryByText(/01\/01\/2024/)).not.toBeInTheDocument()
    })

    it('shows the selected year and its date range', async () => {
      const { resolve } = mockFetchFiscalYears([FY_2025_ACTIVE, FY_2024_CLOSED])

      render(
        <FiscalYearSelector
          companyId="company-1"
          value="fy-2024"
          onValueChange={vi.fn()}
        />
      )

      await waitFor(() => expect(global.fetch).toHaveBeenCalled())
      resolve()

      await waitFor(() => {
        expect(screen.getByText('2024')).toBeInTheDocument()
      })
      // Date range is rendered under the select. French locale: dd/MM/yyyy.
      expect(screen.getByText(/01\/01\/2024/)).toBeInTheDocument()
      expect(screen.getByText(/31\/12\/2024/)).toBeInTheDocument()
    })

    it('disables the trigger when the disabled prop is set', async () => {
      const { resolve } = mockFetchFiscalYears([FY_2025_ACTIVE])

      render(
        <FiscalYearSelector
          companyId="company-1"
          value="fy-2025"
          onValueChange={vi.fn()}
          disabled
        />
      )

      await waitFor(() => expect(global.fetch).toHaveBeenCalled())
      resolve()

      await waitFor(() => {
        const trigger = screen.getByRole('combobox')
        expect(trigger).toBeDisabled()
      })
    })
  })
})
