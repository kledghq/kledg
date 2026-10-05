'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ClipboardCheck, MoreHorizontal, Pencil, Plus, Scale, ShieldAlert, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Amount, EmptyState, PageHeader, StatusBadge, formatAmount, formatDisplayDate, useConfirm } from '@/components/shared'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { docsUrl } from '@/lib/docs-links'
import { CATEGORY_LABELS, NATURE_LABELS, receivableBaseExclTaxCents } from '@/lib/provisions/rules'
import type { ProvisionView } from '@/lib/year-end/get-year-end-inventory.service'
import type { YearRef } from '@/lib/year-end/inventory'
import type { DoubtfulReceivable } from '@/lib/provisions/doubtful-receivables.service'
import { AssessmentDialog, ProvisionDialog, type ProvisionDraft } from './provision-dialogs'
import { AdjustmentBadge, euros, sendJson, useJson } from './shared'

export type ProvisionGroup = 'risks' | 'impairments'

/**
 * The page of each group, its own sidebar entry (nav-config.ts): Risques et
 * charges (151, 152) and Dépréciations (29, 39, 49, 59).
 */
export function provisionsPageUrl(companyId: string, group: ProvisionGroup): string {
  return group === 'risks' ? `/${companyId}/provisions` : `/${companyId}/provisions/impairments`
}

const PAGES: Record<ProvisionGroup, { title: string; description: string }> = {
  risks: {
    title: 'Risques et charges',
    description: "Les provisions pour risques et charges probables (litiges, garanties, remises en état), revues à chaque clôture. Kledg propose la dotation ou la reprise de l'exercice.",
  },
  impairments: {
    title: 'Dépréciations',
    description: "Les pertes de valeur des immobilisations, des stocks, des créances et des valeurs mobilières, revues à chaque clôture. Kledg propose la dotation ou la reprise de l'exercice.",
  },
}

/** "Dotation 1 200,00 €", "Reprise 800,00 €" or "Aucun". */
export function movementText(cents: number): string {
  if (cents > 0) return `Dotation ${formatAmount(cents / 100)}`
  if (cents < 0) return `Reprise ${formatAmount(-cents / 100)}`
  return 'Aucun'
}

/**
 * Provisions for risks and charges (group risks, /provisions) or impairments
 * of assets (group impairments, /provisions/impairments)
 * (docs/provisions-et-subventions.md): what each one carries in, what this
 * closing requires and the movement to book. Members who keep the books
 * record them and their assessment; the entries are prepared on the
 * Travaux de clôture page.
 */
