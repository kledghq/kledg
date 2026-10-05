'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowRight, CheckCircle2, FilePen, Landmark, ListChecks, Wand2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Amount, DateDisplay, EmptyState, StatusBadge } from '@/components/shared'
import { bankAccountName } from '@/components/features/banking/format'
import { consentStatus } from '@/lib/banking/consent'
import { plural } from '@/lib/utils/plural'
import type { EntrySummary } from '@/lib/dashboard/load-widget-data.service'
import { useWidgetSource } from '../dashboard-data'
import { ListSkeleton, WidgetError, WidgetFrame } from '../widget-frame'
import type { WidgetProps } from './types'

const PROVIDER_NAMES: Record<string, string> = {
  QONTO: 'Qonto',
  REVOLUT: 'Revolut Business',
  PONTO: 'Ponto',
  MANUAL: 'Relevés importés',
}

export function Rows({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <ul className="divide-y" aria-label={label}>
      {children}
    </ul>
  )
}

/** One line of a list widget: what it is on the left (may shorten), the amount on the right (never cut). */
export function Row({ primary, secondary, end, href }: { primary: React.ReactNode; secondary?: React.ReactNode; end?: React.ReactNode; href?: string }) {
  const content = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{primary}</span>
        {secondary ? <span className="text-muted-foreground block truncate text-xs">{secondary}</span> : null}
      </span>
      {end ? <span className="shrink-0 text-right text-sm">{end}</span> : null}
    </>
  )
  return (
    <li>
      {href ? (
        <Link
          href={href}
          className="hover:bg-muted/60 focus-visible:ring-ring/50 -mx-2 flex items-center gap-3 rounded-md px-2 py-2 outline-none focus-visible:ring-[3px]"
        >
          {content}
        </Link>
      ) : (
        <div className="flex items-center gap-3 py-2">{content}</div>
      )}
    </li>
  )
}

export function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button asChild size="sm" variant="outline" className="mt-3">
      <Link href={href}>
        {children}
        <ArrowRight aria-hidden />
      </Link>
    </Button>
  )
}

export function ARapprocherList({ widget }: WidgetProps) {
  const { state, retry, companyId } = useWidgetSource('reconciliation')
  const data = state.status === 'ready' ? state.data : null
  return (
    <WidgetFrame
      title={widget.title}
      description={data ? (data.count === 0 ? 'Toutes les transactions ont leur écriture.' : `${plural(data.count, 'transaction')} sans écriture, les plus récentes d'abord.`) : undefined}
      busy={state.status === 'loading'}
    >
      {state.status === 'loading' ? (
        <ListSkeleton rows={5} />
      ) : state.status === 'error' ? (
        <WidgetError message={state.message} onRetry={retry} />
      ) : !data || data.count === 0 ? (
        <EmptyState icon={CheckCircle2} tone="success" title="Rien à rapprocher" description="Les nouvelles transactions bancaires apparaîtront ici." />
      ) : (
        <>
          <Rows label="Transactions à rapprocher">
            {data.recent.map((t) => (
              <Row
                key={t.id}
                primary={t.counterpartyName || t.label || 'Transaction sans libellé'}
                secondary={
                  <>
                    <DateDisplay value={t.date} /> · {bankAccountName(t.bankAccount)}
                  </>
                }
                end={<Amount value={t.amountCents / 100} sign="always" />}
              />
            ))}
          </Rows>
          <FooterLink href={`/${companyId}/reconciliation`}>Ouvrir le rapprochement</FooterLink>
        </>
      )}
    </WidgetFrame>
  )
}

function EntryRows({ entries, companyId, label }: { entries: EntrySummary[]; companyId: string; label: string }) {
  return (
    <Rows label={label}>
      {entries.map((e) => (
        <Row
          key={e.id}
          href={`/${companyId}/entries/${e.id}`}
          primary={e.description || e.reference || `Écriture ${e.entryNumber}`}
          secondary={
            <>
              <DateDisplay value={e.date} /> · <span className="font-mono" title={e.journalLabel}>{e.journalCode}</span> · {e.entryNumber}
            </>
          }
          end={<Amount value={e.totalCents / 100} />}
        />
      ))}
    </Rows>
  )
}

