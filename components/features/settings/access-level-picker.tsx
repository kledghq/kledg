'use client'

import { useId } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  ACCESS_LEVELS,
  ACCESS_LEVEL_DESCRIPTIONS,
  ACCESS_LEVEL_LABELS,
  type AccessLevel,
} from '@/lib/ai-access/access'

/**
 * What an assistant or an API key may do: read only, read and propose draft
 * entries, or full control. `levels` lists the choices to show (by default
 * all three); `unavailable` disables some of them and says why (the assistant
 * did not ask for it, or it must be reconnected to get it back). Full control
 * comes with a warning and is never preselected by callers.
 */
export function AccessLevelPicker({
  value,
  onChange,
  levels = ACCESS_LEVELS,
  unavailable = {},
  disabled = false,
}: {
  value: AccessLevel
  onChange: (value: AccessLevel) => void
  levels?: readonly AccessLevel[]
  unavailable?: Partial<Record<AccessLevel, string>>
  disabled?: boolean
}) {
  const id = useId()

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">Accès</legend>
      <RadioGroup value={value} onValueChange={(next) => onChange(next as AccessLevel)} className="gap-2">
        {levels.map((level) => {
          const reason = unavailable[level]
          return (
            <div key={level} className="flex items-start gap-2 pointer-coarse:items-center">
              <RadioGroupItem value={level} id={`${id}-${level}`} className="mt-0.5 pointer-coarse:mt-0" disabled={Boolean(reason)} />
              <Label htmlFor={`${id}-${level}`} className="flex-1 flex-col items-start gap-0.5 font-normal leading-snug pointer-coarse:min-h-11 pointer-coarse:justify-center">
                <span>{ACCESS_LEVEL_LABELS[level]}</span>
                <span className="text-muted-foreground text-xs">
                  {reason ?? (level === 'admin' ? 'Agir comme vous, au-delà des brouillons.' : ACCESS_LEVEL_DESCRIPTIONS[level])}
                </span>
              </Label>
            </div>
          )
        })}
      </RadioGroup>
      {value === 'admin' && (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertDescription>{ACCESS_LEVEL_DESCRIPTIONS.admin}</AlertDescription>
        </Alert>
      )}
    </fieldset>
  )
}
