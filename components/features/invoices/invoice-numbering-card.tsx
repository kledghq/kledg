'use client'

import * as React from 'react'
import { Save } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Field } from '@/components/shared'
import { AccessNotice, useCompanyAccess } from '@/components/features/companies/company-access'
import { responseError } from '@/hooks/use-cursor-list'
import {
  formatOf,
  numberingProblems,
  parseSequence,
  patternOf,
  renderNumber,
  type InvoiceNumberingSettings,
  type Reset,
  type Separator,
  type YearFormat,
} from '@/lib/invoices/numbering/format'

export interface InvoiceNumberingView {
  settings: InvoiceNumberingSettings
  patterns: { invoice: string; creditNote: string }
  next: { invoice: string | null; creditNote: string | null }
  qonto: { connected: boolean; refusal: string | null; canCreate: boolean; active: boolean }
}

const YEARS: Array<{ value: YearFormat; label: string }> = [
  { value: 'YYYY', label: 'Année sur 4 chiffres (2026)' },
  { value: 'YY', label: 'Année sur 2 chiffres (26)' },
  { value: 'NONE', label: 'Sans année' },
]

const SEPARATORS: Array<{ value: Separator; label: string }> = [
  { value: '-', label: 'Tiret (-)' },
  { value: '/', label: 'Barre oblique (/)' },
  { value: '_', label: 'Tiret bas (_)' },
  { value: '.', label: 'Point (.)' },
  { value: '', label: 'Aucun' },
]

const RESETS: Array<{ value: Reset; label: string }> = [
  { value: 'YEARLY', label: 'Chaque année civile' },
  { value: 'FISCAL_YEAR', label: 'À chaque exercice' },
  { value: 'NEVER', label: 'Jamais (séquence continue)' },
]

const NONE_VALUE = 'none'

/** Sequence of the next number the server announced, for the preview while the format is edited. */
function sequenceOf(view: InvoiceNumberingView, series: 'INVOICE' | 'CREDIT_NOTE', year: number): number {
  const next = series === 'INVOICE' ? view.next.invoice : view.next.creditNote
  if (!next) return 1
  return parseSequence(formatOf(view.settings, series), view.settings.reset === 'NEVER' ? null : year, next) ?? 1
}

/** A positive whole number typed in a field, or undefined. */
const typedNumber = (text: string) => (/^\d{1,9}$/.test(text.trim()) && Number(text) > 0 ? Number(text) : undefined)

/**
 * "Numérotation des factures" card of Informations: the format of the sales
 * invoice numbers (prefix, year, month, separator, digits), when the
 * sequence restarts, the series of credit notes, where the series resumes
 * for a company coming from another tool, and whether sales invoices are
 * created in Qonto first. Live preview of the next number. Saved on its own
 * (PUT /api/companies/[id]/invoice-numbering, administrators).
 */