export function BrouillonsList({ widget, size }: WidgetProps) {
  const { state, retry, companyId } = useWidgetSource('drafts')
  const data = state.status === 'ready' ? state.data : null
  const count = data?.count ?? 0
  return (
    <WidgetFrame
      title={widget.title}
      description={data?.fiscalYear ? `Exercice ${data.fiscalYear.year}` : undefined}
      action={data?.fiscalYear && count > 0 ? <span className="num text-2xl font-semibold">{count}</span> : null}
      busy={state.status === 'loading'}
    >
      {state.status === 'loading' ? (
        <ListSkeleton rows={size === 'S' ? 1 : 4} />
      ) : state.status === 'error' ? (
        <WidgetError message={state.message} onRetry={retry} />
      ) : !data?.fiscalYear ? (
        <EmptyState icon={FilePen} title="Aucun exercice" />
      ) : count === 0 ? (
        <EmptyState icon={CheckCircle2} tone="success" title="Aucun brouillon à valider" description="Les écritures proposées par les règles et le rapprochement arrivent ici en brouillon." />
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            {plural(count, 'écriture')} en brouillon. Vérifiez-les puis validez-les pour qu&apos;elles comptent dans vos états.
          </p>
          {size !== 'S' && data.entries?.length ? (
            <div className="mt-2">
              <EntryRows entries={data.entries} companyId={companyId} label="Brouillons les plus récents" />
            </div>
          ) : null}
          <FooterLink href={`/${companyId}/entries?statut=brouillon`}>Voir les brouillons</FooterLink>
        </>
      )}
    </WidgetFrame>
  )
}

export function DernieresEcrituresList({ widget }: WidgetProps) {
  const { state, retry, companyId } = useWidgetSource('recent-entries')
  const data = state.status === 'ready' ? state.data : null
  return (
    <WidgetFrame
      title={widget.title}
      description={data?.fiscalYear ? `Exercice ${data.fiscalYear.year}` : undefined}
      busy={state.status === 'loading'}
    >
      {state.status === 'loading' ? (
        <ListSkeleton rows={5} />
      ) : state.status === 'error' ? (
        <WidgetError message={state.message} onRetry={retry} />
      ) : !data?.fiscalYear ? (
        <EmptyState icon={FilePen} title="Aucun exercice" />
      ) : !data.entries?.length ? (
        <EmptyState
          icon={FilePen}
          title="Aucune écriture sur l'exercice"
          action={
            <Button asChild size="sm">
              <Link href={`/${companyId}/entries/new`}>Saisir une écriture</Link>
            </Button>
          }
        />
      ) : (
        <>
          <Rows label="Écritures les plus récentes">
            {data.entries.map((e) => (
              <Row
                key={e.id}
                href={`/${companyId}/entries/${e.id}`}
                primary={e.description || e.reference || `Écriture ${e.entryNumber}`}
                secondary={
                  <>
                    <DateDisplay value={e.date} /> · <span className="font-mono" title={e.journalLabel}>{e.journalCode}</span> · {e.entryNumber}
                  </>
                }
                end={
                  <span className="flex flex-col items-end gap-1">
                    <Amount value={e.totalCents / 100} />
                    {e.status === 'draft' ? <StatusBadge tone="warning">Brouillon</StatusBadge> : null}
                  </span>
                }
              />
            ))}
          </Rows>
          <FooterLink href={`/${companyId}/entries`}>Toutes les écritures</FooterLink>
        </>
      )}
    </WidgetFrame>
  )
}

/** Consent of a bank account as a badge: to renew soon, expired, or a failed sync. */
function AccountState({ consentExpiresAt, hasSyncError, now }: { consentExpiresAt: string | null; hasSyncError: boolean; now: Date }) {
  const consent = consentStatus(consentExpiresAt, now)
  if (consent.level === 'expired') return <StatusBadge tone="danger">Accès expiré</StatusBadge>
  if (consent.level === 'urgent' || consent.level === 'soon') {
    return (
      <StatusBadge tone="warning" title="Renouvelez l'accès à la banque pour continuer la synchronisation">
        Accès à renouveler ({plural(consent.daysLeft ?? 0, 'jour')})
      </StatusBadge>
    )
  }
  if (hasSyncError) return <StatusBadge tone="warning">Synchronisation en erreur</StatusBadge>
  return null
}

