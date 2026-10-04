'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { CompanyOnboardingView } from './use-company-onboarding'

interface GettingStartedCardProps {
  data: CompanyOnboardingView
  onDismiss: () => Promise<boolean>
}

/**
 * "Démarrer" checklist on the company dashboard: the steps that make a new
 * company useful, ticked from the company's data (lib/onboarding/checklist.ts),
 * each with why it matters and one button. Shown to members who keep the
 * books until it is hidden; it can be shown again from the dashboard header
 * or the help menu.
 */
export function GettingStartedCard({ data, onDismiss }: GettingStartedCardProps) {
  const [hiding, setHiding] = useState(false)
  const next = data.steps.find((s) => !s.done && s.action)
  const percent = data.total > 0 ? Math.round((data.done / data.total) * 100) : 0

  const hide = async () => {
    setHiding(true)
    const ok = await onDismiss()
    setHiding(false)
    if (ok) toast.success('Guide masqué. Retrouvez-le dans le menu Aide ou avec le bouton Démarrer du tableau de bord.')
    else toast.error("Le guide n'a pas pu être masqué. Réessayez.")
  }

  return (
    <Card aria-labelledby="getting-started-title">
      <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 flex-1 basis-64 space-y-1.5">
          <CardTitle id="getting-started-title" role="heading" aria-level={2}>
            {data.complete ? 'Tout est prêt' : 'Démarrer'}
          </CardTitle>
          <CardDescription>
            {data.complete
              ? 'Votre société est prête\u00a0: la banque arrive, les règles comptabilisent, votre expert-comptable a accès.'
              : 'Les étapes pour que Kledg tienne vos comptes. Elles se cochent toutes seules quand Kledg les détecte.'}
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={hide} loading={hiding} aria-label="Masquer le guide Démarrer">
          <X aria-hidden />
          Masquer
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Progress value={percent} className="h-1.5 max-w-xs flex-1" aria-label={`${data.done} étapes faites sur ${data.total}`} />
          <p className="text-muted-foreground text-sm whitespace-nowrap">
            <span className="num text-foreground font-medium">{data.done}</span> sur <span className="num">{data.total}</span>
          </p>
        </div>
        <ol className="divide-y border-t">
          {data.steps.map((step) => {
            const isNext = step.id === next?.id
            return (
              <li key={step.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3 last:pb-0">
                <span
                  aria-hidden
                  className={cn(
                    'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
                    step.done ? 'border-success bg-success/10 text-success' : 'text-muted-foreground',
                  )}
                >
                  {step.done ? <Check className="size-3" /> : null}
                </span>
                <div className="min-w-0 flex-1 basis-56 space-y-0.5">
                  <p className={cn('text-sm font-medium', step.done && 'text-muted-foreground')}>
                    {step.title}
                    <span className="sr-only">{step.done ? ' (fait)' : ' (à faire)'}</span>
                  </p>
                  {!step.done ? <p className="text-muted-foreground text-sm">{step.why}</p> : null}
                  {step.detail ? <p className="text-muted-foreground text-xs">{step.detail}</p> : null}
                </div>
                {!step.done && step.action ? (
                  <Button asChild size="sm" variant={isNext ? 'default' : 'outline'} className="ml-8 sm:ml-0">
                    <Link href={step.action.href}>
                      {step.action.label}
                      {isNext ? <ArrowRight aria-hidden /> : null}
                    </Link>
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}
