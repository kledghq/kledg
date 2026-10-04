'use client'

import { ListChecks } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { GettingStartedCard } from '@/components/features/onboarding/getting-started-card'
import { useDashboardOnboarding } from '../dashboard-data'
import type { WidgetProps } from './types'

/** Whether the "Démarrer" checklist has something to show this user. */
export function guideVisible(data: ReturnType<typeof useDashboardOnboarding>['data']): boolean {
  return Boolean(data?.enabled && data.canManage && !data.dismissed && !data.complete)
}

/**
 * The "Démarrer" checklist as a widget. It shows itself while the company
 * is being set up and steps aside once every step is done or someone hid
 * it; the header button "Démarrer" brings it back.
 */
export function GuideWidget({ widget, editing }: WidgetProps) {
  const { data, setDismissed } = useDashboardOnboarding()
  if (data && guideVisible(data)) return <GettingStartedCard data={data} onDismiss={() => setDismissed(true)} />
  if (!editing) return null
  return (
    <Card role="region" aria-label={widget.title} className="px-5">
      <p className="text-muted-foreground flex items-start gap-2 text-sm">
        <ListChecks aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          {!data
            ? "Le guide Démarrer ne s'est pas chargé."
            : !data.enabled
              ? 'Le guide Démarrer est désactivé sur cette instance.'
              : data.dismissed
                ? 'Le guide Démarrer est masqué. Le bouton Démarrer en haut de la page le montre de nouveau.'
                : "Toutes les étapes du guide Démarrer sont faites : il ne s'affiche plus."}
        </span>
      </p>
    </Card>
  )
}
