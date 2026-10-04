'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { formatAmountInput, parseAmount } from '@/lib/utils/money'

interface AmountInputProps
  extends Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'defaultValue'> {
  /** Amount in cents, null when empty. */
  value: number | null
  /** Called on every keystroke that changes the parsed amount (null when empty or invalid). */
  onValueChange: (cents: number | null) => void
  /** Called with the French error message while the typed text is not an amount, null once it is. */
  onErrorChange?: (error: string | null) => void
  allowNegative?: boolean
}

/**
 * Amount field for French users: accepts "1 234,56", "1234.56", pasted
 * non-breaking spaces, and formats to "1 234,56" on blur. A text input (no
 * spinner, no scroll-wheel changes) with a decimal keyboard on mobile.
 */
export const AmountInput = React.forwardRef<HTMLInputElement, AmountInputProps>(function AmountInput(
  { value, onValueChange, onErrorChange, allowNegative = false, className, onBlur, onFocus, ...props },
  ref,
) {
  const [text, setText] = React.useState(() => (value === null ? '' : formatAmountInput(value)))
  const [error, setError] = React.useState<string | null>(null)
  const [focused, setFocused] = React.useState(false)
  const [shownValue, setShownValue] = React.useState(value)

  // Follow external changes (prefill, templates) unless the user is typing
  if (value !== shownValue) {
    setShownValue(value)
    const parsed = parseAmount(text, { allowNegative })
    if (!focused && !(parsed.ok && parsed.cents === value)) {
      setText(value === null ? '' : formatAmountInput(value))
      setError(null)
    }
  }

  const report = (next: string | null) => {
    setError(next)
    onErrorChange?.(next)
  }

  return (
    <Input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      value={text}
      aria-invalid={error ? true : undefined}
      title={error ?? undefined}
      className={cn('text-right tabular-nums', className)}
      onFocus={(event) => {
        setFocused(true)
        onFocus?.(event)
      }}
      onChange={(event) => {
        const next = event.target.value
        setText(next)
        const parsed = parseAmount(next, { allowNegative })
        if (parsed.ok) {
          report(null)
          if (parsed.cents !== value) onValueChange(parsed.cents)
        } else {
          report(parsed.error)
          if (value !== null) onValueChange(null)
        }
      }}
      onBlur={(event) => {
        setFocused(false)
        const parsed = parseAmount(text, { allowNegative })
        if (parsed.ok) setText(parsed.cents === null ? '' : formatAmountInput(parsed.cents))
        onBlur?.(event)
      }}
      {...props}
    />
  )
})
