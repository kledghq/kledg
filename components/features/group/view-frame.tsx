'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AvatarStack, PageHeader } from '@/components/shared'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { useGroupSummary } from '@/components/layout/group-nav'
import { plural } from '@/lib/utils/plural'
import { useGroupSpace } from './space'

/**
 * The frame of a view of the group space (docs/vue-groupe.md): who the
 * group is (the holding's shareholders as an avatar stack, the group's
 * name and size), the title of the view and the question it answers, the
 * holding's fiscal year chosen once for every view, then the tabs of the
 * view. The tab is in the address (?vue=), so a link opens it and the old
 * pages of the group space redirect to it.
 */

export interface GroupViewTab {
  id: string
  label: string
  content: React.ReactNode
}

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

function ViewFrame({
  title,
  description,
  tabs,
  controls,
  fiscalYear = true,
  hint,
}: {
  title: string
  description: string
  tabs: GroupViewTab[]
  /** More controls next to the fiscal year (the company filter of Pilotage). */
  controls?: React.ReactNode
  fiscalYear?: boolean
  hint?: React.ReactNode
}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const { companyId, fiscalYearId, setFiscalYearId } = useGroupSpace()
  const requested = searchParams?.get('vue')
  const active = tabs.find((t) => t.id === requested)?.id ?? tabs[0].id
  const select = (id: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (id === tabs[0].id) params.delete('vue')
    else params.set('vue', id)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <GroupIdentity />
        <PageHeader title={title} description={description} />
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
      {tabs.length === 1 ? (
        <div className="space-y-6">{tabs[0].content}</div>
      ) : (
        <Tabs value={active} onValueChange={select} className="gap-4">
          <div className="-mx-1 overflow-x-auto px-1">
            <TabsList aria-label={`Onglets de la vue ${title}`}>
              {tabs.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {tabs.map((t) => (
            <TabsContent key={t.id} value={t.id} className="space-y-6">
              {t.id === active ? t.content : null}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  )
}

export function GroupViewFrame(props: React.ComponentProps<typeof ViewFrame>) {
  return (
    <React.Suspense fallback={null}>
      <ViewFrame {...props} />
    </React.Suspense>
  )
}
