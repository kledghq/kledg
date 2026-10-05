/**
 * SegmentedControl: the control that replaces tabs (docs/design-system.md,
 * "No tabs"). One option always selected, counts shown, a named group.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SegmentedControl } from '../segmented-control'

describe('SegmentedControl', () => {
  it('selects one option, keeps it on a second click and shows the counts', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    const { rerender } = render(
      <SegmentedControl
        label="Statut"
        value="todo"
        onValueChange={onValueChange}
        options={[
          { value: 'todo', label: 'À traiter', count: 3 },
          { value: 'done', label: 'Traités', count: 12 },
        ]}
      />,
    )
    expect(screen.getByRole('group', { name: 'Statut' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByRole('radio', { name: 'À traiter 3' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Traités 12' })).toHaveAttribute('aria-checked', 'false')

    await user.click(screen.getByRole('radio', { name: /Traités/ }))
    expect(onValueChange).toHaveBeenCalledWith('done')
    rerender(<SegmentedControl label="Statut" value="done" onValueChange={onValueChange} options={[{ value: 'todo', label: 'À traiter' }, { value: 'done', label: 'Traités' }]} />)
    onValueChange.mockClear()
    // Clicking the selected option never leaves the control without a value
    await user.click(screen.getByRole('radio', { name: 'Traités' }))
    expect(onValueChange).not.toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: 'Traités' })).toHaveAttribute('aria-checked', 'true')
  })
})
