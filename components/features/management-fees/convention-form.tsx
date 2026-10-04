'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { AmountInput } from '@/components/ui/amount-input'
import { DateInput } from '@/components/ui/date-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState, Field, HelpTip } from '@/components/shared'
import { COMMON_VAT_RATES_BP, formatVatRate } from '@/lib/invoices/amounts'
import {
  ALLOCATION_KEY_LABELS,
  DEFAULT_COST_PREFIXES,
  DEFAULT_EXCLUDED_PREFIXES,
  DEFAULT_EXPENSE_ACCOUNT,
  DEFAULT_INVOICE_PREFIX,
  DEFAULT_REVENUE_ACCOUNT,
  PRICING_LABELS,
  USUAL_MARKUP_RANGE_BP,
  formatRateBp,
  parsePercentBp,
  percentInput,
  type ManagementFeeAllocationKey,
  type ManagementFeePricing,
} from '@/lib/management-fees/rules'
import { request, type ConventionView, type SubsidiaryCandidate } from './api'

interface PartyForm {
  subsidiaryId: string
  name: string
  share: string
  startDate: string
  endDate: string
}

interface FormState {
  label: string
  startDate: string
  endDate: string
  pricing: ManagementFeePricing
  markup: string
  costShare: string
  costPrefixes: string
  excludedPrefixes: string
  fixedAmountCents: number | null
  allocationKey: ManagementFeeAllocationKey
  vatRateBp: string
  revenueAccountCode: string
  expenseAccountCode: string
  invoicePrefix: string
  notes: string
  parties: PartyForm[]
}

const prefixesOf = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean)

function initialState(convention?: ConventionView): FormState {
  if (!convention) {
    return {
      label: 'Convention de prestations de services',
      startDate: '',
      endDate: '',
      pricing: 'COST_PLUS',
      markup: '5',
      costShare: '100',
      costPrefixes: DEFAULT_COST_PREFIXES.join(', '),
      excludedPrefixes: DEFAULT_EXCLUDED_PREFIXES.map((e) => e.prefix).join(', '),
      fixedAmountCents: null,
      allocationKey: 'EQUAL',
      vatRateBp: '2000',
      revenueAccountCode: DEFAULT_REVENUE_ACCOUNT,
      expenseAccountCode: DEFAULT_EXPENSE_ACCOUNT,
      invoicePrefix: DEFAULT_INVOICE_PREFIX,
      notes: '',
      parties: [],
    }
  }
  return {
    label: convention.label,
    startDate: convention.startDate,
    endDate: convention.endDate ?? '',
    pricing: convention.pricing,
    markup: percentInput(convention.markupBp),
    costShare: percentInput(convention.costShareBp),
    costPrefixes: convention.costAccountPrefixes.join(', '),
    excludedPrefixes: convention.excludedAccountPrefixes.join(', '),
    fixedAmountCents: convention.fixedAmountCents,
    allocationKey: convention.allocationKey,
    vatRateBp: String(convention.vatRateBp),
    revenueAccountCode: convention.revenueAccountCode,
    expenseAccountCode: convention.expenseAccountCode,
    invoicePrefix: convention.invoicePrefix,
    notes: convention.notes ?? '',
    parties: convention.subsidiaries.map((s) => ({
      subsidiaryId: s.subsidiaryId,
      name: s.name ?? 'Société non accessible',
      share: s.sharePercentBp === null ? '' : percentInput(s.sharePercentBp),
      startDate: s.startDate ?? '',
      endDate: s.endDate ?? '',
    })),
  }
}

