'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { HelpTip, StatCard, StatusBadge, formatAmount, formatDisplayDate } from '@/components/shared'
import { docsUrl } from '@/lib/docs-links'
import { pluralWord } from '@/lib/utils/plural'
import type { LedgerData } from '@/lib/dashboard/load-widget-data.service'
import { useWidgetSource } from '../dashboard-data'
import { KpiCents } from '../kpi-amount'
import { WidgetError } from '../widget-frame'
import type { WidgetProps } from './types'

interface KpiView {
  value: React.ReactNode
  hint?: React.ReactNode
  aside?: React.ReactNode
  valueClassName?: string
}

const money = (cents: number) => formatAmount(cents / 100)

/** "Même période en 2025 : 12 340,00 €", the span of the previous year the value is compared with. */
function previousHint(data: LedgerData, pick: (p: NonNullable<LedgerData['previous']>) => number): React.ReactNode {
  if (!data.previous) return "Pas d'exercice précédent pour comparer"
  return (
    <span title={`Du ${formatDisplayDate(data.previous.startDate)} au ${formatDisplayDate(data.previous.endDate)}`}>
      Même période en {data.previous.year}&nbsp;: <span className="num text-foreground font-medium">{money(pick(data.previous))}</span>
    </span>
  )
}

function KpiSkeleton() {
  return (
    <>
      <Skeleton className="h-7 w-36" />
      <Skeleton className="h-3 w-44" />
    </>
  )
}

/** A tile reading the ledger source: the value comes from `view` once the data is there. */
function LedgerKpi({ widget, help, view }: WidgetProps & { help?: React.ReactNode; view: (data: Required<LedgerData>) => KpiView }) {
  const { state, retry } = useWidgetSource('ledger')
  const ready = state.status === 'ready' ? state.data : null
  const shown = ready?.fiscalYear && ready.summary ? view(ready as Required<LedgerData>) : null
  return (
    <StatCard
      labelAs="h2"
      label={widget.title}
      busy={state.status === 'loading'}
      aside={shown?.aside ?? help}
      value={
        state.status === 'loading' ? (
          <span className="sr-only">Chargement</span>
        ) : shown ? (
          shown.value
        ) : state.status === 'error' ? null : (
          <span className="text-muted-foreground text-base font-normal">Aucun exercice</span>
        )
      }
      valueClassName={shown?.valueClassName}
      hint={shown?.hint}
      className="h-full"
    >
      {state.status === 'loading' ? <KpiSkeleton /> : null}
      {state.status === 'error' ? <WidgetError compact message={state.message} onRetry={retry} /> : null}
    </StatCard>
  )
}

export function ChiffreAffairesKpi(props: WidgetProps) {
  return (
    <LedgerKpi
      {...props}
      help={
        <HelpTip term="Chiffre d'affaires" docsHref={docsUrl('incomeStatement')}>
          Ventes de produits, de marchandises et prestations de services de l&apos;exercice (comptes 70), hors taxes.
          Les autres produits (subventions, produits financiers) n&apos;en font pas partie.
        </HelpTip>
      }
      view={(d) => ({ value: <KpiCents cents={d.summary.chiffreAffairesCents} />, hint: previousHint(d, (p) => p.chiffreAffairesCents) })}
    />
  )
}

export function ProduitsKpi(props: WidgetProps) {
  return (
    <LedgerKpi
      {...props}
      help={
        <HelpTip term="Produits" docsHref={docsUrl('incomeStatement')}>
          Total des comptes de la classe 7 de l&apos;exercice, hors taxes&nbsp;: le chiffre d&apos;affaires (comptes 70),
          mais aussi subventions et produits financiers.
        </HelpTip>
      }
      view={(d) => ({ value: <KpiCents cents={d.summary.produitsCents} />, hint: previousHint(d, (p) => p.produitsCents) })}
    />
  )
}

export function ChargesKpi(props: WidgetProps) {
  return (
    <LedgerKpi
      {...props}
      help={
        <HelpTip term="Charges" docsHref={docsUrl('incomeStatement')}>
          Total des comptes de la classe 6 de l&apos;exercice, hors taxes&nbsp;: achats, services extérieurs, impôts,
          salaires, dotations aux amortissements.
        </HelpTip>
      }
      view={(d) => ({ value: <KpiCents cents={d.summary.chargesCents} />, hint: previousHint(d, (p) => p.chargesCents) })}
    />
  )
}

export function ResultatKpi(props: WidgetProps) {
  return (
    <LedgerKpi
      {...props}
      view={(d) => {
        const cents = d.summary.resultatCents
        return {
          value: <KpiCents cents={cents} />,
          valueClassName: cents < 0 ? 'text-destructive' : undefined,
          aside: <StatusBadge tone={cents >= 0 ? 'success' : 'danger'}>{cents >= 0 ? 'Bénéfice' : 'Perte'}</StatusBadge>,
          hint: previousHint(d, (p) => p.resultatCents),
        }
      }}
    />
  )
}