export function ComptesBancairesList({ widget }: WidgetProps) {
  const { state, retry, companyId } = useWidgetSource('bank-accounts')
  const data = state.status === 'ready' ? state.data : null
  // Badges compare the consent expiry with the time the dashboard opened.
  const [now] = React.useState(() => new Date())
  const total = data?.accounts.filter((a) => a.currency === 'EUR').reduce((sum, a) => sum + a.balanceCents, 0) ?? 0
  return (
    <WidgetFrame
      title={widget.title}
      description="Soldes déclarés par vos banques."
      action={data && data.accounts.length > 1 ? <Amount value={total / 100} className="text-lg font-semibold" /> : null}
      busy={state.status === 'loading'}
    >
      {state.status === 'loading' ? (
        <ListSkeleton rows={2} />
      ) : state.status === 'error' ? (
        <WidgetError message={state.message} onRetry={retry} />
      ) : !data || data.accounts.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="Aucun compte bancaire"
          description="Connectez votre banque ou importez un relevé pour suivre vos soldes."
          action={
            <Button asChild size="sm">
              <Link href={`/${companyId}/banking`}>Connecter une banque</Link>
            </Button>
          }
        />
      ) : (
        <>
          <Rows label="Comptes bancaires">
            {data.accounts.map((a) => (
              <Row
                key={a.id}
                primary={bankAccountName(a)}
                secondary={
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 whitespace-normal">
                    <span>{PROVIDER_NAMES[a.provider] ?? a.provider}</span>
                    {a.lastSyncedAt ? (
                      <span>
                        Synchronisé le <DateDisplay value={a.lastSyncedAt} format="datetime" />
                      </span>
                    ) : null}
                    <AccountState consentExpiresAt={a.consentExpiresAt} hasSyncError={a.hasSyncError} now={now} />
                  </span>
                }
                end={
                  a.currency === 'EUR' ? (
                    <Amount value={a.balanceCents / 100} />
                  ) : (
                    <span className="num whitespace-nowrap">
                      {(a.balanceCents / 100).toLocaleString('fr-FR', { style: 'currency', currency: a.currency })}
                    </span>
                  )
                }
              />
            ))}
          </Rows>
          <FooterLink href={`/${companyId}/banking`}>Gérer les comptes</FooterLink>
        </>
      )}
    </WidgetFrame>
  )
}

export function ReglesList({ widget }: WidgetProps) {
  const { state, retry, companyId } = useWidgetSource('rules')
  const data = state.status === 'ready' ? state.data : null
  return (
    <WidgetFrame title={widget.title} busy={state.status === 'loading'}>
      {state.status === 'loading' ? (
        <ListSkeleton rows={4} />
      ) : state.status === 'error' ? (
        <WidgetError message={state.message} onRetry={retry} />
      ) : !data || data.total === 0 ? (
        <EmptyState
          icon={Wand2}
          title="Aucune règle d'affectation"
          description="Une règle comptabilise toute seule les transactions qui se répètent (abonnements, loyers, frais bancaires)."
          action={
            <Button asChild size="sm">
              <Link href={`/${companyId}/rules/new`}>Créer une règle</Link>
            </Button>
          }
        />
      ) : data.rules.length === 0 ? (
        <EmptyState icon={ListChecks} title="Aucune règle n'a encore servi" description="Appliquez les règles depuis le rapprochement pour comptabiliser vos transactions." />
      ) : (
        <>
          <Rows label="Règles les plus utilisées">
            {data.rules.map((r) => (
              <Row
                key={r.id}
                primary={r.name}
                secondary={
                  r.lastUsedAt ? (
                    <>
                      Dernière utilisation le <DateDisplay value={r.lastUsedAt} />
                    </>
                  ) : undefined
                }
                end={
                  <span className="flex flex-col items-end gap-1">
                    <span className="num whitespace-nowrap">{plural(r.usageCount, 'transaction')}</span>
                    {r.enabled ? null : <StatusBadge tone="neutral">Inactive</StatusBadge>}
                  </span>
                }
              />
            ))}
          </Rows>
          <FooterLink href={`/${companyId}/rules`}>Toutes les règles</FooterLink>
        </>
      )}
    </WidgetFrame>
  )
}
