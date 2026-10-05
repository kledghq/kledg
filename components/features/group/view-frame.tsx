'use client'

import * as React from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { AvatarStack, PageHeader } from '@/components/shared'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { useGroupSummary } from '@/components/layout/group-nav'
import { groupPage, type GroupViewId } from '@/components/layout/group-nav-config'
import { plural } from '@/lib/utils/plural'
import { useGroupSpace } from './space'

/**
 * The frame of a page of the group space (docs/vue-groupe.md): who the
 * group is (the holding's shareholders as an avatar stack, the group's
 * name and size), the title of the page, the holding's fiscal year chosen
 * once for every page, then the page's section. Each page of a view has its
 * own address and its own entry in the sidebar, under the view
 * (GROUP_VIEWS of components/layout/group-nav-config.ts).
 */

/** The group as a line above the title: shareholders of the holding, "Groupe <holding>", companies counted. */
export function GroupIdentity() {
  const { companyId } = useGroupSpace()
  const summary = useGroupSummary(companyId, true)
  if (!summary) return <div className="h-6" aria-hidden />
  const total = summary.readableCount + summary.unreadableCount
  return (
    <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm" data-slot="group-identity">
      <AvatarStack holders={summary.shareholders} size="sm" />
      <span className="truncate">
        <span className="text-foreground font-medium">{summary.name}</span> · {plural(total, 'société', 'sociétés')}
      </span>
    </div>
  )
}

export function GroupViewFrame({
  view,
  page,
  sections,
  controls,
  fiscalYear = true,
  hint,
}: {
  view: GroupViewId
  /** The page of the view (its id in GROUP_VIEWS), the view's first page when omitted. */
  page?: string
  /** The section of each page of the view, by page id. */
  sections: Record<string, React.ReactNode>
  /** More controls next to the fiscal year (the company filter of Pilotage). */
  controls?: React.ReactNode
  fiscalYear?: boolean
  hint?: React.ReactNode
}) {
  const { companyId, fiscalYearId, setFiscalYearId } = useGroupSpace()
  const current = groupPage(view, page)
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <GroupIdentity />
        <PageHeader title={current.title} />
      </div>
      {fiscalYear || controls ? (
        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {fiscalYear ? (
              <div className="space-y-2">
                <Label htmlFor="group-fiscal-year">Exercice de la holding</Label>
                <FiscalYearSelector companyId={companyId} value={fiscalYearId} onValueChange={setFiscalYearId} showLabel={false} showPeriod={false} id="group-fiscal-year" />
              </div>
            ) : null}
            {controls}
            {hint ? <p className="text-muted-foreground text-sm sm:col-span-3">{hint}</p> : null}
          </CardContent>
        </Card>
      ) : null}
      <div className="space-y-6">{sections[current.id]}</div>
    </div>
  )
}
