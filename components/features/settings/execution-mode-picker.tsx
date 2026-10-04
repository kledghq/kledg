'use client'

import { useId } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  AUTOMATIC_MODE_WARNING,
  EXECUTION_MODES,
  EXECUTION_MODE_DESCRIPTIONS,
  EXECUTION_MODE_LABELS,
  type ExecutionMode,
} from '@/lib/ai-access/access'

/**
 * How a full control connection runs its important actions: at once
 * (automatic, the default) or after the user's approval in Kledg. Shown under
 * the access level when Contrôle total is chosen; automatic comes with the
 * prompt injection warning.
 */
export function ExecutionModePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: ExecutionMode
  onChange: (value: ExecutionMode) => void
  disabled?: boolean
}) {
  const id = useId()

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">Exécution des actions importantes</legend>
      <RadioGroup value={value} onValueChange={(next) => onChange(next as ExecutionMode)} className="gap-2">
        {EXECUTION_MODES.map((mode) => (
          <div key={mode} className="flex items-start gap-2 pointer-coarse:items-center">
            <RadioGroupItem value={mode} id={`${id}-${mode}`} className="mt-0.5 pointer-coarse:mt-0" />
            <Label htmlFor={`${id}-${mode}`} className="flex-1 flex-col items-start gap-0.5 font-normal leading-snug pointer-coarse:min-h-11 pointer-coarse:justify-center">
              <span>{EXECUTION_MODE_LABELS[mode]}</span>
              <span className="text-muted-foreground text-xs">{EXECUTION_MODE_DESCRIPTIONS[mode]}</span>
            </Label>
          </div>
        ))}
      </RadioGroup>
      {value === 'automatic' && (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertDescription>{AUTOMATIC_MODE_WARNING}</AlertDescription>
        </Alert>
      )}
    </fieldset>
  )
}
