'use client'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { plural } from '@/lib/utils/plural'

interface Props {
  id: string
  checked: boolean
  onCheckedChange: (value: boolean) => void
  /** Lines currently left out, to say what the switch hides. */
  hiddenCount: number
}

/** "Masquer les lignes à zéro" switch of the statement pages. */
export function HideZeroLinesToggle({ id, checked, onCheckedChange, hiddenCount }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
      <Label htmlFor={id}>Masquer les lignes à zéro</Label>
      {checked && hiddenCount > 0 && (
        <span className="text-xs text-muted-foreground">{plural(hiddenCount, 'ligne masquée', 'lignes masquées')}</span>
      )}
    </div>
  )
}
