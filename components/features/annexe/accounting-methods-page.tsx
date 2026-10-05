'use client'

import * as React from 'react'
import Link from 'next/link'
import { BookCheck, FilePlus2, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { AmountInput } from '@/components/ui/amount-input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DateInput } from '@/components/ui/date-input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Amount, DateDisplay, EmptyState, Field, HelpTip, PageHeader, StatusBadge, useConfirm } from '@/components/shared'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { euros, sendJson, useJson } from '@/components/features/year-end/shared'
import {
  CHANGE_KIND_LABELS,
  CHANGE_KINDS,
  CHANGE_SOURCES,
  METHOD_SUGGESTIONS,
  METHOD_TOPIC_LABELS,
  METHOD_TOPICS,
  TREATMENT_LABELS,
  allowedTreatments,
  defaultTreatment,
  type ChangeKind,
  type ChangeTreatment,
  type MethodTopic,
} from '@/lib/annexe/methods/rules'
import type { AccountingChangeView, AccountingMethodView } from '@/lib/annexe/methods/manage-accounting-methods.service'

interface Register {
  methods: AccountingMethodView[]
  changes: AccountingChangeView[]
}

function MethodDialog({ companyId, method, open, onOpenChange, onSaved }: { companyId: string; method: AccountingMethodView | null; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [topic, setTopic] = React.useState<MethodTopic>((method?.topic as MethodTopic) ?? 'depreciation')
  const [label, setLabel] = React.useState(method?.label ?? '')
  const [description, setDescription] = React.useState(method?.description ?? '')
  const [adoptedOn, setAdoptedOn] = React.useState(method?.adoptedOn ?? '')
  const [referenceMethod, setReferenceMethod] = React.useState(method?.referenceMethod ?? false)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const suggestions = METHOD_SUGGESTIONS[topic] ?? []

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!label.trim() || !description.trim()) {
      setError("Indiquez la méthode retenue et comment elle s'applique.")
      return
    }
    setSaving(true)
    setError(null)
    const body = { topic, label: label.trim(), description: description.trim(), adoptedOn: adoptedOn || null, referenceMethod }
    try {
      if (method) await sendJson(`/api/accounting-methods/${method.id}`, 'PATCH', body, "La méthode n'a pas été enregistrée. Réessayez dans un instant.")
      else await sendJson('/api/accounting-methods', 'POST', { companyId, ...body }, "La méthode n'a pas été enregistrée. Réessayez dans un instant.")
      toast.success('Méthode enregistrée')
      onSaved()
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{method ? 'Modifier la méthode' : 'Nouvelle méthode comptable'}</DialogTitle>
          <DialogDescription>Une méthode retenue quand le plan comptable laisse un choix ; elle figure dans les règles et méthodes de l&apos;annexe.</DialogDescription>
        </DialogHeader>
        <form id="method-form" onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Sujet" htmlFor="method-topic" required>
            <Select value={topic} onValueChange={(v) => setTopic(v as MethodTopic)}>
              <SelectTrigger id="method-topic" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHOD_TOPICS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {METHOD_TOPIC_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Méthode retenue" htmlFor="method-label" required hint={suggestions.length > 0 ? `Usuelles : ${suggestions.join(' ; ')}.` : undefined}>
            <Input id="method-label" autoComplete="off" maxLength={200} placeholder="ex. Coût moyen unitaire pondéré" value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label="Application" htmlFor="method-description" required hint="Comment la méthode s'applique, tel que l'annexe le dira.">
            <Textarea id="method-description" rows={3} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Adoptée le" htmlFor="method-adopted" optional>
              <DateInput id="method-adopted" value={adoptedOn} onValueChange={setAdoptedOn} />
            </Field>
            <Field
              label="Méthode de référence"
              htmlFor="method-reference"
              help={<HelpTip term="Méthode de référence">Méthode que le plan comptable considère comme la meilleure information (retraites provisionnées, frais de développement à l&apos;actif...). Son adoption est irréversible (PCG art. 121-5).</HelpTip>}
            >
              <Switch id="method-reference" checked={referenceMethod} onCheckedChange={setReferenceMethod} disabled={method?.referenceMethod === true} />
            </Field>
          </div>
          {error ? <p className="text-destructive text-sm" role="alert">{error}</p> : null}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button type="submit" form="method-form" loading={saving}>
            {method ? 'Enregistrer' : 'Ajouter la méthode'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ChangeDialog({
  companyId,
  fiscalYearId,
  methods,
  change,
  open,
  onOpenChange,
  onSaved,
}: {
  companyId: string
  fiscalYearId: string
  methods: AccountingMethodView[]
  change: AccountingChangeView | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [kind, setKind] = React.useState<ChangeKind>(change?.kind ?? 'METHOD_CHANGE')
  const [treatment, setTreatment] = React.useState<ChangeTreatment>(change?.treatment ?? defaultTreatment('METHOD_CHANGE'))
  const [methodId, setMethodId] = React.useState(change?.method?.id ?? '')
  const [label, setLabel] = React.useState(change?.label ?? '')
  const [description, setDescription] = React.useState(change?.description ?? '')
  const [impactCents, setImpactCents] = React.useState<number | null>(change ? change.impactCents || null : null)
  const [taxCents, setTaxCents] = React.useState<number | null>(change ? change.taxEffectCents || null : null)
  const [accountCode, setAccountCode] = React.useState(change?.accountCode ?? '')
  const [entryDate, setEntryDate] = React.useState(change?.entryDate ?? '')
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const prospective = treatment === 'PROSPECTIVE'

  const chooseKind = (next: ChangeKind) => {
    setKind(next)
    if (!allowedTreatments(next).includes(treatment)) setTreatment(defaultTreatment(next))
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!label.trim() || !description.trim()) {
      setError('Indiquez le libellé, la nature et la justification.')
      return
    }
    setSaving(true)
    setError(null)
    const body = {
      fiscalYearId: change?.fiscalYearId ?? fiscalYearId,
      kind,
      treatment,
      methodId: methodId || null,
      label: label.trim(),
      description: description.trim(),
      impactCents: prospective ? 0 : (impactCents ?? 0),
      taxEffectCents: prospective || treatment !== 'EQUITY' ? 0 : (taxCents ?? 0),
      accountCode: prospective ? null : accountCode.trim() || null,
      entryDate: prospective ? null : entryDate || null,
    }
    try {
      if (change) await sendJson(`/api/accounting-changes/${change.id}`, 'PATCH', body, "Le changement n'a pas été enregistré. Réessayez dans un instant.")
      else await sendJson('/api/accounting-changes', 'POST', { companyId, ...body }, "Le changement n'a pas été enregistré. Réessayez dans un instant.")
      toast.success('Changement enregistré')
      onSaved()
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{change ? 'Modifier le changement' : 'Nouveau changement ou correction'}</DialogTitle>
          <DialogDescription>Mentionné et justifié dans l&apos;annexe (PCG art. 831-2) ; l&apos;écriture de rattrapage est préparée en brouillon.</DialogDescription>
        </DialogHeader>
        <form id="change-form" onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="change-kind" required hint={CHANGE_SOURCES[kind]}>
              <Select value={kind} onValueChange={(v) => chooseKind(v as ChangeKind)}>
                <SelectTrigger id="change-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANGE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {CHANGE_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="Traitement"
              htmlFor="change-treatment"
              required
              help={
                <HelpTip term="Traitement">
                  Changement de méthode&nbsp;: impact calculé à l&apos;ouverture, après impôt, en report à nouveau, sauf règle fiscale qui l&apos;impose en résultat ; prospectif s&apos;il ne peut être calculé objectivement (PCG art. 122-3). Changement d&apos;estimation&nbsp;: toujours prospectif (art. 122-5). Correction d&apos;erreur&nbsp;: en résultat exceptionnel, ou en report à nouveau si elle corrige une écriture imputée sur les capitaux propres (art. 122-6).
                </HelpTip>
              }
            >
              <Select value={treatment} onValueChange={(v) => setTreatment(v as ChangeTreatment)}>
                <SelectTrigger id="change-treatment" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allowedTreatments(kind).map((t) => (
                    <SelectItem key={t} value={t}>
                      {TREATMENT_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Libellé" htmlFor="change-label" required>
            <Input id="change-label" autoComplete="off" maxLength={200} placeholder="ex. Stocks évalués au coût moyen pondéré" value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label="Nature et justification" htmlFor="change-description" required hint="Pourquoi la nouvelle méthode donne une meilleure information, ou la nature de l'erreur corrigée.">
            <Textarea id="change-description" rows={3} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          {methods.length > 0 ? (
            <Field label="Méthode concernée" htmlFor="change-method" optional>
              <Select value={methodId || 'none'} onValueChange={(v) => setMethodId(v === 'none' ? '' : v)}>
                <SelectTrigger id="change-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucune</SelectItem>
                  {methods.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {METHOD_TOPIC_LABELS[m.topic as MethodTopic] ?? m.topic}, {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          {prospective ? null : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Impact avant impôt" htmlFor="change-impact" required hint="Positif s'il augmente les capitaux propres ou le résultat.">
                  <AmountInput id="change-impact" value={impactCents} onValueChange={setImpactCents} allowNegative />
                </Field>
                {treatment === 'EQUITY' ? (
                  <Field label="Effet d'impôt" htmlFor="change-tax" optional hint="L'impact imputé en report à nouveau est net d'impôt (compte 444).">
                    <AmountInput id="change-tax" value={taxCents} onValueChange={setTaxCents} />
                  </Field>
                ) : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Compte de bilan ajusté" htmlFor="change-account" required hint="ex. 31 stocks, 151 provisions, 2183 matériel.">
                  <Input id="change-account" inputMode="numeric" autoComplete="off" maxLength={10} className="font-mono" value={accountCode} onChange={(e) => setAccountCode(e.target.value)} />
                </Field>
                <Field label="Date de l'écriture" htmlFor="change-date" optional hint={treatment === 'EQUITY' ? "Par défaut, l'ouverture de l'exercice." : "Par défaut, la clôture de l'exercice."}>
                  <DateInput id="change-date" value={entryDate} onValueChange={setEntryDate} />
                </Field>
              </div>
            </>
          )}
          {error ? <p className="text-destructive text-sm" role="alert">{error}</p> : null}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button type="submit" form="change-form" loading={saving}>
            {change ? 'Enregistrer' : 'Ajouter le changement'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const ENTRY_TONES = { draft: 'info', validated: 'success' } as const

/**
 * Register of accounting methods, and changes of method, regulation or
 * estimate and corrections of errors of a fiscal year with their catch-up
 * entries (drafts). Feeds the annexe (PCG art. 831-1 and 831-2).
 */
export function AccountingMethodsPage({ companyId }: { companyId: string }) {
  const [fiscalYearId, setFiscalYearId] = React.useState('')
  const url = fiscalYearId ? `/api/accounting-methods?${new URLSearchParams({ companyId, fiscalYearId })}` : null
  const { data, error, reload } = useJson<Register>(url, "Le registre des méthodes ne s'est pas chargé. Réessayez dans un instant.")
  const [methodDialog, setMethodDialog] = React.useState<{ method: AccountingMethodView | null } | null>(null)
  const [changeDialog, setChangeDialog] = React.useState<{ change: AccountingChangeView | null } | null>(null)
  const [preparing, setPreparing] = React.useState<string | null>(null)
  const { confirm, dialog } = useConfirm()

  const removeMethod = async (m: AccountingMethodView) => {
    if (!(await confirm({ title: `Retirer la méthode « ${m.label} » ?`, description: 'Elle disparaît du registre et de l’annexe. Les changements qui la citent restent.', confirmLabel: 'Retirer', tone: 'destructive' }))) return
    try {
      await sendJson(`/api/accounting-methods/${m.id}`, 'DELETE', undefined, "La suppression n'a pas abouti. Réessayez dans un instant.")
      toast.success('Méthode retirée')
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const removeChange = async (c: AccountingChangeView) => {
    if (!(await confirm({ title: `Supprimer « ${c.label} » ?`, description: 'Son écriture en brouillon est supprimée avec lui. Une écriture validée se contre-passe d’abord.', confirmLabel: 'Supprimer', tone: 'destructive' }))) return
    try {
      await sendJson(`/api/accounting-changes/${c.id}`, 'DELETE', undefined, "La suppression n'a pas abouti. Réessayez dans un instant.")
      toast.success('Changement supprimé')
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const prepare = async (c: AccountingChangeView) => {
    setPreparing(c.id)
    try {
      await sendJson(`/api/accounting-changes/${c.id}/entry`, 'POST', undefined, "L'écriture n'a pas été préparée. Réessayez dans un instant.")
      toast.success('Écriture préparée en brouillon')
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setPreparing(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Méthodes comptables"
        description="Les méthodes que la société retient quand le plan comptable laisse un choix, et les changements de méthode, d'estimation et corrections d'erreurs de l'exercice, repris dans l'annexe."
        actions={
          <Button variant="outline" asChild>
            <Link href={`/${companyId}/reports/annexe`}>Voir l&apos;annexe</Link>
          </Button>
        }
      />
      <FiscalYearSelector id="methods-fiscal-year" companyId={companyId} value={fiscalYearId} onValueChange={setFiscalYearId} showLabel={false} showPeriod={false} className="w-48" />

      {error ? (
        <EmptyState bordered title="Le registre ne s'est pas chargé" description={error} action={<Button size="sm" onClick={reload}>Réessayer</Button>} />
      ) : !data ? (
        <Skeleton className="h-64 w-full rounded-lg" aria-busy />
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div className="space-y-1.5">
                <CardTitle>Registre des méthodes</CardTitle>
                <CardDescription>Liste des principales méthodes retenues (PCG art. 831-1, 3°), appliquées de façon permanente (art. 121-5).</CardDescription>
              </div>
              <Button size="sm" onClick={() => setMethodDialog({ method: null })}>
                <Plus aria-hidden />
                Ajouter
              </Button>
            </CardHeader>
            <CardContent>
              {data.methods.length === 0 ? (
                <EmptyState
                  icon={BookCheck}
                  title="Aucune méthode enregistrée"
                  description="Ajoutez au moins le mode d'amortissement des immobilisations et l'évaluation des stocks si la société en a : l'annexe les demande."
                />
              ) : (
                <ul className="divide-y rounded-md border">
                  {data.methods.map((m) => (
                    <li key={m.id} className="flex items-start justify-between gap-3 px-3 py-3">
                      <div className="min-w-0 space-y-1">
                        <p className="text-muted-foreground text-xs">{METHOD_TOPIC_LABELS[m.topic as MethodTopic] ?? m.topic}</p>
                        <p className="text-sm font-medium">
                          {m.label} {m.referenceMethod ? <StatusBadge tone="info">Méthode de référence</StatusBadge> : null}
                        </p>
                        <p className="text-muted-foreground text-sm">{m.description}</p>
                        {m.adoptedOn ? (
                          <p className="text-muted-foreground text-xs">
                            Adoptée le <DateDisplay value={m.adoptedOn} />
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="icon-sm" aria-label={`Modifier ${m.label}`} title="Modifier" onClick={() => setMethodDialog({ method: m })}>
                          <Pencil aria-hidden />
                        </Button>
                        <Button variant="ghost" size="icon-sm" className="hover:text-destructive" aria-label={`Retirer ${m.label}`} title="Retirer" onClick={() => removeMethod(m)}>
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div className="space-y-1.5">
                <CardTitle>Changements et corrections de l&apos;exercice</CardTitle>
                <CardDescription>Changements de réglementation ou de méthode, changements d&apos;estimation et corrections d&apos;erreurs (PCG art. 122-1 à 122-6).</CardDescription>
              </div>
              <Button size="sm" onClick={() => setChangeDialog({ change: null })}>
                <Plus aria-hidden />
                Ajouter
              </Button>
            </CardHeader>
            <CardContent>
              {data.changes.length === 0 ? (
                <EmptyState icon={FilePlus2} title="Aucun changement pour cet exercice" description="L'annexe dira qu'aucun changement de méthode, d'estimation ni correction d'erreur n'a été enregistré." />
              ) : (
                <ul className="divide-y rounded-md border">
                  {data.changes.map((c) => (
                    <li key={c.id} className="space-y-2 px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <p className="text-muted-foreground text-xs">
                            {CHANGE_KIND_LABELS[c.kind]}, {TREATMENT_LABELS[c.treatment].toLowerCase()}
                          </p>
                          <p className="text-sm font-medium">{c.label}</p>
                          <p className="text-muted-foreground text-sm">{c.description}</p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button variant="ghost" size="icon-sm" aria-label={`Modifier ${c.label}`} title="Modifier" onClick={() => setChangeDialog({ change: c })}>
                            <Pencil aria-hidden />
                          </Button>
                          <Button variant="ghost" size="icon-sm" className="hover:text-destructive" aria-label={`Supprimer ${c.label}`} title="Supprimer" onClick={() => removeChange(c)}>
                            <Trash2 aria-hidden />
                          </Button>
                        </div>
                      </div>
                      {c.treatment !== 'PROSPECTIVE' ? (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                          <span>
                            Impact après impôt&nbsp;: <Amount value={euros(c.netImpactCents)} tone="signed" />
                          </span>
                          {c.accountCode ? <span className="font-mono text-xs">{c.accountCode}</span> : null}
                          {c.entry ? (
                            <StatusBadge tone={ENTRY_TONES[c.entry.status as 'draft' | 'validated'] ?? 'neutral'}>
                              {c.entry.status === 'validated' ? `Écriture ${c.entry.entryNumber} validée` : 'Écriture en brouillon'}
                            </StatusBadge>
                          ) : c.entryExpected ? (
                            <StatusBadge tone="warning">Écriture à préparer</StatusBadge>
                          ) : null}
                          {c.entryExpected && c.entry?.status !== 'validated' ? (
                            <Button size="xs" variant="outline" loading={preparing === c.id} onClick={() => prepare(c)}>
                              {c.entry ? "Préparer à nouveau l'écriture" : "Préparer l'écriture"}
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
      {methodDialog ? <MethodDialog key={methodDialog.method?.id ?? 'new'} companyId={companyId} method={methodDialog.method} open onOpenChange={(o) => !o && setMethodDialog(null)} onSaved={reload} /> : null}
      {changeDialog && data ? (
        <ChangeDialog
          key={changeDialog.change?.id ?? 'new'}
          companyId={companyId}
          fiscalYearId={fiscalYearId}
          methods={data.methods}
          change={changeDialog.change}
          open
          onOpenChange={(o) => !o && setChangeDialog(null)}
          onSaved={reload}
        />
      ) : null}
      {dialog}
    </div>
  )
}
