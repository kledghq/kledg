'use client'

import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useJson } from '@/components/features/year-end/shared'
import type { RemunerationView } from '@/lib/remuneration/load-remuneration.service'
import { SIMPLE_CARD_ACTION, SIMPLE_CARD_HINT, SIMPLE_CARD_TITLE, simpleCardSentence, simpleSplitSentence } from '@/lib/remuneration/simple-wording'

/**
 * "Combien puis-je me verser ?" on the simple home (docs/mode-simple.md):
 * the optimum of the remuneration simulator in plain words, from the same
 * service and figures as the expert page (lib/remuneration). Renders
 * nothing when the company is not at the IS, its form is not covered or the
 * simulation does not load: the home stays calm.
 */
export function RemunerationSimpleCard({ companyId }: { companyId: string }) {
  const { data, error, loading } = useJson<RemunerationView>(`/api/companies/${encodeURIComponent(companyId)}/remuneration`, 'Simulation indisponible')
  if (error) return null
  if (loading || !data) {
    return (
      <Card aria-busy>
        <CardHeader>
          <CardTitle>
            <h2>{SIMPLE_CARD_TITLE}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    )
  }
  const optimum = data.simulation?.scenarios.optimum
  if (data.status !== 'ready' || !optimum || !data.inputs) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{SIMPLE_CARD_TITLE}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">{simpleCardSentence(data.inputs.resultBeforePayCents, optimum.person.netIncomeCents)}</p>
        <p className="text-sm">{simpleSplitSentence(optimum.company.remunerationCostCents, optimum.dividends.receivedCents)}</p>
        <p className="text-muted-foreground text-xs">{SIMPLE_CARD_HINT}</p>
        <Button asChild size="sm" variant="outline">
          <Link href={`/${companyId}/remuneration`}>{SIMPLE_CARD_ACTION}</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
