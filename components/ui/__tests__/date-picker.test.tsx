import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { DatePicker, DatePickerWithRange } from '../date-picker'

describe('DatePicker', () => {
  it('shows the placeholder when no date is set', () => {
    render(
      <DatePicker
        onDateChange={vi.fn()}
        placeholder="Choisir une date"
      />
    )
    expect(screen.getByText('Choisir une date')).toBeInTheDocument()
  })

  it('formats and displays the selected date in French', () => {
    render(
      <DatePicker
        date={new Date(2024, 9, 1)}
        onDateChange={vi.fn()}
      />
    )
    // "PPP" with French locale → "1 octobre 2024"
    expect(screen.getByRole('button')).toHaveTextContent('1 octobre 2024')
  })

  it('applies the id to the trigger button', () => {
    render(<DatePicker id="entry-date" onDateChange={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveAttribute('id', 'entry-date')
  })

  it('disables the trigger when disabled is true', () => {
    render(<DatePicker disabled onDateChange={vi.fn()} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('does not open the calendar when disabled', async () => {
    const user = userEvent.setup()
    render(<DatePicker disabled onDateChange={vi.fn()} />)

    await user.click(screen.getByRole('button'))

    // Calendar should not have opened, grid is not rendered.
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })

  it('opens the calendar and calls onDateChange when a day is picked', async () => {
    const onDateChange = vi.fn()
    const user = userEvent.setup()

    render(
      <DatePicker
        date={new Date(2024, 9, 1)}
        onDateChange={onDateChange}
      />
    )

    await user.click(screen.getByRole('button'))

    // Calendar grid should appear
    await waitFor(() => {
      expect(screen.getByRole('grid')).toBeInTheDocument()
    })

    // Click day 15 in the visible month (October 2024).
    const day15 = screen.getByRole('button', { name: /15 octobre 2024/i })
    await user.click(day15)

    expect(onDateChange).toHaveBeenCalledTimes(1)
    const picked = onDateChange.mock.calls[0][0] as Date
    expect(picked).toBeInstanceOf(Date)
    expect(picked.getFullYear()).toBe(2024)
    expect(picked.getMonth()).toBe(9)
    expect(picked.getDate()).toBe(15)
  })

  it('tolerates an invalid Date without crashing', () => {
    render(
      <DatePicker
        date={new Date('not-a-date')}
        onDateChange={vi.fn()}
        placeholder="Sélectionner"
      />
    )
    // Invalid dates fall back to the placeholder rather than rendering NaN.
    expect(screen.getByText('Sélectionner')).toBeInTheDocument()
  })
})

describe('DatePickerWithRange', () => {
  it('shows the default placeholder when no range is set', () => {
    render(<DatePickerWithRange onDateChange={vi.fn()} />)
    expect(screen.getByText('Sélectionner une période')).toBeInTheDocument()
  })

  it('shows only the from date when no end date is set', () => {
    render(
      <DatePickerWithRange
        date={{ from: new Date(2024, 0, 15), to: undefined }}
        onDateChange={vi.fn()}
      />
    )
    expect(screen.getByRole('button')).toHaveTextContent('À partir du 15/01/2024')
  })

  it('shows both dates when a full range is set', () => {
    render(
      <DatePickerWithRange
        date={{ from: new Date(2024, 0, 15), to: new Date(2024, 2, 20) }}
        onDateChange={vi.fn()}
      />
    )
    // French day order, never "janv. 15, 2024" (docs/ui-audit.md)
    expect(screen.getByRole('button')).toHaveTextContent('Du 15/01/2024 au 20/03/2024')
  })

  it('takes an id so a label can name it', () => {
    render(
      <>
        <label htmlFor="periode">Période</label>
        <DatePickerWithRange id="periode" onDateChange={vi.fn()} />
      </>
    )
    expect(screen.getByRole('button', { name: /Période/ })).toBeInTheDocument()
  })

  it('is disabled when the disabled prop is set', () => {
    render(<DatePickerWithRange disabled onDateChange={vi.fn()} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })
})