export function TresorerieKpi(props: WidgetProps) {
  return (
    <LedgerKpi
      {...props}
      help={
        <HelpTip term="Trésorerie" docsHref={docsUrl('bankReconciliation')}>
          Solde des comptes 512 en comptabilité. Le solde déclaré par vos banques peut différer tant que des
          opérations restent à rapprocher.
        </HelpTip>
      }
      view={(d) => ({
        value: <KpiCents cents={d.summary.banqueCents} />,
        valueClassName: d.summary.banqueCents < 0 ? 'text-destructive' : undefined,
        hint:
          d.bank && d.bank.accounts > 0 ? (
            <>
              Selon vos banques&nbsp;: <span className="num text-foreground font-medium">{money(d.bank.balanceCents)}</span>
            </>
          ) : (
            'Comptes 512 en comptabilité'
          ),
      })}
    />
  )
}

export function TvaKpi(props: WidgetProps) {
  return (
    <LedgerKpi
      {...props}
      help={
        <HelpTip term="TVA" docsHref={docsUrl('vat')}>
          Estimation d&apos;après le solde des comptes 445&nbsp;: TVA collectée moins TVA déductible, crédits reportés
          compris. Le montant à déclarer se calcule sur la période de la déclaration.
        </HelpTip>
      }
      view={(d) => {
        const cents = d.summary.tvaCents
        if (cents === null) {
          return {
            value: <span className="text-muted-foreground text-base font-normal">Aucune TVA</span>,
            hint: 'Aucune écriture sur les comptes 445 cet exercice',
          }
        }
        return {
          value: <KpiCents cents={Math.abs(cents)} />,
          aside: <StatusBadge tone="neutral">Estimation</StatusBadge>,
          hint: cents >= 0 ? 'TVA à payer' : 'Crédit de TVA',
        }
      }}
    />
  )
}

export function MargeKpi(props: WidgetProps) {
  return (
    <LedgerKpi
      {...props}
      help={
        <HelpTip term="Marge commerciale" docsHref={docsUrl('incomeStatement')}>
          Ventes de marchandises (comptes 707) moins leur coût d&apos;achat (607, rabais obtenus et variation de stock
          6037), comme sur le compte de résultat (formulaire 2052).
        </HelpTip>
      }
      view={(d) => {
        const marge = d.summary.marge
        if (!marge) {
          return {
            value: <span className="text-muted-foreground text-base font-normal">Sans objet</span>,
            hint: 'Aucune vente ni achat de marchandises cet exercice',
          }
        }
        return {
          value: <KpiCents cents={marge.margeCents} />,
          valueClassName: marge.margeCents < 0 ? 'text-destructive' : undefined,
          hint: (
            <>
              Ventes de marchandises&nbsp;: <span className="num text-foreground font-medium">{money(marge.ventesCents)}</span>
            </>
          ),
        }
      }}
    />
  )
}

export function CreancesClientsKpi(props: WidgetProps) {
  return (
    <LedgerKpi
      {...props}
      view={(d) => ({ value: <KpiCents cents={d.summary.creancesClientsCents} />, hint: 'Solde des comptes clients (411)' })}
    />
  )
}

export function DettesFournisseursKpi(props: WidgetProps) {
  return (
    <LedgerKpi
      {...props}
      view={(d) => ({ value: <KpiCents cents={d.summary.dettesFournisseursCents} />, hint: 'Solde des comptes fournisseurs (401)' })}
    />
  )
}

/** Count of bank transactions without an entry, with the way to the reconciliation. */
export function ARapprocherKpi({ widget }: WidgetProps) {
  const { state, retry, companyId } = useWidgetSource('reconciliation')
  const count = state.status === 'ready' ? state.data.count : null
  return (
    <StatCard
      labelAs="h2"
      label={widget.title}
      busy={state.status === 'loading'}
      className="h-full"
      value={
        count === null ? (
          state.status === 'loading' ? <span className="sr-only">Chargement</span> : null
        ) : (
          <span className="num">{count}</span>
        )
      }
      aside={count === 0 ? <StatusBadge tone="success">À jour</StatusBadge> : null}
      hint={count === null ? undefined : count === 0 ? 'Toutes les transactions ont leur écriture' : `${pluralWord(count, 'Transaction')} sans écriture`}
    >
      {state.status === 'loading' ? <KpiSkeleton /> : null}
      {state.status === 'error' ? <WidgetError compact message={state.message} onRetry={retry} /> : null}
      {count ? (
        <Button asChild size="xs" variant="outline" className="self-start">
          <Link href={`/${companyId}/reconciliation`}>
            Rapprocher
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      ) : null}
    </StatCard>
  )
}
