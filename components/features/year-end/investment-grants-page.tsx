'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ClipboardCheck, HandCoins, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { AmountInput } from '@/components/ui/amount-input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DateInput } from '@/components/ui/date-input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Amount, EmptyState, Field, PageHeader, formatDisplayDate, useConfirm } from '@/components/shared'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { docsUrl } from '@/lib/docs-links'
import { GRANT_SPREADINGS, SPREADING_LABELS, type GrantSpreading } from '@/lib/investment-grants/schedule'
import type { GrantView } from '@/lib/year-end/get-year-end-inventory.service'
import type { YearRef } from '@/lib/year-end/inventory'
import { AdjustmentBadge, euros, sendJson, useJson } from './shared'

interface AssetOption {
  id: string
  label: string
  depreciationMethod: string
}

/**
 * Investment grants (docs/provisions-et-subventions.md): recorded in equity
 * (131), transferred to the result (139 to 747) over the life of what they
 * financed. The share of each year is prepared with the other year-end
 * entries.
 */
export function InvestmentGrantsPage({ companyId }: { companyId: string }) {
  const { can } = useCompanyAccess()
  const canEdit = can({ entries: ['create'] })
  const canDelete = can({ entries: ['delete'] })
  const [fiscalYearId, setFiscalYearId] = React.useState('')
  const [editing, setEditing] = React.useState<GrantView | 'new' | null>(null)
  const { confirm, dialog } = useConfirm()
  const url = fiscalYearId ? `/api/investment-grants?${new URLSearchParams({ companyId, fiscalYearId })}` : null
  const { data, error, reload } = useJson<{ fiscalYear: YearRef; grants: GrantView[] }>(url, 'Les subventions ne se sont pas chargées. Réessayez dans un instant.')
  const grants = data?.grants ?? []

  const remove = async (g: GrantView) => {
    const ok = await confirm({
      title: `Supprimer ${g.label} ?`,
      description: 'Ses reprises en brouillon sont supprimées avec elle. Une subvention dont une reprise est validée ne se supprime pas.',
      confirmLabel: 'Supprimer',
      tone: 'destructive',
    })
    if (!ok) return
    try {
      await sendJson(`/api/investment-grants/${g.id}`, 'DELETE', undefined, "La suppression n'a pas abouti. Réessayez dans un instant.")
      toast.success('Subvention supprimée')
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const actions = (g: GrantView) =>
    canEdit || canDelete ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions sur ${g.label}`} title="Actions">
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit ? (
            <DropdownMenuItem onSelect={() => setEditing(g)}>
              <Pencil aria-hidden />
              Modifier
            </DropdownMenuItem>
          ) : null}
          {canDelete ? (
            <DropdownMenuItem onSelect={() => remove(g)} className="hover:text-destructive">
              <Trash2 aria-hidden />
              Supprimer
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null

  const meta = (g: GrantView) =>
    [
      g.grantor,
      `octroyée le ${formatDisplayDate(g.grantedOn, 'short')}`,
      SPREADING_LABELS[g.spreading].toLowerCase() + (g.durationYears ? ` (${g.durationYears} ans)` : ''),
      g.fixedAsset ? g.fixedAsset.label : null,
    ]
      .filter(Boolean)
      .join(' · ')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subventions d'investissement"
        description="Les aides reçues pour financer une immobilisation, inscrites en capitaux propres puis virées au résultat au rythme de ce qu'elles financent."
        docsHref={docsUrl('equity')}
        actions={
          canEdit ? (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden />
              Nouvelle subvention
            </Button>
          ) : null
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <FiscalYearSelector id="grants-fiscal-year" companyId={companyId} value={fiscalYearId} onValueChange={setFiscalYearId} showLabel={false} showPeriod={false} className="w-48" />
        <Button variant="outline" size="sm" asChild className="ml-auto">
          <Link href={`/${companyId}/year-end`}>
            <ClipboardCheck aria-hidden />
            Travaux de clôture
          </Link>
        </Button>
      </div>

      {error ? (
        <EmptyState bordered title="Les subventions ne se sont pas chargées" description={error} action={<Button size="sm" onClick={reload}>Réessayer</Button>} />
      ) : !data ? (
        <Skeleton className="h-64 w-full rounded-lg" aria-busy />
      ) : grants.length === 0 ? (
        <EmptyState
          bordered
          icon={HandCoins}
          title="Aucune subvention d'investissement"
          description="Une aide de la région, de l'État ou de l'Europe pour acheter un équipement s'enregistre ici : Kledg calcule la part à virer au résultat chaque année."
          action={canEdit ? <Button size="sm" onClick={() => setEditing('new')}>Nouvelle subvention</Button> : undefined}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Exercice {data.fiscalYear.year}</CardTitle>
            <CardDescription>La quote-part de l&apos;exercice passe du compte 139 au compte 747&nbsp;; le reste demeure en capitaux propres.</CardDescription>
          </CardHeader>
          <CardContent className="@container/list">
            <ul className="divide-y rounded-md border @min-[56rem]/list:hidden" aria-label="Subventions">
              {grants.map((g) => (
                <li key={g.id} className="flex items-start justify-between gap-3 px-3 py-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium">{g.label}</p>
                    <AdjustmentBadge status={g.status} />
                    <p className="text-muted-foreground text-xs">{meta(g)}</p>
                    <p className="text-sm">
                      Quote-part <Amount value={euros(g.bookedCents + g.proposedCents)} /> sur <Amount value={euros(g.amountCents)} />, reste <Amount value={euros(g.remainingCents)} />
                    </p>
                  </div>
                  {actions(g)}
                </li>
              ))}
            </ul>
            <div className="hidden rounded-md border @min-[56rem]/list:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subvention</TableHead>
                    <TableHead numeric>Montant</TableHead>
                    <TableHead numeric>Déjà virée</TableHead>
                    <TableHead numeric>Quote-part de l&apos;exercice</TableHead>
                    <TableHead numeric>Reste</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grants.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell className="max-w-md">
                        <p className="font-medium">{g.label}</p>
                        <p className="text-muted-foreground truncate text-xs" title={meta(g)}>
                          {meta(g)}
                        </p>
                      </TableCell>
                      <TableCell numeric>
                        <Amount value={euros(g.amountCents)} />
                      </TableCell>
                      <TableCell numeric>
                        <Amount value={euros(g.transferredBeforeCents)} />
                      </TableCell>
                      <TableCell numeric>
                        <Amount value={euros(g.bookedCents + g.proposedCents)} />
                      </TableCell>
                      <TableCell numeric>
                        <Amount value={euros(g.remainingCents)} />
                      </TableCell>
                      <TableCell>
                        <AdjustmentBadge status={g.status} />
                      </TableCell>
                      <TableCell>{actions(g)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
      <GrantDialog companyId={companyId} grant={editing} onOpenChange={(open) => !open && setEditing(null)} onSaved={reload} />
      {dialog}
    </div>
  )
}

function GrantDialog({
  companyId,
  grant,
  onOpenChange,
  onSaved,
}: {
  companyId: string
  grant: GrantView | 'new' | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  return (
    <Dialog open={grant !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {grant ? <GrantForm key={grant === 'new' ? 'new' : grant.id} companyId={companyId} grant={grant === 'new' ? null : grant} onOpenChange={onOpenChange} onSaved={onSaved} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function GrantForm({ companyId, grant, onOpenChange, onSaved }: { companyId: string; grant: GrantView | null; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [label, setLabel] = React.useState(grant?.label ?? '')
  const [grantor, setGrantor] = React.useState(grant?.grantor ?? '')
  const [amountCents, setAmountCents] = React.useState<number | null>(grant?.amountCents ?? null)
  const [grantedOn, setGrantedOn] = React.useState(grant?.grantedOn ?? '')
  const [spreading, setSpreading] = React.useState<GrantSpreading>(grant?.spreading ?? 'ASSET')
  const [fixedAssetId, setFixedAssetId] = React.useState(grant?.fixedAsset?.id ?? '')
  const [durationYears, setDurationYears] = React.useState(grant?.durationYears ? String(grant.durationYears) : '')
  const [carriedCents, setCarriedCents] = React.useState<number | null>(grant ? grant.carriedCents || null : null)
  const [notes, setNotes] = React.useState(grant?.notes ?? '')
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const assets = useJson<AssetOption[]>(`/api/fixed-assets?${new URLSearchParams({ companyId })}`, 'Les immobilisations ne se sont pas chargées.')
  const needsDuration = spreading === 'LINEAR' || spreading === 'INALIENABILITY'

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!label.trim() || !amountCents || !grantedOn) {
      setError("Indiquez le libellé, le montant et la date d'octroi.")
      return
    }
    const years = Number(durationYears)
    if (needsDuration && !(Number.isInteger(years) && years > 0)) {
      setError('Indiquez une durée en années entières.')
      return
    }
    setError(null)
    setSaving(true)
    const body = {
      label: label.trim(),
      grantor: grantor.trim() || null,
      amountCents,
      grantedOn,
      spreading,
      fixedAssetId: spreading === 'ASSET' || fixedAssetId ? fixedAssetId || null : null,
      durationYears: needsDuration ? years : null,
      carriedCents: carriedCents ?? 0,
      notes: notes.trim() || null,
    }
    try {
      if (grant) await sendJson(`/api/investment-grants/${grant.id}`, 'PATCH', body, "Les modifications n'ont pas été enregistrées. Réessayez dans un instant.")
      else await sendJson('/api/investment-grants', 'POST', { companyId, ...body }, "La subvention n'a pas été créée. Réessayez dans un instant.")
      toast.success(grant ? 'Modifications enregistrées' : 'Subvention créée')
      onSaved()
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{grant ? `Modifier ${grant.label}` : "Nouvelle subvention d'investissement"}</DialogTitle>
        <DialogDescription>Enregistrez d&apos;abord la subvention au compte 131 (écriture de réception)&nbsp;; Kledg calcule ensuite sa reprise de chaque exercice.</DialogDescription>
      </DialogHeader>
      <form id="grant-form" onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Libellé" htmlFor="grant-label" required>
          <Input id="grant-label" autoComplete="off" maxLength={200} placeholder="ex. Aide à l'équipement numérique" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Organisme" htmlFor="grant-grantor" optional>
            <Input id="grant-grantor" autoComplete="off" maxLength={200} placeholder="ex. Région" value={grantor} onChange={(e) => setGrantor(e.target.value)} />
          </Field>
          <Field label="Montant" htmlFor="grant-amount" required>
            <AmountInput id="grant-amount" value={amountCents} onValueChange={setAmountCents} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date d'octroi" htmlFor="grant-date" required>
            <DateInput id="grant-date" value={grantedOn} onValueChange={setGrantedOn} />
          </Field>
          <Field label="Déjà virée au résultat" htmlFor="grant-carried" optional hint="Avant que Kledg ne tienne les comptes.">
            <AmountInput id="grant-carried" value={carriedCents} onValueChange={setCarriedCents} />
          </Field>
        </div>
        <Field label="Rythme de reprise" htmlFor="grant-spreading" required>
          <Select value={spreading} onValueChange={(v) => setSpreading(v as GrantSpreading)}>
            <SelectTrigger id="grant-spreading" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRANT_SPREADINGS.map((s) => (
                <SelectItem key={s} value={s}>
                  {SPREADING_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {spreading === 'ASSET' ? (
          <Field label="Immobilisation financée" htmlFor="grant-asset" required hint="La reprise suit son plan d'amortissement, et le solde est repris l'année de sa sortie.">
            <Select value={fixedAssetId} onValueChange={setFixedAssetId}>
              <SelectTrigger id="grant-asset" className="w-full">
                <SelectValue placeholder={assets.data ? 'Choisissez une immobilisation' : 'Chargement...'} />
              </SelectTrigger>
              <SelectContent>
                {(assets.data ?? [])
                  .filter((a) => a.depreciationMethod !== 'none')
                  .map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        {needsDuration ? (
          <Field label={spreading === 'LINEAR' ? "Durée d'amortissement (années)" : "Durée d'inaliénabilité (années)"} htmlFor="grant-duration" required>
            <Input id="grant-duration" inputMode="numeric" autoComplete="off" value={durationYears} onChange={(e) => setDurationYears(e.target.value.replace(/\D/g, ''))} />
          </Field>
        ) : null}
        <Field label="Notes" htmlFor="grant-notes" optional>
          <Textarea id="grant-notes" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </form>
      <DialogFooter className="max-sm:bg-background max-sm:sticky max-sm:-bottom-6 max-sm:z-10 max-sm:-mx-6 max-sm:border-t max-sm:px-6 max-sm:py-3">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Annuler
        </Button>
        <Button type="submit" form="grant-form" loading={saving}>
          {grant ? 'Enregistrer' : 'Créer la subvention'}
        </Button>
      </DialogFooter>
    </>
  )
}
