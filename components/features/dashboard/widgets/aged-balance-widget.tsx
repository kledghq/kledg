'use client'

import { FilePen } from 'lucide-react'

import { Amount, DateDisplay, EmptyState } from '@/components/shared'
import { plural } from '@/lib/utils/plural'
import { useWidgetSource } from '../dashboard-data'
import { ListSkeleton, WidgetError, WidgetFrame } from '../widget-frame'
import { FooterLink, Row, Rows } from './list-widgets'
import type { WidgetProps } from './types'

/** One side of the aged balance: what is overdue, out of what is owed. */
function OverdueFigure({ label, overdueCents, totalCents, tiers }: { label: string; overdueCents: number; totalCents: number; tiers: number }) {
  return (
    <div className="min-w-0 rounded-md border px-3 py-2.5">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 text-xl font-semibold">
        <Amount value={overdueCents / 100} />
      </p>
      <p className="text-muted-foreground text-xs">
        {overdueCents > 0 ? `${plural(tiers, 'tiers', 'tiers')} en retard, ` : 'Rien d’échu, '}
        sur <Amount value={totalCents / 100} /> en cours
      </p>
    </div>
  )
}

/**
 * "Créances et dettes échues": the overdue part of the aged balance
 * (lib/reports/third-parties), customers and suppliers, and the tiers most
 * overdue.
 */
export function CreancesDettesEchuesList({ widget, size }: WidgetProps) {
  const { state, retry, companyId } = useWidgetSource('aged-balance')
  const data = state.status === 'ready' ? state.data : null
  return (
    <WidgetFrame
      title={widget.title}
      description={
        data?.asOf ? (
          <>
            Au <DateDisplay value={data.asOf} />, délai de paiement de {plural(data.terms?.days ?? 30, 'jour')}
            {data.terms?.endOfMonth ? ' fin de mois' : ''}.
          </>
        ) : undefined
      }
      busy={state.status === 'loading'}
    >
      {state.status === 'loading' ? (
        <ListSkeleton rows={3} />
      ) : state.status === 'error' ? (
        <WidgetError message={state.message} onRetry={retry} />
      ) : !data?.fiscalYear || !data.customers || !data.suppliers ? (
        <EmptyState icon={FilePen} title="Aucun exercice" />
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <OverdueFigure
              label="Créances clients échues"
              overdueCents={data.customers.overdueCents}
              totalCents={data.customers.totalCents}
              tiers={data.customers.overdueTiers}
            />
            <OverdueFigure
              label="Dettes fournisseurs échues"
              overdueCents={data.suppliers.overdueCents}
              totalCents={data.suppliers.totalCents}
              tiers={data.suppliers.overdueTiers}
            />
          </div>
          {size !== 'S' && data.top && data.top.length > 0 ? (
            <div className="mt-3">
              <Rows label="Tiers les plus en retard">
                {data.top.map((t) => (
                  <Row
                    key={`${t.kind}-${t.code}`}
                    primary={t.label}
                    secondary={
                      <>
                        {t.kind === 'customers' ? 'Client' : 'Fournisseur'} <span className="font-mono">{t.code}</span>
                        {t.oldestDueDate ? (
                          <>
                            {' '}
                            · échu depuis le <DateDisplay value={t.oldestDueDate} />
                          </>
                        ) : null}
                      </>
                    }
                    end={<Amount value={t.overdueCents / 100} />}
                  />
                ))}
              </Rows>
            </div>
          ) : null}
          <FooterLink href={`/${companyId}/reports/aged-balance`}>Ouvrir la balance âgée</FooterLink>
        </>
      )}
    </WidgetFrame>
  )
}
