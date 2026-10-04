import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Label } from '@/components/ui/label'
import { FileInput } from '../file-input'

describe('FileInput', () => {
  it('shows a French button and the empty text instead of the native control', () => {
    render(<FileInput id="statement" accept=".csv" />)
    expect(screen.getByRole('button', { name: /Choisir un fichier/ })).toBeTruthy()
    expect(screen.getByText('Aucun fichier choisi')).toBeTruthy()
  })

  it('opens the native picker from the button or its label and shows the chosen name', () => {
    const onChange = vi.fn()
    const { container } = render(
      <>
        <Label htmlFor="statement">Fichier du relevé</Label>
        <FileInput id="statement" accept=".csv" onChange={onChange} />
      </>,
    )
    const native = container.querySelector('input[type="file"]') as HTMLInputElement
    const click = vi.spyOn(native, 'click')
    const button = screen.getByRole('button', { name: 'Fichier du relevé' })
    fireEvent.click(button)
    expect(click).toHaveBeenCalledTimes(1)
    expect(native.getAttribute('accept')).toBe('.csv')
    expect(native.tabIndex).toBe(-1)

    const file = new File(['a;b'], 'releve-octobre.csv', { type: 'text/csv' })
    fireEvent.change(native, { target: { files: [file] } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(screen.getByText('releve-octobre.csv')).toBeTruthy()
    expect(button.getAttribute('aria-describedby')).toContain('statement-name')
  })

  it('follows a controlled file name', () => {
    const { rerender } = render(<FileInput fileName="plan.fec" />)
    expect(screen.getByText('plan.fec')).toBeTruthy()
    rerender(<FileInput fileName={null} />)
    expect(screen.getByText('Aucun fichier choisi')).toBeTruthy()
  })
})
