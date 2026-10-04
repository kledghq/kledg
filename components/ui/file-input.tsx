'use client'

import * as React from 'react'
import { Upload } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface FileInputProps extends Omit<React.ComponentProps<'input'>, 'type' | 'value' | 'size'> {
  /**
   * Name shown next to the button. When omitted, the name of the last file
   * chosen through this control; null shows the empty text.
   */
  fileName?: string | null
  /** Button label. Defaults to "Choisir un fichier" (or "Choisir des fichiers" with `multiple`). */
  buttonLabel?: string
  /** Text shown while no file is chosen. Defaults to "Aucun fichier choisi". */
  emptyText?: string
}

/**
 * French file picker: an outline "Choisir un fichier" button and the name of
 * the chosen file, in place of the browser's native control (which reads
 * "Choose File / No file chosen" in an English browser).
 *
 * The `id` goes to the button, so a `<Label htmlFor>` or a `<Field>` names
 * it and a click on the label opens the picker; the native input stays in
 * the DOM, hidden, and receives every other prop (`accept`, `onChange`,
 * `disabled`, `multiple`, `ref`).
 */
export function FileInput({
  id,
  className,
  fileName,
  buttonLabel,
  emptyText = 'Aucun fichier choisi',
  onChange,
  disabled,
  multiple,
  ref,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  'aria-required': required,
  ...props
}: FileInputProps) {
  const generatedId = React.useId()
  const buttonId = id ?? `file-${generatedId}`
  const nameId = `${buttonId}-name`
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [chosen, setChosen] = React.useState<string | null>(null)
  const shown = fileName !== undefined ? fileName : chosen

  const setRefs = (node: HTMLInputElement | null) => {
    inputRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }

  return (
    <div data-slot="file-input" className={cn('flex min-w-0 items-center gap-3', className)}>
      <Button
        id={buttonId}
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        aria-describedby={[nameId, describedBy].filter(Boolean).join(' ')}
        aria-invalid={invalid}
        aria-required={required}
        onClick={() => inputRef.current?.click()}
      >
        <Upload aria-hidden />
        {buttonLabel ?? (multiple ? 'Choisir des fichiers' : 'Choisir un fichier')}
      </Button>
      <span id={nameId} className={cn('min-w-0 truncate text-sm', shown ? 'text-foreground' : 'text-muted-foreground')} title={shown ?? undefined}>
        {shown || emptyText}
      </span>
      <input
        {...props}
        ref={setRefs}
        type="file"
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        disabled={disabled}
        multiple={multiple}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          setChosen(files.length === 0 ? null : files.length === 1 ? files[0].name : `${files.length} fichiers`)
          onChange?.(event)
        }}
      />
    </div>
  )
}
