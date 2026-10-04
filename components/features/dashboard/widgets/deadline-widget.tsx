'use client'

import Link from 'next/link'
import { ArrowRight, CalendarCheck, Settings2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DateDisplay, EmptyState, StatusBadge } from '@/components/shared'
import { relativeDeadlineLabel, urgencyOf, type DeadlineUrgency } from '@/lib/deadlines/relative'
import { DEADLINE_CATEGORY_LABELS, type Deadline } from '@/lib/deadlines/types'
import type { StatusTone } from '@/components/shared'
import { useWidgetSource } from '../dashboard-data'
import { ListSkeleton, WidgetError, WidgetFrame } from '../widget-frame'
import type { WidgetProps } from './types'

const TONES: Record<DeadlineUrgency, StatusTone> = {
  past: 'neutral',
  overdue: 'danger',
  today: 'warning',
  soon: 'warning',
  later: 'neutral',
}

/** Deadlines shown by size: a small widget keeps the next three. */
const ROWS_BY_SIZE = { S: 3, M: 6, L: 8 } as const

/**
 * One deadline. The widget may be narrow (size S, phones): the list is a
 * container, and below 24rem the label moves under the date and the status.
 */
function DeadlineRow({ deadline, today }: { deadline: Deadline; today: string }) {
  const urgency = urgencyOf(deadline.date, today)
  return (
    <li className="grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-1 py-2 @sm/deadlines:grid-cols-[5rem_1fr_auto]">
      <span className="col-start-1 row-start-1 text-sm">
        <DateDisplay value={deadline.date} />
        {deadline.estimated ? <span className="text-muted-foreground block text-xs">indicative</span> : null}
      </span>
      <span className="col-start-2 row-start-1 justify-self-end @sm/deadlines:col-start-3">
        <StatusBadge tone={TONES[urgency]}>{relativeDeadlineLabel(deadline.date, today)}</StatusBadge>
      </span>
      <span className="col-span-2 row-start-2 min-w-0 @sm/deadlines:col-span-1 @sm/deadlines:col-start-2 @sm/deadlines:row-start-1">
        <span className="block text-sm">{deadline.label}</span>
        <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="font-mono">{deadline.form}</span>
          <Badge variant="muted">{DEADLINE_CATEGORY_LABELS[deadline.category]}</Badge>
          {deadline.condition ? <span>{deadline.condition}</span> : null}
        </span>
      </span>
    </li>
  )
}

export function EcheancesList({ widget, size }: WidgetProps) {
  const { state, retry, companyId } = useWidgetSource('deadlines')
  const data = state.status === 'ready' ? state.data : null
  const rows = data?.deadlines.slice(0, ROWS_BY_SIZE[size]) ?? []
  return (
    <WidgetFrame
      title={widget.title}
      description={data ? `Les ${data.horizonDays} prochains jours. Dates indicatives : votre espace professionnel sur impots.gouv.fr fait foi.` : undefined}
      busy={state.status === 'loading'}
    >
      {state.status === 'loading' ? (
        <ListSkeleton rows={size === 'S' ? 3 : 5} />
      ) : state.status === 'error' ? (
        <WidgetError message={state.message} onRetry={retry} />
      ) : !data || data.deadlines.length === 0 ? (
        <>
          <EmptyState
            icon={CalendarCheck}
            tone="success"
            title={`Aucune échéance dans les ${data?.horizonDays ?? 60} prochains jours`}
            description={
              data?.missingRegimes
                ? "Renseignez les régimes de TVA et d'impôt sur les sociétés pour voir les échéances fiscales."
                : 'Les déclarations et paiements à venir apparaîtront ici.'
            }
            action={
              data?.missingRegimes ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/${companyId}/informations#echeances`}>
                    <Settings2 aria-hidden />
                    Compléter les informations
                  </Link>
                </Button>
              ) : undefined
            }
          />
          <FooterLink href={`/${companyId}/echeances`} />
        </>
      ) : (
        <>
          <ul className="@container/deadlines divide-y" aria-label="Prochaines échéances">
            {rows.map((d) => (
              <DeadlineRow key={d.id} deadline={d} today={data.today} />
            ))}
          </ul>
          <FooterLink href={`/${companyId}/echeances`} />
        </>
      )}
    </WidgetFrame>
  )
}

function FooterLink({ href }: { href: string }) {
  return (
    <Button asChild size="sm" variant="outline" className="mt-3">
      <Link href={href}>
        Toutes les échéances
        <ArrowRight aria-hidden />
      </Link>
    </Button>
  )
}
