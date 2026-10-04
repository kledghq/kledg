'use client'

import * as React from 'react'
import { fr } from 'date-fns/locale'
import { CalendarIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatIsoDateFr, isoDateToLocal, localDateToIso, parseFrenchDate } from '@/lib/utils/date'

export const DATE_INPUT_ERROR = 'Date invalide\u00a0: saisissez-la au format jj/mm/aaaa.'

interface DateInputProps extends Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'defaultValue'> {
  /** ISO date (yyyy-mm-dd), '' when empty. */
  value: string
  /** ISO date of what is typed, '' while it is empty or not a date. */
  onValueChange: (iso: string) => void
  onErrorChange?: (error: string | null) => void
}

/**
 * Date field for French users: shows and reads dd/mm/yyyy (also ddmmyyyy,
 * dd.mm.yy...), never month first, with a calendar button. The value is an
 * ISO date: no Date object, so no timezone drift between browser and server.
 */
export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { value, onValueChange, onErrorChange, className, disabled, onBlur, onFocus, ...props },
  ref,
) {
  const [text, setText] = React.useState(() => formatIsoDateFr(value))
  const [error, setError] = React.useState<string | null>(null)
  const [focused, setFocused] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [shownValue, setShownValue] = React.useState(value)

  // Follow external changes unless the user is typing
  if (value !== shownValue) {
    setShownValue(value)
    if (!focused && parseFrenchDate(text) !== value) {
      setText(formatIsoDateFr(value))
      setError(null)
    }
  }

  const report = (next: string | null) => {
    setError(next)
    onErrorChange?.(next)
  }

  const commit = (next: string) => {
    setText(next)
    const iso = next.trim() === '' ? '' : parseFrenchDate(next)
    if (iso === null) {
      report(DATE_INPUT_ERROR)
      if (value !== '') onValueChange('')
    } else {
      report(null)
      if (iso !== value) onValueChange(iso)
    }
  }

  return (
    <div className={cn('relative', className)}>
      <Input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="jj/mm/aaaa"
        value={text}
        disabled={disabled}
        // A date being typed is incomplete: flag it once the field is left
        aria-invalid={error && !focused ? true : undefined}
        title={error ?? undefined}
        className="pr-10 tabular-nums pointer-coarse:pr-12"
        onFocus={(event) => {
          setFocused(true)
          onFocus?.(event)
        }}
        onChange={(event) => commit(event.target.value)}
        onBlur={(event) => {
          setFocused(false)
          const iso = parseFrenchDate(text)
          if (iso) setText(formatIsoDateFr(iso))
          onBlur?.(event)
        }}
        {...props}
      />
      <Popover open={open && !disabled} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={disabled}
            aria-label="Choisir dans le calendrier"
            className="absolute right-1 top-1/2 -translate-y-1/2 pointer-coarse:right-0"
          >
            <CalendarIcon className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            locale={fr}
            captionLayout="dropdown"
            selected={isoDateToLocal(value)}
            defaultMonth={isoDateToLocal(value)}
            onSelect={(date) => {
              if (date) commit(formatIsoDateFr(localDateToIso(date)))
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
})
