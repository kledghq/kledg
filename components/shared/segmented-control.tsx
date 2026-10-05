'use client'

import * as React from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: React.ReactNode
  /** Shown after the label in muted figures (a status filter's count). */
  count?: number
}

/**
 * One choice among a few, all visible: a status filter over one list, or
 * which variant of a card to show. Kledg uses no tabs (docs/design-system.md):
 * page sections are separate pages or stacked, choosers are this control or
 * a select. A value is always selected (clicking the selected option keeps
 * it). Scrolls sideways on a narrow screen rather than wrapping.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  label,
  className,
  disabled,
}: {
  options: ReadonlyArray<SegmentedOption<T>>
  value: T
  onValueChange: (value: T) => void
  /** Accessible name of the group (what is chosen). */
  label: string
  className?: string
  disabled?: boolean
}) {
  return (
    <div className={cn('max-w-full overflow-x-auto', className)}>
      <ToggleGroup
        type="single"
        variant="outline"
        value={value}
        onValueChange={(next) => {
          if (next) onValueChange(next as T)
        }}
        aria-label={label}
        disabled={disabled}
      >
        {options.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
            {option.count !== undefined ? (
              <>
                {' '}
                <span className="text-muted-foreground num">{option.count}</span>
              </>
            ) : null}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
