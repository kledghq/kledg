/**
 * "Masquer les lignes à zéro" switch: labelled for assistive technology,
 * says how many lines it hides while on, and reports the new value.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HideZeroLinesToggle } from '../hide-zero-lines-toggle'

describe('HideZeroLinesToggle', () => {
  it('counts the hidden lines while on, in French with the plural', () => {
    const { rerender } = render(<HideZeroLinesToggle id="hide" checked hiddenCount={12} onCheckedChange={vi.fn()} />)
    expect(screen.getByRole('switch', { name: 'Masquer les lignes à zéro' })).toBeChecked()
    expect(screen.getByText('12 lignes masquées')).toBeInTheDocument()

    rerender(<HideZeroLinesToggle id="hide" checked hiddenCount={1} onCheckedChange={vi.fn()} />)
    expect(screen.getByText('1 ligne masquée')).toBeInTheDocument()

    rerender(<HideZeroLinesToggle id="hide" checked hiddenCount={0} onCheckedChange={vi.fn()} />)
    expect(screen.queryByText(/masquée/)).not.toBeInTheDocument()
  })

  it('hides the count while off and reports the new value on click', async () => {
    const onCheckedChange = vi.fn()
    render(<HideZeroLinesToggle id="hide" checked={false} hiddenCount={12} onCheckedChange={onCheckedChange} />)
    expect(screen.queryByText(/masquées/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('Masquer les lignes à zéro'))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })
})
