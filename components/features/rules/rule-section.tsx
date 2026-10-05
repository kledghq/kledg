import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * A section of the rule editor: a card that is a fieldset, its title the
 * legend, so assistive tech announces "Conditions, groupe" before the
 * fields. The legend floats so it lays out like a card header.
 */
export function RuleSection({
  id,
  title,
  description,
  children,
  className,
}: {
  id: string
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const descriptionId = description ? `${id}-description` : undefined
  return (
    <fieldset
      id={id}
      data-slot="card"
      aria-describedby={descriptionId}
      className={cn('bg-card text-card-foreground min-w-0 rounded-lg border px-5 py-5', className)}
    >
      <legend className="float-left w-full">
        <h2 className="leading-tight font-semibold tracking-tight">{title}</h2>
      </legend>
      {description ? (
        <p id={descriptionId} className="text-muted-foreground float-left mt-1.5 w-full text-sm">
          {description}
        </p>
      ) : null}
      <div className="clear-both space-y-4 pt-5">{children}</div>
    </fieldset>
  )
}
