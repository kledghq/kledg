'use client'

import { StatusBadge, type StatusTone } from '@/components/shared'
import { relativeDeadlineLabel, urgencyOf, type DeadlineUrgency } from '@/lib/deadlines/relative'
import type { Deadline } from '@/lib/deadlines/types'
import type { DeadlineStatus } from '@/lib/declarations/status'

const URGENCY_TONES: Record<DeadlineUrgency, StatusTone> = { past: 'neutral', overdue: 'danger', today: 'warning', soon: 'warning', later: 'neutral' }

/**
 * Where a deadline stands (docs/echeances.md): settled ("Déposée", "Payée",
 * "Non due"), late ("en retard de 3 jours", "En retard" once older), or the
 * days left ("dans 5 jours"). A return filed whose payment is missing says
 * both. Without a status (an older client answer), the days only.
 */
export function DeadlineStatusBadge({ deadline, today, className }: { deadline: Deadline & { status?: DeadlineStatus }; today: string; className?: string }) {
  const status = deadline.status
  if (status?.settled) {
    return (
      <StatusBadge tone={status.status === 'not-due' ? 'neutral' : 'success'} className={className}>
        {status.label}
      </StatusBadge>
    )
  }
  const urgency = urgencyOf(status?.lateAfter ?? deadline.date, today)
  if (status?.status === 'overdue') {
    return (
      <StatusBadge tone="danger" className={className}>
        {urgency === 'overdue' ? relativeDeadlineLabel(status.lateAfter, today) : status.label}
      </StatusBadge>
    )
  }
  // Past the day but within the online filing extension: count to the extended day.
  const target = status && today > deadline.date ? status.lateAfter : deadline.date
  const relative = relativeDeadlineLabel(target, today)
  if (status?.status === 'filed') {
    return (
      <StatusBadge tone="info" className={className}>
        {`Déposée, à payer ${relative}`}
      </StatusBadge>
    )
  }
  return (
    <StatusBadge tone={URGENCY_TONES[urgencyOf(target, today)]} className={className}>
      {relative}
    </StatusBadge>
  )
}
