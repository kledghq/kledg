'use client'

import * as React from 'react'
import Link from 'next/link'
import { Download, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { AmountInput } from '@/components/ui/amount-input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState, Field, PageHeader, StatusBadge } from '@/components/shared'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { downloadFile } from '@/components/features/reports/download-file'
import { sendJson, useJson } from '@/components/features/year-end/shared'
import { COMMITMENT_KINDS, COMMITMENT_LABELS, type AnnexeDetails, type CommitmentKind } from '@/lib/annexe/schemas'
import type { AnnexeView } from '@/lib/annexe/get-annexe.service'
import type { Block } from '@/lib/approval/documents/model'

type Answer = { none: boolean; text: string | null } | null

/** A note block on screen: the same content as the PDF and the Markdown. */
function NoteBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading':
      return <h3 className="pt-2 text-sm font-semibold">{block.text}</h3>
    case 'paragraph':
      return <p className="text-sm">{block.text}</p>
    case 'note':
      return <p className="text-muted-foreground text-xs">{block.text}</p>
    case 'list':
    case 'checklist':
      return (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )
    case 'table':
      return (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {block.columns.map((c, i) => (
                  <TableHead key={c} numeric={block.numeric?.includes(i)}>
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {block.rows.map((row, r) => (
                <TableRow key={r} className={row[0] === 'Total' ? 'font-medium' : undefined}>
                  {row.map((cell, i) => (
                    <TableCell key={i} numeric={block.numeric?.includes(i)} className="whitespace-nowrap">
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )
    case 'signatures':
      return null
  }
}

/** A free answer: a text, or « Néant ». */
function AnswerField({ id, label, hint, value, onChange }: { id: string; label: string; hint?: string; value: Answer; onChange: (value: Answer) => void }) {
  const none = value?.none ?? false
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="space-y-2">
        <Textarea id={id} rows={2} maxLength={6000} disabled={none} value={value?.text ?? ''} onChange={(e) => onChange(e.target.value.trim() ? { none: false, text: e.target.value } : null)} />
        <div className="flex items-center gap-2">
          <Checkbox id={`${id}-none`} checked={none} onCheckedChange={(checked) => onChange(checked === true ? { none: true, text: null } : null)} />
          <Label htmlFor={`${id}-none`} className="text-sm font-normal">
            Néant
          </Label>
        </div>
      </div>
    </Field>
  )
}

function AnswersForm({ view, companyId, onSaved }: { view: AnnexeView; companyId: string; onSaved: (next: AnnexeView) => void }) {
  const [details, setDetails] = React.useState<AnnexeDetails>(view.details)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const set = <K extends keyof AnnexeDetails>(key: K, value: AnnexeDetails[K]) => setDetails((d) => ({ ...d, [key]: value }))
  const asked = new Set(view.annexe.missing.map((m) => m.id))
  const micro = view.annexe.list === 'micro'
  const full = view.annexe.list === 'full'
  const commitments = details.commitments
  const credits = details.taxCredits

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const next = await sendJson<AnnexeView>('/api/annexe', 'PUT', { companyId, fiscalYearId: view.fiscalYear.id, details }, "Les informations n'ont pas été enregistrées. Réessayez dans un instant.")
      if (next) onSaved(next)
      toast.success('Informations enregistrées')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const updateCommitment = (i: number, patch: Partial<NonNullable<AnnexeDetails['commitments']>['items'][number]>) =>
    set('commitments', { none: false, items: (commitments?.items ?? []).map((c, j) => (j === i ? { ...c, ...patch } : c)) })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Informations à compléter</CardTitle>
        <CardDescription>Ce que les comptes ne disent pas. Les montants viennent des écritures ; ici, seulement ce que vous seul savez.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-6" noValidate>
          {!micro ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <AnswerField id="annexe-derogations" label="Dérogations aux règles générales" hint="PCG art. 831-1, 2°" value={details.derogations} onChange={(v) => set('derogations', v)} />
              <AnswerField id="annexe-events" label="Événements postérieurs à la clôture" hint="PCG art. 831-1, 4°" value={details.postClosingEvents} onChange={(v) => set('postClosingEvents', v)} />
              <AnswerField id="annexe-related" label="Transactions avec les parties liées hors conditions de marché" hint="PCG art. 834-2" value={details.relatedParties} onChange={(v) => set('relatedParties', v)} />
              <Field label="Autres informations" htmlFor="annexe-other" optional hint="PCG art. 831-1, 5°">
                <Textarea id="annexe-other" rows={2} maxLength={6000} value={details.otherInformation ?? ''} onChange={(e) => set('otherInformation', e.target.value || null)} />
              </Field>
            </div>
          ) : null}

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Engagements hors bilan</legend>
            <div className="flex items-center gap-2">
              <Checkbox id="annexe-commitments-none" checked={commitments?.none ?? false} onCheckedChange={(c) => set('commitments', c === true ? { none: true, items: [] } : null)} />
              <Label htmlFor="annexe-commitments-none" className="text-sm font-normal">
                Néant
              </Label>
            </div>
            {(commitments?.items ?? []).map((c, i) => (
              <div key={i} className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
                <Field label="Nature" htmlFor={`commitment-kind-${i}`}>
                  <Select value={c.kind} onValueChange={(v) => updateCommitment(i, { kind: v as CommitmentKind })}>
                    <SelectTrigger id={`commitment-kind-${i}`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COMMITMENT_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {COMMITMENT_LABELS[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Description" htmlFor={`commitment-description-${i}`}>
                  <Input id={`commitment-description-${i}`} maxLength={1000} value={c.description} onChange={(e) => updateCommitment(i, { description: e.target.value })} />
                </Field>
                <Field label={c.kind === 'leasing' ? 'Redevances restant à payer' : 'Montant'} htmlFor={`commitment-amount-${i}`} optional>
                  <AmountInput id={`commitment-amount-${i}`} value={c.amountCents} onValueChange={(v) => updateCommitment(i, { amountCents: v })} />
                </Field>
                {c.kind === 'leasing' ? (
                  <Field label="Prix d'achat résiduel" htmlFor={`commitment-residual-${i}`} optional>
                    <AmountInput id={`commitment-residual-${i}`} value={c.residualCents} onValueChange={(v) => updateCommitment(i, { residualCents: v })} />
                  </Field>
                ) : null}
                <div className="sm:col-span-2">
                  <Button type="button" variant="ghost" size="xs" className="hover:text-destructive" onClick={() => set('commitments', { none: false, items: (commitments?.items ?? []).filter((_, j) => j !== i) })}>
                    <Trash2 aria-hidden />
                    Retirer
                  </Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => set('commitments', { none: false, items: [...(commitments?.items ?? []), { kind: 'guarantee_given', description: '', amountCents: null, residualCents: null }] })}>
              <Plus aria-hidden />
              Ajouter un engagement
            </Button>
          </fieldset>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-medium sm:col-span-2">Dirigeants</legend>
            <Field label="Avances et crédits alloués aux dirigeants" htmlFor="annexe-advances" hint="PCG art. 835-1">
              <div className="space-y-2">
                <AmountInput id="annexe-advances" disabled={details.directorAdvances?.none ?? false} value={details.directorAdvances?.amountCents ?? null} onValueChange={(v) => set('directorAdvances', v === null ? null : { none: false, amountCents: v, conditions: details.directorAdvances?.conditions ?? null })} />
                <div className="flex items-center gap-2">
                  <Checkbox id="annexe-advances-none" checked={details.directorAdvances?.none ?? false} onCheckedChange={(c) => set('directorAdvances', c === true ? { none: true, amountCents: null, conditions: null } : null)} />
                  <Label htmlFor="annexe-advances-none" className="text-sm font-normal">
                    Néant
                  </Label>
                </div>
              </div>
            </Field>
            {full ? (
              <Field label="Rémunérations des dirigeants, montant global" htmlFor="annexe-remuneration" hint="PCG art. 835-2">
                <div className="space-y-2">
                  <AmountInput id="annexe-remuneration" disabled={details.directorRemuneration?.omitted ?? false} value={details.directorRemuneration?.amountCents ?? null} onValueChange={(v) => set('directorRemuneration', v === null ? null : { omitted: false, amountCents: v })} />
                  <div className="flex items-center gap-2">
                    <Switch id="annexe-remuneration-omitted" checked={details.directorRemuneration?.omitted ?? false} onCheckedChange={(c) => set('directorRemuneration', c ? { omitted: true, amountCents: null } : null)} />
                    <Label htmlFor="annexe-remuneration-omitted" className="text-sm font-normal">
                      Non mentionnées&nbsp;: le montant identifierait un dirigeant
                    </Label>
                  </div>
                </div>
              </Field>
            ) : null}
          </fieldset>

          {!micro ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Effectif moyen" htmlFor="annexe-employees" hint="PCG art. 837-1 ; par défaut, celui de la page Approbation des comptes.">
                <Input id="annexe-employees" type="number" inputMode="numeric" min={0} value={details.employees ?? ''} onChange={(e) => set('employees', e.target.value === '' ? null : Math.max(0, Math.trunc(Number(e.target.value))))} />
              </Field>
              <Field label="Crédits d'impôt" htmlFor="annexe-credits" hint="PCG art. 833-2">
                <div className="space-y-2">
                  {(credits?.items ?? []).map((c, i) => (
                    <div key={i} className="flex gap-2">
                      <Input aria-label="Crédit d'impôt" maxLength={200} value={c.label} onChange={(e) => set('taxCredits', { none: false, items: (credits?.items ?? []).map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                      <AmountInput aria-label="Montant" value={c.amountCents} onValueChange={(v) => set('taxCredits', { none: false, items: (credits?.items ?? []).map((x, j) => (j === i ? { ...x, amountCents: v ?? 0 } : x)) })} />
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="button" id="annexe-credits" variant="outline" size="sm" onClick={() => set('taxCredits', { none: false, items: [...(credits?.items ?? []), { label: "Crédit d'impôt recherche", amountCents: 0 }] })}>
                      <Plus aria-hidden />
                      Ajouter
                    </Button>
                    <div className="flex items-center gap-2">
                      <Checkbox id="annexe-credits-none" checked={credits?.none ?? false} onCheckedChange={(c) => set('taxCredits', c === true ? { none: true, items: [] } : null)} />
                      <Label htmlFor="annexe-credits-none" className="text-sm font-normal">
                        Néant
                      </Label>
                    </div>
                  </div>
                </div>
              </Field>
              {asked.has('receivableMaturities') || details.receivableMaturities ? (
                <Field label="Créances à plus d'un an" htmlFor="annexe-receivables" hint="Part des créances de la clôture dont l'échéance dépasse un an (PCG art. 832-9).">
                  <AmountInput id="annexe-receivables" value={details.receivableMaturities?.overOneYearCents ?? null} onValueChange={(v) => set('receivableMaturities', v === null ? null : { overOneYearCents: v })} />
                </Field>
              ) : null}
              {asked.has('debtMaturities') || details.debtMaturities ? (
                <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
                  <Field label="Dettes à plus d'un an" htmlFor="annexe-debts-1" hint="Emprunts et autres dettes dont l'échéance dépasse un an (PCG art. 832-15).">
                    <AmountInput id="annexe-debts-1" value={details.debtMaturities?.overOneYearCents ?? null} onValueChange={(v) => set('debtMaturities', v === null ? null : { overOneYearCents: v, overFiveYearsCents: details.debtMaturities?.overFiveYearsCents ?? 0 })} />
                  </Field>
                  <Field label="Dont à plus de cinq ans" htmlFor="annexe-debts-5">
                    <AmountInput id="annexe-debts-5" value={details.debtMaturities?.overFiveYearsCents ?? null} onValueChange={(v) => set('debtMaturities', { overOneYearCents: details.debtMaturities?.overOneYearCents ?? 0, overFiveYearsCents: v ?? 0 })} />
                  </Field>
                </div>
              ) : null}
            </div>
          ) : null}

          {asked.has('consolidatingEntity') || details.consolidatingEntity ? (
            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-medium sm:col-span-2">Société qui consolide les comptes (PCG art. 831-4)</legend>
              <Field label="Nom" htmlFor="annexe-consolidating-name">
                <Input id="annexe-consolidating-name" maxLength={200} value={details.consolidatingEntity?.name ?? ''} onChange={(e) => set('consolidatingEntity', { name: e.target.value, seat: details.consolidatingEntity?.seat ?? '', siren: details.consolidatingEntity?.siren ?? null, copiesAt: details.consolidatingEntity?.copiesAt ?? null })} />
              </Field>
              <Field label="Siège" htmlFor="annexe-consolidating-seat">
                <Input id="annexe-consolidating-seat" maxLength={300} value={details.consolidatingEntity?.seat ?? ''} onChange={(e) => set('consolidatingEntity', { name: details.consolidatingEntity?.name ?? '', seat: e.target.value, siren: details.consolidatingEntity?.siren ?? null, copiesAt: details.consolidatingEntity?.copiesAt ?? null })} />
              </Field>
              <Field label="SIREN" htmlFor="annexe-consolidating-siren" optional>
                <Input id="annexe-consolidating-siren" inputMode="numeric" autoComplete="off" maxLength={9} value={details.consolidatingEntity?.siren ?? ''} onChange={(e) => set('consolidatingEntity', { name: details.consolidatingEntity?.name ?? '', seat: details.consolidatingEntity?.seat ?? '', siren: e.target.value || null, copiesAt: details.consolidatingEntity?.copiesAt ?? null })} />
              </Field>
            </fieldset>
          ) : null}

          {asked.has('externalParticipations') || (details.externalParticipations?.length ?? 0) > 0 ? (
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Sociétés détenues hors Kledg (titres 261, PCG art. 832-5)</legend>
              {(details.externalParticipations ?? []).map((pRow, i) => {
                const update = (patch: Partial<typeof pRow>) => set('externalParticipations', (details.externalParticipations ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)))
                return (
                  <div key={i} className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
                    <Field label="Société" htmlFor={`participation-name-${i}`}>
                      <Input id={`participation-name-${i}`} maxLength={200} value={pRow.name} onChange={(e) => update({ name: e.target.value })} />
                    </Field>
                    <Field label="Quote-part du capital (%)" htmlFor={`participation-share-${i}`}>
                      <Input id={`participation-share-${i}`} type="number" inputMode="decimal" min={0} max={100} value={pRow.sharePercent} onChange={(e) => update({ sharePercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} />
                    </Field>
                    <Field label="Capital" htmlFor={`participation-capital-${i}`} optional>
                      <AmountInput id={`participation-capital-${i}`} value={pRow.capitalCents} onValueChange={(v) => update({ capitalCents: v })} />
                    </Field>
                    <Field label="Capitaux propres" htmlFor={`participation-equity-${i}`} optional>
                      <AmountInput id={`participation-equity-${i}`} allowNegative value={pRow.equityCents} onValueChange={(v) => update({ equityCents: v })} />
                    </Field>
                    <Field label="Résultat du dernier exercice" htmlFor={`participation-result-${i}`} optional>
                      <AmountInput id={`participation-result-${i}`} allowNegative value={pRow.resultCents} onValueChange={(v) => update({ resultCents: v })} />
                    </Field>
                    <Field label="Dividendes encaissés" htmlFor={`participation-dividends-${i}`} optional>
                      <AmountInput id={`participation-dividends-${i}`} value={pRow.dividendsCents} onValueChange={(v) => update({ dividendsCents: v })} />
                    </Field>
                  </div>
                )
              })}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => set('externalParticipations', [...(details.externalParticipations ?? []), { name: '', siren: null, sharePercent: 0, capitalCents: null, equityCents: null, revenueCents: null, resultCents: null, dividendsCents: null }])}
              >
                <Plus aria-hidden />
                Ajouter une société
              </Button>
            </fieldset>
          ) : null}

          {error ? <p className="text-destructive text-sm" role="alert">{error}</p> : null}
          <div className="flex justify-end">
            <Button type="submit" loading={saving}>
              Enregistrer les informations
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

/**
 * Annexe des comptes annuels of a fiscal year: the notes the size category
 * requires, built from the books, what is still missing, the answers form
 * and the PDF and Markdown downloads.
 */
export function AnnexePage({ companyId }: { companyId: string }) {
  const [fiscalYearId, setFiscalYearId] = React.useState('')
  const url = fiscalYearId ? `/api/annexe?${new URLSearchParams({ companyId, fiscalYearId })}` : null
  const loaded = useJson<AnnexeView>(url, "L'annexe ne s'est pas chargée. Réessayez dans un instant.")
  // The answer of a save, valid until the next load replaces the data it was based on
  const [saved, setSaved] = React.useState<{ base: AnnexeView | null; view: AnnexeView } | null>(null)
  const [exporting, setExporting] = React.useState<'pdf' | 'md' | null>(null)
  const data = saved && saved.base === loaded.data ? saved.view : loaded.data

  const exportAs = async (format: 'pdf' | 'md') => {
    setExporting(format)
    try {
      await downloadFile(`/api/annexe/export?${new URLSearchParams({ companyId, fiscalYearId, format })}`, `Annexe.${format}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setExporting(null)
    }
  }
  const ready = data !== null && data.annexe.missing.length === 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Annexe des comptes"
        description="Les notes que la catégorie de la société exige, établies à partir des écritures, des immobilisations, des provisions et du registre des méthodes ; à compléter de ce que les comptes ne disent pas."
        actions={
          data ? (
            <>
              <Button variant="outline" disabled={!ready} loading={exporting === 'md'} onClick={() => exportAs('md')} title={ready ? undefined : 'Complétez d’abord les informations manquantes'}>
                <Download aria-hidden />
                Markdown
              </Button>
              <Button variant="outline" disabled={!ready} loading={exporting === 'pdf'} onClick={() => exportAs('pdf')} title={ready ? undefined : 'Complétez d’abord les informations manquantes'}>
                <Download aria-hidden />
                PDF
              </Button>
            </>
          ) : null
        }
      />
      <FiscalYearSelector id="annexe-fiscal-year" companyId={companyId} value={fiscalYearId} onValueChange={setFiscalYearId} showLabel={false} showPeriod={false} className="w-48" />

      {loaded.error ? (
        <EmptyState bordered title="L'annexe ne s'est pas chargée" description={loaded.error} action={<Button size="sm" onClick={loaded.reload}>Réessayer</Button>} />
      ) : !data ? (
        <Skeleton className="h-96 w-full rounded-lg" aria-busy />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {data.annexe.categoryLabel}
                {data.annexe.categoryConfirmed ? <StatusBadge tone="success">Confirmée</StatusBadge> : <StatusBadge tone="warning">Proposée</StatusBadge>}
                {ready ? <StatusBadge tone="success">Prête</StatusBadge> : <StatusBadge tone="warning">{data.annexe.missing.length} information{data.annexe.missing.length > 1 ? 's' : ''} manquante{data.annexe.missing.length > 1 ? 's' : ''}</StatusBadge>}
              </CardTitle>
              <CardDescription>
                {data.annexe.listLabel} ({data.annexe.listSource}). La catégorie se confirme sur la page{' '}
                <Link className="text-link underline-offset-4 hover:underline" href={`/${companyId}/approval`}>
                  Approbation des comptes
                </Link>
                ; les méthodes se tiennent dans le{' '}
                <Link className="text-link underline-offset-4 hover:underline" href={`/${companyId}/accounting-methods`}>
                  registre des méthodes
                </Link>
                .
              </CardDescription>
            </CardHeader>
            {data.annexe.missing.length > 0 || data.annexe.warnings.length > 0 ? (
              <CardContent className="space-y-3 text-sm">
                {data.annexe.missing.length > 0 ? (
                  <div>
                    <p className="font-medium">À compléter avant de générer l&apos;annexe</p>
                    <ul className="list-disc space-y-1 pl-5">
                      {data.annexe.missing.map((m) => (
                        <li key={m.id}>
                          {m.label} <span className="text-muted-foreground">({m.source})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {data.annexe.warnings.length > 0 ? (
                  <ul className="text-muted-foreground list-disc space-y-1 pl-5">
                    {data.annexe.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            ) : null}
          </Card>

          <AnswersForm key={`${data.fiscalYear.id}-${data.saved?.updatedAt ?? 'new'}`} view={data} companyId={companyId} onSaved={(view) => setSaved({ base: loaded.data, view })} />

          {data.annexe.notes.map((note, i) => (
            <Card key={note.id}>
              <CardHeader>
                <CardTitle>{data.annexe.list === 'micro' ? note.title : `${i + 1}. ${note.title}`}</CardTitle>
                <CardDescription>{note.source}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {note.blocks.map((block, j) => (
                  <NoteBlock key={j} block={block} />
                ))}
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  )
}