export function ProvisionsPage({ companyId, group }: { companyId: string; group: ProvisionGroup }) {
  const { can } = useCompanyAccess()
  const canEdit = can({ entries: ['create'] })
  const canDelete = can({ entries: ['delete'] })
  const [fiscalYearId, setFiscalYearId] = React.useState('')
  const [editing, setEditing] = React.useState<{ provision: ProvisionView | null; draft: ProvisionDraft } | null>(null)
  const [assessing, setAssessing] = React.useState<ProvisionView | null>(null)
  const { confirm, dialog } = useConfirm()
  const url = fiscalYearId ? `/api/provisions?${new URLSearchParams({ companyId, fiscalYearId })}` : null
  const { data, error, loading, reload } = useJson<{ fiscalYear: YearRef; provisions: ProvisionView[] }>(url, 'Les provisions ne se sont pas chargées. Réessayez dans un instant.')

  const all = data?.provisions ?? []
  const shown = all.filter((p) => (group === 'risks' ? p.category === 'RISK_CHARGE' : p.category !== 'RISK_CHARGE'))
  const inYear = shown.filter((p) => p.status !== 'not_in_year')
  const outOfYear = shown.filter((p) => p.status === 'not_in_year')
  const closed = data?.fiscalYear.isClosed ?? false

  const remove = async (p: ProvisionView) => {
    const ok = await confirm({
      title: `Supprimer ${p.label} ?`,
      description: 'Ses évaluations et ses écritures en brouillon sont supprimées avec elle. Une provision dont un mouvement est validé ne se supprime pas.',
      confirmLabel: 'Supprimer',
      tone: 'destructive',
    })
    if (!ok) return
    try {
      await sendJson(`/api/provisions/${p.id}`, 'DELETE', undefined, "La suppression n'a pas abouti. Réessayez dans un instant.")
      toast.success(p.category === 'RISK_CHARGE' ? 'Provision supprimée' : 'Dépréciation supprimée')
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const actions = (p: ProvisionView) => {
    if (!canEdit && !canDelete) return null
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions sur ${p.label}`} title="Actions">
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit && !closed && p.status !== 'not_in_year' ? (
            <DropdownMenuItem onSelect={() => setAssessing(p)}>
              <Scale aria-hidden />
              Évaluer à la clôture
            </DropdownMenuItem>
          ) : null}
          {canEdit ? (
            <DropdownMenuItem onSelect={() => setEditing({ provision: p, draft: { category: p.category } })}>
              <Pencil aria-hidden />
              Modifier
            </DropdownMenuItem>
          ) : null}
          {canDelete ? (
            <DropdownMenuItem onSelect={() => remove(p)} className="hover:text-destructive">
              <Trash2 aria-hidden />
              Supprimer
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const meta = (p: ProvisionView) =>
    [
      `${p.accountCode} ${p.accountLabel}`,
      p.category === 'RISK_CHARGE' ? null : CATEGORY_LABELS[p.category],
      NATURE_LABELS[p.nature].toLowerCase(),
      p.taxDeductible ? null : 'non déductible',
      p.fixedAsset ? `${p.fixedAsset.label}, valeur nette ${formatAmount(p.fixedAsset.netBookValueCents / 100)}` : null,
      p.tiersCode ? `client ${p.tiersCode}` : null,
      p.closedOn ? `fin le ${formatDisplayDate(p.closedOn, 'short')}` : null,
    ]
      .filter(Boolean)
      .join(' · ')

  const newDraft: ProvisionDraft = group === 'risks' ? { category: 'RISK_CHARGE' } : { category: 'FIXED_ASSET' }

  return (
    <div className="space-y-6">
      <PageHeader
        title={PAGES[group].title}
        description={PAGES[group].description}
        docsHref={docsUrl('fiscalYear')}
        actions={
          canEdit ? (
            <Button onClick={() => setEditing({ provision: null, draft: newDraft })} disabled={!data}>
              <Plus aria-hidden />
              {group === 'risks' ? 'Nouvelle provision' : 'Nouvelle dépréciation'}
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <FiscalYearSelector id="provisions-fiscal-year" companyId={companyId} value={fiscalYearId} onValueChange={setFiscalYearId} showLabel={false} showPeriod={false} className="w-48" />
        <Button variant="outline" size="sm" asChild className="ml-auto">
          <Link href={`/${companyId}/year-end`}>
            <ClipboardCheck aria-hidden />
            Travaux de clôture
          </Link>
        </Button>
      </div>

      {error ? (
        <EmptyState bordered title="Les provisions ne se sont pas chargées" description={error} action={<Button size="sm" onClick={reload}>Réessayer</Button>} />
      ) : !data || (loading && !data) ? (
        <Skeleton className="h-64 w-full rounded-lg" aria-busy />
      ) : inYear.length === 0 && outOfYear.length === 0 ? (
        <EmptyState
          bordered
          icon={ShieldAlert}
          title={group === 'risks' ? 'Aucune provision pour risques et charges' : 'Aucune dépréciation'}
          description={
            group === 'risks'
              ? "Un litige en cours, une garantie donnée aux clients, une remise en état à prévoir\u00a0: si une sortie d'argent est probable à la clôture, enregistrez-la ici."
              : "Une immobilisation, un stock ou une créance qui vaut moins que sa valeur en comptabilité à la clôture se déprécie. Les clients en retard sont listés plus bas."
          }
          action={canEdit ? <Button size="sm" onClick={() => setEditing({ provision: null, draft: newDraft })}>{group === 'risks' ? 'Nouvelle provision' : 'Nouvelle dépréciation'}</Button> : undefined}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Clôture {data.fiscalYear.year}</CardTitle>
            <CardDescription>
              Du {formatDisplayDate(data.fiscalYear.startDate, 'short')} au {formatDisplayDate(data.fiscalYear.endDate, 'short')}
              {closed ? ', exercice clôturé' : ''}. Le mouvement est la dotation ou la reprise qui amène le compte au montant requis.
            </CardDescription>
          </CardHeader>
          <CardContent className="@container/list space-y-4">
            <ul className="divide-y rounded-md border @min-[56rem]/list:hidden" aria-label={group === 'risks' ? 'Provisions' : 'Dépréciations'}>
              {inYear.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 px-3 py-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium">{p.label}</p>
                    <AdjustmentBadge status={p.status} />
                    <p className="text-muted-foreground text-xs">{meta(p)}</p>
                    <p className="text-muted-foreground text-xs">
                      Ouverture <Amount value={euros(p.openingCents)} />, requis {p.requiredCents === null ? 'à évaluer' : <Amount value={euros(p.requiredCents)} />}
                    </p>
                    <p className="text-sm">{p.status === 'to_assess' ? 'À évaluer' : p.reversalRefused ? 'Reprise interdite (fonds commercial)' : movementText(p.proposedCents + p.bookedCents)}</p>
                  </div>
                  {actions(p)}
                </li>
              ))}
            </ul>
            <div className="hidden rounded-md border @min-[56rem]/list:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Libellé</TableHead>
                    <TableHead numeric>Ouverture</TableHead>
                    <TableHead numeric>Requis à la clôture</TableHead>
                    <TableHead numeric>Mouvement</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inYear.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="max-w-md">
                        <p className="font-medium">{p.label}</p>
                        <p className="text-muted-foreground truncate text-xs" title={meta(p)}>
                          {meta(p)}
                        </p>
                      </TableCell>
                      <TableCell numeric>
                        <Amount value={euros(p.openingCents)} />
                      </TableCell>
                      <TableCell numeric>{p.requiredCents === null ? <span className="text-muted-foreground">À évaluer</span> : <Amount value={euros(p.requiredCents)} />}</TableCell>
                      <TableCell numeric>{p.status === 'to_assess' ? <span className="text-muted-foreground">À évaluer</span> : p.reversalRefused ? <span className="text-muted-foreground">Reprise interdite</span> : movementText(p.proposedCents + p.bookedCents)}</TableCell>
                      <TableCell>
                        <AdjustmentBadge status={p.status} />
                        {p.entry ? <span className="text-muted-foreground ml-2 font-mono text-xs">{p.entry.entryNumber}</span> : null}
                      </TableCell>
                      <TableCell>{actions(p)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {outOfYear.length > 0 ? (
              <p className="text-muted-foreground text-xs">
                Hors de cet exercice&nbsp;: {outOfYear.map((p) => p.label).join(', ')}.
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}

      {group === 'impairments' && data ? <DoubtfulReceivablesCard companyId={companyId} fiscalYear={data.fiscalYear} canEdit={canEdit && !closed} onCreate={(draft) => setEditing({ provision: null, draft })} /> : null}

      <ProvisionDialog
        companyId={companyId}
        open={editing !== null}
        provision={editing?.provision ?? null}
        draft={editing?.draft ?? newDraft}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={reload}
      />
      {data ? <AssessmentDialog provision={assessing} fiscalYear={data.fiscalYear} onOpenChange={(open) => !open && setAssessing(null)} onSaved={reload} /> : null}
      {dialog}
    </div>
  )
}

/**
 * Customers overdue at the closing (aged balance), as candidates for an
 * impairment of their receivable (491) and a transfer to 416.
 */
function DoubtfulReceivablesCard({
  companyId,
  fiscalYear,
  canEdit,
  onCreate,
}: {
  companyId: string
  fiscalYear: YearRef
  canEdit: boolean
  onCreate: (draft: ProvisionDraft) => void
}) {
  const [minDays, setMinDays] = React.useState<'30' | '60' | '90'>('90')
  const [busy, setBusy] = React.useState<string | null>(null)
  const { confirm, dialog } = useConfirm()
  const { data, error, reload } = useJson<{ asOf: string; items: DoubtfulReceivable[] }>(
    `/api/provisions/doubtful-receivables?${new URLSearchParams({ companyId, fiscalYearId: fiscalYear.id, minDaysOverdue: minDays })}`,
    'Les créances en retard ne se sont pas chargées. Réessayez dans un instant.',
  )

  const reclassify = async (item: DoubtfulReceivable) => {
    const ok = await confirm({
      title: `Reclasser ${item.label} en clients douteux ?`,
      description: `Une écriture en brouillon au ${formatDisplayDate(fiscalYear.endDate, 'short')} passe ${formatAmount(item.openInclTaxCents / 100)} du compte ${item.accountCodes.join(', ')} au compte 416. Vous la validerez depuis les écritures.`,
      confirmLabel: 'Préparer le reclassement',
    })
    if (!ok) return
    setBusy(item.tiersCode)
    try {
      await sendJson('/api/provisions/doubtful-receivables/reclassify', 'POST', { companyId, fiscalYearId: fiscalYear.id, tiersCode: item.tiersCode }, "Le reclassement n'a pas été préparé. Réessayez dans un instant.")
      toast.success('Reclassement préparé en brouillon')
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const draftFor = (item: DoubtfulReceivable): ProvisionDraft => ({
    category: 'RECEIVABLE',
    accountCode: '491',
    tiersCode: item.tiersCode,
    label: `Créance douteuse ${item.label}`,
    openedOn: fiscalYear.endDate,
    justification: `${formatAmount(item.overdueInclTaxCents / 100)} TTC en retard depuis le ${item.oldestDueDate ? formatDisplayDate(item.oldestDueDate, 'short') : '?'}. Base hors taxe à 20 % : ${formatAmount(receivableBaseExclTaxCents(item.openInclTaxCents, 2000) / 100)}. Perte probable estimée à `,
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Créances en retard à la clôture</CardTitle>
        <CardDescription>
          Les clients dont des factures restent impayées au {formatDisplayDate(fiscalYear.endDate, 'short')}, d&apos;après la balance âgée. Jugez le risque de chacun&nbsp;:
          la dépréciation porte sur le montant hors taxe (la TVA d&apos;une créance perdue se récupère) et sur la perte probable, pas sur toute la créance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <label htmlFor="doubtful-threshold" className="text-sm">
            En retard de plus de
          </label>
          <Select value={minDays} onValueChange={(v) => setMinDays(v as '30' | '60' | '90')}>
            <SelectTrigger id="doubtful-threshold" size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 jours</SelectItem>
              <SelectItem value="60">60 jours</SelectItem>
              <SelectItem value="90">90 jours</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : !data ? (
          <Skeleton className="h-24 w-full" aria-busy />
        ) : data.items.length === 0 ? (
          <p className="text-muted-foreground text-sm">Aucun client en retard au-delà de ce délai à la clôture.</p>
        ) : (
          <ul className="divide-y rounded-md border" aria-label="Créances en retard">
            {data.items.map((item) => (
              <li key={item.tiersCode} className="flex flex-wrap items-start justify-between gap-3 px-3 py-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">
                    {item.label} <span className="text-muted-foreground font-mono text-xs">{item.tiersCode}</span>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    En retard <Amount value={euros(item.overdueInclTaxCents)} /> TTC sur <Amount value={euros(item.openInclTaxCents)} /> dus
                    {item.oldestDueDate ? `, plus ancienne échéance le ${formatDisplayDate(item.oldestDueDate, 'short')}` : ''}
                  </p>
                  {item.provision ? <StatusBadge tone="info">Dépréciation suivie</StatusBadge> : null}
                </div>
                {canEdit ? (
                  <div className="flex flex-wrap gap-2">
                    {!item.provision ? (
                      <Button size="xs" variant="outline" onClick={() => onCreate(draftFor(item))}>
                        Créer la dépréciation
                      </Button>
                    ) : null}
                    {item.accountCodes.length === 1 ? (
                      <Button size="xs" variant="outline" loading={busy === item.tiersCode} onClick={() => reclassify(item)}>
                        Reclasser en 416
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {dialog}
    </Card>
  )
}
