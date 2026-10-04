import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AmountInput } from '../amount-input'
import { DateInput } from '../date-input'

function ControlledAmount({ initial = null, onError }: { initial?: number | null; onError?: (e: string | null) => void }) {
  const [value, setValue] = useState<number | null>(initial)
  return (
    <>
      <AmountInput aria-label="Montant" value={value} onValueChange={setValue} onErrorChange={onError} />
      <output data-testid="cents">{value === null ? 'null' : value}</output>
    </>
  )
}

describe('AmountInput', () => {
  it('is a text input without spinner, with a decimal keyboard', () => {
    render(<ControlledAmount />)
    const input = screen.getByLabelText('Montant')
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAttribute('inputmode', 'decimal')
  })

  it.each([
    ['1 234,56', '123456'],
    ['1234.56', '123456'],
    ['1 234,5', '123450'],
  ])('reads %j as %s cents and formats it on blur', async (typed, cents) => {
    const user = userEvent.setup()
    render(<ControlledAmount />)
    const input = screen.getByLabelText('Montant')
    await user.type(input, typed)
    expect(screen.getByTestId('cents')).toHaveTextContent(cents)
    await user.tab()
    expect(input).toHaveValue(`${Math.floor(Number(cents) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${cents.slice(-2)}`)
  })

  it('reports invalid text and keeps it for the user to fix', async () => {
    const user = userEvent.setup()
    const onError = vi.fn()
    render(<ControlledAmount onError={onError} />)
    const input = screen.getByLabelText('Montant')
    await user.type(input, '12,345')
    expect(onError).toHaveBeenLastCalledWith('Deux décimales au maximum')
    expect(screen.getByTestId('cents')).toHaveTextContent('null')
    await user.tab()
    expect(input).toHaveValue('12,345')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await user.type(input, '{Backspace}')
    expect(onError).toHaveBeenLastCalledWith(null)
    expect(screen.getByTestId('cents')).toHaveTextContent('1234')
  })

  it('shows external values formatted', () => {
    render(<ControlledAmount initial={100000} />)
    expect(screen.getByLabelText('Montant')).toHaveValue('1 000,00')
  })
})

function ControlledDate({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <DateInput aria-label="Date" value={value} onValueChange={setValue} />
      <output data-testid="iso">{value || 'empty'}</output>
    </>
  )
}

describe('DateInput', () => {
  it('shows an ISO value as dd/mm/yyyy', () => {
    render(<ControlledDate initial="2026-03-05" />)
    expect(screen.getByLabelText('Date')).toHaveValue('05/03/2026')
  })

  it('reads French dates into an ISO value', async () => {
    const user = userEvent.setup()
    render(<ControlledDate />)
    const input = screen.getByLabelText('Date')
    await user.type(input, '31122026')
    expect(screen.getByTestId('iso')).toHaveTextContent('2026-12-31')
    await user.tab()
    expect(input).toHaveValue('31/12/2026')
  })

  it('refuses a month-first date instead of swapping it', async () => {
    const user = userEvent.setup()
    render(<ControlledDate initial="2026-03-05" />)
    const input = screen.getByLabelText('Date')
    await user.clear(input)
    await user.type(input, '12/31/2026')
    await user.tab()
    expect(screen.getByTestId('iso')).toHaveTextContent('empty')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })
})