export function InvoiceNumberingCard({ companyId, today = new Date() }: { companyId: string; today?: Date }) {
  const { can, denied } = useCompanyAccess()
  const mayUpdate = can({ settings: ['update'] })
  const [view, setView] = React.useState<InvoiceNumberingView | null>(null)
  const [draft, setDraft] = React.useState<InvoiceNumberingSettings | null>(null)
  const [nextInvoice, setNextInvoice] = React.useState('')
  const [nextCreditNote, setNextCreditNote] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    fetch(`/api/companies/${companyId}/invoice-numbering`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, 'La numérotation ne s’est pas chargée.'))
        return response.json() as Promise<InvoiceNumberingView>
      })
      .then((data) => {
        if (cancelled) return
        setView(data)
        setDraft(data.settings)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [companyId])

  if (error && !view) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Numérotation des factures</CardTitle>
        </CardHeader>
        <CardContent>
          <p role="alert" className="text-sm">
            {error}
          </p>
        </CardContent>
      </Card>
    )
  }
  if (!view || !draft) return <Skeleton className="h-64 w-full" />

  const set = <K extends keyof InvoiceNumberingSettings>(key: K, value: InvoiceNumberingSettings[K]) => setDraft({ ...draft, [key]: value })
  const problems = numberingProblems(draft)
  const year = today.getFullYear()
  const month = today.getMonth() + 1
  const preview = (series: 'INVOICE' | 'CREDIT_NOTE', typed: string) =>
    renderNumber(formatOf(draft, series), { year, month, sequence: typedNumber(typed) ?? sequenceOf(view, series, year) })
  const ownCreditNotes = draft.creditNotes === 'OWN_SERIES'
  const auto = draft.mode === 'AUTO'

  const save = async () => {
    if (problems.length > 0) return
    setSaving(true)
    try {
      const nextNumbers = {
        ...(typedNumber(nextInvoice) !== undefined ? { invoice: typedNumber(nextInvoice) } : {}),
        ...(ownCreditNotes && typedNumber(nextCreditNote) !== undefined ? { creditNote: typedNumber(nextCreditNote) } : {}),
      }
      const response = await fetch(`/api/companies/${companyId}/invoice-numbering`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: draft, ...(Object.keys(nextNumbers).length > 0 ? { nextNumbers } : {}) }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'La numérotation n’a pas été enregistrée. Réessayez.'))
      const saved = (await response.json()) as InvoiceNumberingView
      setView(saved)
      setDraft(saved.settings)
      setNextInvoice('')
      setNextCreditNote('')
      toast.success('Numérotation enregistrée')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card id="numerotation-factures" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>Numérotation des factures</CardTitle>
        <CardDescription>
          Chaque facture de vente porte un numéro unique, dans une séquence chronologique et continue (CGI, annexe II, art. 242 nonies A). Kledg donne le numéro
          quand la facture est comptabilisée&nbsp;: supprimer un brouillon ne laisse aucun trou. Les factures déjà numérotées gardent leur numéro.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!mayUpdate ? <AccessNotice>{denied('changer la numérotation des factures')}</AccessNotice> : null}
        <fieldset disabled={!mayUpdate || saving} className="min-w-0 space-y-6">
          <div className="flex items-center gap-3">
            <Switch id="numbering-auto" checked={auto} onCheckedChange={(on) => set('mode', on ? 'AUTO' : 'MANUAL')} />
            <Label htmlFor="numbering-auto">Numéroter automatiquement les factures de vente</Label>
          </div>
          {!auto ? (
            <p className="text-muted-foreground text-sm">La société numérote ses factures ailleurs&nbsp;: le numéro se saisit sur chaque facture, et Kledg vérifie qu’il est unique.</p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Préfixe" htmlFor="numbering-prefix" hint="Lettres, chiffres ou - / _ . (20 au plus).">
                  <Input id="numbering-prefix" value={draft.prefix} onChange={(e) => set('prefix', e.target.value)} autoComplete="off" className="font-mono" />
                </Field>
                <Field label="Année" htmlFor="numbering-year">
                  <Select value={draft.year} onValueChange={(value) => setDraft({ ...draft, year: value as YearFormat, ...(value === 'NONE' ? { month: false } : {}) })}>
                    <SelectTrigger id="numbering-year" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {YEARS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Séparateur" htmlFor="numbering-separator">
                  <Select value={draft.separator === '' ? NONE_VALUE : draft.separator} onValueChange={(value) => set('separator', (value === NONE_VALUE ? '' : value) as Separator)}>
                    <SelectTrigger id="numbering-separator" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SEPARATORS.map((o) => (
                        <SelectItem key={o.label} value={o.value === '' ? NONE_VALUE : o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Chiffres de la séquence" htmlFor="numbering-padding" hint="Complétée par des zéros ; au-delà, le numéro s’allonge.">
                  <Input
                    id="numbering-padding"
                    type="number"
                    min={1}
                    max={9}
                    value={draft.padding}
                    onChange={(e) => set('padding', Number(e.target.value))}
                  />
                </Field>
                <Field label="Remise à 1 de la séquence" htmlFor="numbering-reset">
                  <Select value={draft.reset} onValueChange={(value) => set('reset', value as Reset)}>
                    <SelectTrigger id="numbering-reset" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RESETS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={draft.month} disabled={draft.year === 'NONE'} onCheckedChange={(checked) => set('month', checked === true)} />
                    Ajouter le mois (03)
                  </label>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Avoirs" htmlFor="numbering-credit-notes" hint="Une série distincte est admise, avec son propre préfixe (BOI-TVA-DECLA-30-20-20-10).">
                  <Select value={draft.creditNotes} onValueChange={(value) => set('creditNotes', value as InvoiceNumberingSettings['creditNotes'])}>
                    <SelectTrigger id="numbering-credit-notes" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SAME_SERIES">Dans la série des factures</SelectItem>
                      <SelectItem value="OWN_SERIES">Dans leur propre série</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {ownCreditNotes ? (
                  <Field label="Préfixe des avoirs" htmlFor="numbering-credit-prefix">
                    <Input id="numbering-credit-prefix" value={draft.creditNotePrefix} onChange={(e) => set('creditNotePrefix', e.target.value)} autoComplete="off" className="font-mono" />
                  </Field>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field
                  label="Prochain numéro de facture"
                  htmlFor="numbering-next-invoice"
                  optional
                  hint="Vous venez d’un autre outil ? Indiquez où reprend la séquence de la période en cours. Il ne peut que monter."
                >
                  <Input id="numbering-next-invoice" inputMode="numeric" value={nextInvoice} onChange={(e) => setNextInvoice(e.target.value)} placeholder={String(sequenceOf(view, 'INVOICE', year))} />
                </Field>
                {ownCreditNotes ? (
                  <Field label="Prochain numéro d’avoir" htmlFor="numbering-next-credit" optional>
                    <Input id="numbering-next-credit" inputMode="numeric" value={nextCreditNote} onChange={(e) => setNextCreditNote(e.target.value)} placeholder={String(sequenceOf(view, 'CREDIT_NOTE', year))} />
                  </Field>
                ) : null}
              </div>

              <div className="bg-muted/40 rounded-md border px-3 py-2 text-sm" aria-live="polite" data-testid="numbering-preview">
                <p>
                  Format&nbsp;: <span className="font-mono">{patternOf(formatOf(draft, 'INVOICE'))}</span>
                </p>
                <p>
                  Prochaine facture&nbsp;: <span className="font-mono font-medium">{problems.length === 0 ? preview('INVOICE', nextInvoice) : '…'}</span>
                </p>
                {ownCreditNotes ? (
                  <p>
                    Prochain avoir&nbsp;: <span className="font-mono font-medium">{problems.length === 0 ? preview('CREDIT_NOTE', nextCreditNote) : '…'}</span>
                  </p>
                ) : null}
              </div>
            </>
          )}

          {view.qonto.connected ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Switch id="numbering-qonto" checked={draft.qontoFirst ?? true} onCheckedChange={(on) => set('qontoFirst', on)} />
                <Label htmlFor="numbering-qonto">Créer les factures de vente dans Qonto</Label>
              </div>
              <p className="text-muted-foreground text-sm">
                {view.qonto.refusal
                  ? view.qonto.refusal
                  : 'Qonto crée la facture, lui donne son numéro (sa propre série) et son PDF ; Kledg la garde et la comptabilise. Les avoirs et les factures déjà émises restent numérotés dans Kledg.'}
              </p>
            </div>
          ) : null}

          {problems.length > 0 ? (
            <ul role="alert" className="text-destructive list-disc space-y-1 pl-5 text-sm">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex justify-end">
            <Button type="button" onClick={save} loading={saving} disabled={!mayUpdate || problems.length > 0}>
              <Save aria-hidden />
              Enregistrer la numérotation
            </Button>
          </div>
        </fieldset>
      </CardContent>
    </Card>
  )
}
