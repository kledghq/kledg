import * as React from 'react'

import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface FieldProps {
  label: React.ReactNode
  /**
   * Id of the rendered control. Optional: when omitted, an id is generated
   * and given to the child control so the label stays clickable.
   */
  htmlFor?: string
  /** Adds a "*" after the label and marks the control aria-required. */
  required?: boolean
  /** Adds a muted "(facultatif)" after the label. */
  optional?: boolean
  /** Validation error message, rendered below the control. */
  error?: string
  /** Helper text rendered below the control (above the error). */
  hint?: React.ReactNode
  /** Inline help next to the label, e.g. a `<HelpTip>` explaining a term. */
  help?: React.ReactNode
  /** The input/select/textarea/etc. */
  children: React.ReactNode
  className?: string
}

/**
 * Form field: label + control + hint + error, wired for assistive tech
 * (label `for`, `aria-describedby`, `aria-invalid`). Stays compatible with
 * direct `react-hook-form` `register` usage: pass the input as `children`
 * and forward `formState.errors.x?.message` as `error`.
 */
export function Field({
  label,
  htmlFor,
  required = false,
  optional = false,
  error,
  hint,
  help,
  children,
  className,
}: FieldProps) {
  const generatedId = React.useId()
  const child = React.Children.count(children) === 1 && React.isValidElement(children) ? children : null
  const childProps = (child?.props ?? {}) as Record<string, unknown>
  const controlId = htmlFor ?? (childProps.id as string | undefined) ?? `field-${generatedId}`
  const hintId = hint ? `${controlId}-hint` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy =
    [childProps['aria-describedby'] as string | undefined, hintId, errorId].filter(Boolean).join(' ') || undefined

  const control = child
    ? React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
        id: childProps.id ?? controlId,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : childProps['aria-invalid'],
        'aria-required': required || childProps['aria-required'] || undefined,
      })
    : children

  return (
    <div data-slot="field" className={cn('space-y-2', className)}>
      <div className="flex items-center gap-1.5">
        <Label htmlFor={controlId}>
          {label}
          {required ? (
            <span aria-hidden className="text-muted-foreground">
              *
            </span>
          ) : null}
          {optional ? <span className="text-muted-foreground font-normal">(facultatif)</span> : null}
        </Label>
        {help}
      </div>
      {control}
      {hint ? (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  )
}
