'use client'

import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { CommandItem, CommandList } from '@/components/ui/command'

const AutocompleteContext = React.createContext<{ close: () => void } | null>(null)

interface AutocompleteProps {
  /** Text shown in the field when it is closed (the current selection). */
  selectedLabel?: string
  placeholder?: string
  /** Controlled search text, for server-side search. Uncontrolled by default. */
  query?: string
  onQueryChange?: (query: string) => void
  /** Let cmdk filter items locally. Turn off when the parent filters (server search). */
  shouldFilter?: boolean
  disabled?: boolean
  id?: string
  /** On-screen keyboard to show: "email" also turns off capitalization and spell check. */
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  className?: string
  /** CommandGroup / AutocompleteItem / CommandEmpty elements. */
  children: React.ReactNode
}

/**
 * A single text field with a suggestion list underneath (combobox pattern).
 * Typing filters the list; arrow keys and Enter pick an item; when closed the
 * field shows the selected value. Replaces the "button + popover with a second
 * search input" pattern.
 */
export function Autocomplete({
  selectedLabel,
  placeholder,
  query,
  onQueryChange,
  shouldFilter = true,
  disabled,
  id,
  inputMode,
  className,
  children,
}: AutocompleteProps) {
  const [open, setOpen] = React.useState(false)
  const [localQuery, setLocalQuery] = React.useState('')
  const anchorRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const search = query ?? localQuery

  // cmdk assigns its own id to the input; restore ours so <label htmlFor> works.
  // cmdk then cannot find its input by id: when the highlighted item changes
  // (suggestions arriving while the user types) it would move focus to the
  // list instead, and the next keystrokes would be lost. It only does so for
  // an element marked cmdk-input, so the mark goes with the id.
  React.useEffect(() => {
    if (id && inputRef.current) {
      inputRef.current.id = id
      inputRef.current.removeAttribute('cmdk-input')
    }
  })
  const setSearch = onQueryChange ?? setLocalQuery

  const close = React.useCallback(() => {
    setOpen(false)
    setSearch('')
    inputRef.current?.blur()
  }, [setSearch])

  return (
    <AutocompleteContext.Provider value={{ close }}>
      <CommandPrimitive shouldFilter={shouldFilter} loop className={cn('w-full', className)}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverAnchor asChild>
            <div ref={anchorRef} className="relative">
              <CommandPrimitive.Input
                ref={inputRef}
                id={id}
                data-slot="autocomplete-input"
                inputMode={inputMode}
                autoCapitalize={inputMode === 'email' ? 'none' : undefined}
                spellCheck={inputMode === 'email' ? false : undefined}
                role="combobox"
                aria-expanded={open}
                disabled={disabled}
                value={open ? search : (selectedLabel ?? '')}
                placeholder={selectedLabel || placeholder}
                onValueChange={(value) => {
                  // cmdk also echoes programmatic resets here: only typing in
                  // the focused field should open the list.
                  if (document.activeElement !== inputRef.current) return
                  setSearch(value)
                  if (!open) setOpen(true)
                }}
                onFocus={() => {
                  // Focusing the closed field starts a new search. Focus coming
                  // back while the list is open (a dialog's focus trap, another
                  // window and back) keeps what was typed.
                  if (open) return
                  setSearch('')
                  setOpen(true)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') close()
                }}
                className={cn(
                  'border-input bg-transparent dark:bg-input/30 flex h-9 w-full min-w-0 rounded-md border pl-3 pr-9 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow]',
                  // Touch screens: 44px, like Input (app/globals.css)
                  'pointer-coarse:min-h-11',
                  'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  selectedLabel && !open && 'placeholder:text-foreground',
                )}
              />
              <ChevronsUpDown
                aria-hidden
                className="text-muted-foreground pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 opacity-60"
              />
            </div>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            sideOffset={4}
            className="w-[var(--radix-popover-trigger-width)] p-0 z-[100]"
            // Keep focus in the field so the user can keep typing.
            onOpenAutoFocus={(event) => event.preventDefault()}
            onInteractOutside={(event) => {
              if (anchorRef.current?.contains(event.target as Node)) event.preventDefault()
            }}
            onWheel={(event) => event.stopPropagation()}
          >
            <CommandList className="max-h-72 overflow-y-auto overflow-x-hidden">{children}</CommandList>
          </PopoverContent>
        </Popover>
      </CommandPrimitive>
    </AutocompleteContext.Provider>
  )
}

/** An option that closes the list once selected. */
export function AutocompleteItem({
  onSelect,
  ...props
}: React.ComponentProps<typeof CommandItem>) {
  const context = React.useContext(AutocompleteContext)
  return (
    <CommandItem
      {...props}
      onSelect={(value) => {
        onSelect?.(value)
        context?.close()
      }}
    />
  )
}