/** Creates or edits a convention of the holding. */
export function ConventionForm({ companyId, convention }: { companyId: string; convention?: ConventionView }) {
  const router = useRouter()
  const [form, setForm] = React.useState<FormState>(() => initialState(convention))
  const [candidates, setCandidates] = React.useState<SubsidiaryCandidate[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))

  React.useEffect(() => {
    let cancelled = false
    request<{ subsidiaries: SubsidiaryCandidate[] }>(`/api/management-fees/subsidiaries?companyId=${encodeURIComponent(companyId)}`)
      .then((data) => !cancelled && setCandidates(data.subsidiaries))
      .catch((e: Error) => !cancelled && setLoadError(e.message))
    return () => {
      cancelled = true
    }
  }, [companyId])

  const markupBp = parsePercentBp(form.markup)
  const costShareBp = parsePercentBp(form.costShare)
  const shares = form.parties.map((p) => parsePercentBp(p.share))
  const sharesTotal = shares.reduce<number>((sum, s) => sum + (s ?? 0), 0)

  const toggleParty = (candidate: SubsidiaryCandidate, checked: boolean) =>
    setForm((f) => ({
      ...f,
      parties: checked
        ? [...f.parties, { subsidiaryId: candidate.id, name: candidate.name, share: '', startDate: '', endDate: '' }]
        : f.parties.filter((p) => p.subsidiaryId !== candidate.id),
    }))
  const setParty = (id: string, patch: Partial<PartyForm>) =>
    setForm((f) => ({ ...f, parties: f.parties.map((p) => (p.subsidiaryId === id ? { ...p, ...patch } : p)) }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (form.pricing === 'COST_PLUS' && (markupBp === null || costShareBp === null || costShareBp === 0)) {
      setError('La marge et la part des charges refacturables sont des pourcentages entre 0 et 100 (ex. 5 ou 7,5).')
      return
    }
    if (form.allocationKey === 'CUSTOM' && shares.some((s) => s === null)) {
      setError('Indiquez le pourcentage de chaque filiale (ex. 40 ou 33,34).')
      return
    }
    const body = {
      label: form.label,
      pricing: form.pricing,
      markupBp: markupBp ?? 0,
      costShareBp: costShareBp ?? 10000,
      costAccountPrefixes: prefixesOf(form.costPrefixes),
      excludedAccountPrefixes: prefixesOf(form.excludedPrefixes),
      fixedAmountCents: form.pricing === 'FIXED' ? form.fixedAmountCents : null,
      allocationKey: form.allocationKey,
      vatRateBp: Number(form.vatRateBp),
      revenueAccountCode: form.revenueAccountCode.trim(),
      expenseAccountCode: form.expenseAccountCode.trim(),
      invoicePrefix: form.invoicePrefix,
      startDate: form.startDate,
      endDate: form.endDate || null,
      notes: form.notes || null,
      subsidiaries: form.parties.map((p, i) => ({
        subsidiaryId: p.subsidiaryId,
        sharePercentBp: form.allocationKey === 'CUSTOM' ? shares[i] : null,
        startDate: p.startDate || null,
        endDate: p.endDate || null,
      })),
    }
    setSaving(true)
    try {
      const saved = convention
        ? await request<ConventionView>(`/api/management-fees/conventions/${convention.id}`, { method: 'PATCH', body })
        : await request<ConventionView>('/api/management-fees/conventions', { method: 'POST', body: { companyId, ...body } })
      toast.success(convention ? 'Convention enregistrée' : 'Convention créée')
      router.push(`/${companyId}/management-fees/${saved.id}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <Card>
        <CardContent role="alert" className="text-sm">
          {loadError}
        </CardContent>
      </Card>
    )
  }
  if (candidates === null) {
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  const parties = new Map(form.parties.map((p) => [p.subsidiaryId, p]))
  const outsiders = form.parties.filter((p) => !candidates.some((c) => c.id === p.subsidiaryId))
  if (candidates.length === 0 && outsiders.length === 0) {
    return (
      <EmptyState
        bordered
        title="Aucune filiale pour cette holding"
        description="Une filiale est une société qui enregistre la holding parmi ses actionnaires. Ouvrez la filiale, page Informations, ajoutez la holding comme actionnaire, puis revenez ici."
      />
    )
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Convention</CardTitle>
          <CardDescription>Le contrat qui fixe les services rendus par la holding à ses filiales et leur prix. Gardez la convention signée avec la documentation de vos prix.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom" htmlFor="mf-label" required className="sm:col-span-2">
            <Input id="mf-label" value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="ex. Convention d’animation 2026" />
          </Field>
          <Field label="Date de début" htmlFor="mf-start" required>
            <DateInput id="mf-start" value={form.startDate} onValueChange={(v) => set('startDate', v)} />
          </Field>
          <Field label="Date de fin" htmlFor="mf-end" optional hint="Vide&nbsp;: sans terme.">
            <DateInput id="mf-end" value={form.endDate} onValueChange={(v) => set('endDate', v)} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Prix</CardTitle>
          <CardDescription>
            Les services entre sociétés d’un groupe se facturent à leur prix de pleine concurrence. La méthode usuelle&nbsp;: les charges engagées pour rendre les services, majorées d’une marge.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Méthode" htmlFor="mf-pricing" className="sm:col-span-2">
            <Select value={form.pricing} onValueChange={(v) => set('pricing', v as ManagementFeePricing)}>
              <SelectTrigger id="mf-pricing" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PRICING_LABELS) as ManagementFeePricing[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRICING_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {form.pricing === 'COST_PLUS' ? (
            <>
              <Field
                label={
                  <span className="inline-flex items-center gap-1">
                    Marge (%)
                    <HelpTip term="Marge">
                      Le pourcentage ajouté aux charges refacturées. L’OCDE admet 5&nbsp;% pour les services à faible valeur ajoutée&nbsp;; les services de gestion sont usuellement refacturés entre 5 et 10&nbsp;%.
                    </HelpTip>
                  </span>
                }
                htmlFor="mf-markup"
                hint={
                  markupBp !== null && (markupBp < USUAL_MARKUP_RANGE_BP.min || markupBp > USUAL_MARKUP_RANGE_BP.max)
                    ? `Hors de la fourchette usuelle (5 à 10 %) : documentez ce taux.`
                    : undefined
                }
              >
                <Input id="mf-markup" inputMode="decimal" value={form.markup} onChange={(e) => set('markup', e.target.value)} placeholder="ex. 5" />
              </Field>
              <Field
                label={
                  <span className="inline-flex items-center gap-1">
                    Part des charges refacturables (%)
                    <HelpTip term="Part des charges refacturables">
                      Les charges de la holding liées à son rôle d’actionnaire (sa propre gestion, son financement) ne se refacturent pas. Indiquez la part consacrée aux services rendus aux filiales.
                    </HelpTip>
                  </span>
                }
                htmlFor="mf-share"
              >
                <Input id="mf-share" inputMode="decimal" value={form.costShare} onChange={(e) => set('costShare', e.target.value)} placeholder="ex. 80" />
              </Field>
              <Field label="Comptes de charges retenus" htmlFor="mf-prefixes" hint="Préfixes séparés par des virgules (6&nbsp;: toute la classe 6).">
                <Input id="mf-prefixes" className="font-mono" value={form.costPrefixes} onChange={(e) => set('costPrefixes', e.target.value)} placeholder="ex. 6" />
              </Field>
              <Field
                label="Comptes exclus"
                htmlFor="mf-excluded"
                hint={`Par défaut : ${DEFAULT_EXCLUDED_PREFIXES.map((e) => e.prefix).join(', ')} (impôt sur les bénéfices, pénalités, charges financières et exceptionnelles, cessions).`}
              >
                <Input id="mf-excluded" className="font-mono" value={form.excludedPrefixes} onChange={(e) => set('excludedPrefixes', e.target.value)} placeholder="ex. 66, 67, 695" />
              </Field>
            </>
          ) : (
            <Field label="Montant forfaitaire HT par période" htmlFor="mf-fixed" required hint="Réparti entre les filiales selon la clé ci-dessous.">
              <AmountInput id="mf-fixed" value={form.fixedAmountCents} onValueChange={(v) => set('fixedAmountCents', v)} placeholder="ex. 12 000,00" />
            </Field>
          )}
          <Field label="Taux de TVA" htmlFor="mf-vat">
            <Select value={form.vatRateBp} onValueChange={(v) => set('vatRateBp', v)}>
              <SelectTrigger id="mf-vat" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMON_VAT_RATES_BP.map((rate) => (
                  <SelectItem key={rate} value={String(rate)}>
                    {formatVatRate(rate)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Filiales et répartition</CardTitle>
          <CardDescription>Les filiales parties à la convention et la clé qui partage le montant entre elles. Une filiale entrée ou sortie en cours de période paie au prorata de ses jours.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Clé de répartition" htmlFor="mf-key">
            <Select value={form.allocationKey} onValueChange={(v) => set('allocationKey', v as ManagementFeeAllocationKey)}>
              <SelectTrigger id="mf-key" className="w-full sm:w-80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ALLOCATION_KEY_LABELS) as ManagementFeeAllocationKey[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {ALLOCATION_KEY_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <ul className="divide-y rounded-md border">
            {[...candidates.map((c) => ({ id: c.id, name: c.name, detail: `SIREN ${c.siren}, détenue à ${c.sharePercentage.replace('.', ',')} %`, candidate: c })), ...outsiders.map((p) => ({ id: p.subsidiaryId, name: p.name, detail: 'N’est plus une filiale accessible', candidate: null }))].map((row) => {
              const party = parties.get(row.id)
              return (
                <li key={row.id} className="space-y-3 px-3 py-3">
                  <label className="flex items-start gap-3 text-sm">
                    <Checkbox
                      checked={party !== undefined}
                      onCheckedChange={(checked) => (row.candidate ? toggleParty(row.candidate, checked === true) : setForm((f) => ({ ...f, parties: f.parties.filter((p) => p.subsidiaryId !== row.id) })))}
                      aria-label={`Inclure ${row.name}`}
                    />
                    <span className="min-w-0">
                      {row.name}
                      <span className="text-muted-foreground block text-xs">{row.detail}</span>
                    </span>
                  </label>
                  {party ? (
                    <div className="grid gap-3 pl-7 sm:grid-cols-3">
                      {form.allocationKey === 'CUSTOM' ? (
                        <Field label="Part (%)" htmlFor={`mf-share-${row.id}`} required>
                          <Input id={`mf-share-${row.id}`} inputMode="decimal" value={party.share} onChange={(e) => setParty(row.id, { share: e.target.value })} placeholder="ex. 40" />
                        </Field>
                      ) : null}
                      <Field label="Entrée dans la convention" htmlFor={`mf-in-${row.id}`} optional>
                        <DateInput id={`mf-in-${row.id}`} value={party.startDate} onValueChange={(v) => setParty(row.id, { startDate: v })} />
                      </Field>
                      <Field label="Sortie" htmlFor={`mf-out-${row.id}`} optional>
                        <DateInput id={`mf-out-${row.id}`} value={party.endDate} onValueChange={(v) => setParty(row.id, { endDate: v })} />
                      </Field>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
          {form.allocationKey === 'CUSTOM' && form.parties.length > 0 ? (
            <p className={sharesTotal === 10000 ? 'text-muted-foreground text-sm' : 'text-destructive text-sm'} aria-live="polite">
              Total des parts&nbsp;: {formatRateBp(sharesTotal)} (100&nbsp;% attendus)
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Facturation</CardTitle>
          <CardDescription>Les factures de la holding sont numérotées dans leur propre série (ex. FG-2026-001). Le compte de charges est proposé aux filiales.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Compte de produits (holding)" htmlFor="mf-revenue">
            <Input id="mf-revenue" className="font-mono" value={form.revenueAccountCode} onChange={(e) => set('revenueAccountCode', e.target.value)} placeholder="ex. 706" />
          </Field>
          <Field label="Compte de charges (filiales)" htmlFor="mf-expense">
            <Input id="mf-expense" className="font-mono" value={form.expenseAccountCode} onChange={(e) => set('expenseAccountCode', e.target.value)} placeholder="ex. 6226" />
          </Field>
          <Field label="Préfixe des factures" htmlFor="mf-prefix">
            <Input id="mf-prefix" className="font-mono" value={form.invoicePrefix} onChange={(e) => set('invoicePrefix', e.target.value.toUpperCase())} placeholder="ex. FG" />
          </Field>
          <Field label="Notes" htmlFor="mf-notes" optional className="sm:col-span-3">
            <Textarea id="mf-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="ex. Services couverts, références de la convention signée" />
          </Field>
        </CardContent>
      </Card>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={saving} disabled={form.parties.length === 0 || !form.startDate}>
          {convention ? 'Enregistrer la convention' : 'Créer la convention'}
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href={convention ? `/${companyId}/management-fees/${convention.id}` : `/${companyId}/management-fees`}>Annuler</Link>
        </Button>
      </div>
    </form>
  )
}
