/**
 * Autocomplete keeps the user typing in its field:
 * - suggestions arriving from a server search while the user types leave the
 *   focus in the field (cmdk moves focus to its input by the id it gave it,
 *   and falls back on the list when that id was replaced by ours);
 * - focusing the closed field starts a new search, but focus coming back
 *   while the list is open (a dialog's focus trap, another window and back)
 *   keeps what was typed.
 *
 * Regression of the flaky members page test: when the first suggestions
 * mounted, focus jumped to the list, so the letter typed next never reached
 * the field (or the dialog's focus trap brought focus back and the field
 * cleared the search), and the typed search was never sent.
 */

import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandGroup } from '@/components/ui/command'
import { Autocomplete, AutocompleteItem } from '../autocomplete'

function Field({ onQuery, results = ['Chloé'] }: { onQuery: (query: string) => void; results?: string[] }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | undefined>()
  return (
    <>
      <label htmlFor="user-field">Utilisateur</label>
      <Autocomplete
        id="user-field"
        query={query}
        onQueryChange={(value) => {
          setQuery(value)
          onQuery(value)
        }}
        selectedLabel={selected}
        shouldFilter={false}
        placeholder="Rechercher"
      >
        {results.length > 0 && (
          <CommandGroup heading="Résultats">
            {results.map((result) => (
              <AutocompleteItem key={result} value={result} onSelect={() => setSelected(result)}>
                {result}
              </AutocompleteItem>
            ))}
          </CommandGroup>
        )}
      </Autocomplete>
      <button type="button">Ailleurs</button>
    </>
  )
}

describe('Autocomplete', () => {
  it('leaves the focus in the field when suggestions arrive while the user types', async () => {
    const onQuery = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(<Field onQuery={onQuery} results={[]} />)
    const input = screen.getByRole('combobox')
    // The field carries the id of the page's label.
    expect(input).toHaveAttribute('id', 'user-field')
    await user.type(input, 'c')
    expect(input).toHaveFocus()

    // The server search answers: the first suggestion mounts and is highlighted.
    rerender(<Field onQuery={onQuery} results={['Chloé', 'Camille']} />)
    expect(await screen.findByText('Chloé')).toBeInTheDocument()
    expect(input).toHaveFocus()
    await user.keyboard('h')
    expect(input).toHaveValue('ch')
    expect(onQuery).toHaveBeenLastCalledWith('ch')
  })

  it('keeps the typed search when focus comes back while the list is open', async () => {
    const onQuery = vi.fn()
    const user = userEvent.setup()
    render(<Field onQuery={onQuery} />)
    const input = screen.getByRole('combobox')
    await user.type(input, 'ch')
    expect(input).toHaveValue('ch')

    // Focus moves into the list and comes back to the field, the list staying
    // open (what the focus trap of a dialog does when the list mounts late).
    act(() => screen.getByRole('listbox').focus())
    expect(input).not.toHaveFocus()
    act(() => input.focus())

    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(input).toHaveValue('ch')
    expect(onQuery).toHaveBeenLastCalledWith('ch')
  })

  it('starts a new search when the closed field is focused again', async () => {
    const onQuery = vi.fn()
    const user = userEvent.setup()
    render(<Field onQuery={onQuery} />)
    const input = screen.getByRole('combobox')
    await user.type(input, 'ch')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await user.click(input)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(input).toHaveValue('')
    expect(onQuery).toHaveBeenLastCalledWith('')
  })
})
