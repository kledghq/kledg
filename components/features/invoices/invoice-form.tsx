'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DateInput } from '@/components/ui/date-input'
import { Input } from '@/components/ui/input'
import { AmountInput } from '@/components/ui/amount-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Field, HelpTip } from '@/components/shared'
import { responseError } from '@/hooks/use-cursor-list'
import { FRENCH_VAT_RATES_BP, formatVatRate, parseQuantity } from '@/lib/invoices/amounts'
import { localDateToIso } from '@/lib/utils/date'
import { InvoiceTotals } from './invoice-totals'

export type InvoiceDirection = 'SALE' | 'PURCHASE'

/**
 * Value of the VAT select for an exempt training sale: 0 % with the legal
 * basis of CGI art. 261, 4, 4° a (lib/invoices/vat-exemptions.ts), which
 * puts the exemption mention on the invoice.
 */
export const EXEMPT_TRAINING = 'exempt-training'
const rateOf = (value: string) => (value === EXEMPT_TRAINING ? 0 : Number(value))

const lineSchema = z.object({
  label: z.string().trim().min(1, 'La désignation est requise'),
  quantity: z.string().refine((v) => (parseQuantity(v) ?? 0) > 0, 'Quantité positive, trois décimales au plus'),
  unitPriceCents: z.number({ error: 'Prix unitaire requis' }).nullable().refine((v) => v !== null && v >= 0, 'Prix unitaire requis'),
  vatRateBp: z.string(),
  accountCode: z.string().trim().max(20),
  nature: z.enum(['GOODS', 'SERVICES']),
  fixedAsset: z.boolean(),
})

const formSchema = z.object({
  tiersId: z.string().min(1, 'Choisissez le tiers'),
  /** Checked on submit: required only when the number is typed (numberIsTyped). */
  number: z.string().trim().max(60),
  numbering: z.enum(['kledg', 'qonto', 'recorded']),
  /** Created in Qonto: finalized (numbered by Qonto at once) or a draft in Qonto. */
  qontoStatus: z.enum(['finalized', 'draft']).optional(),
  issueDate: z.string().min(1, 'La date est requise'),
  dueDate: z.string(),
  typeCode: z.enum(['380', '381']),
  label: z.string().max(500),
  lines: z.array(lineSchema).min(1, 'Ajoutez au moins une ligne'),
})

/** The same schema when the number is typed: required. */
const typedNumberSchema = formSchema.extend({ number: z.string().trim().min(1, 'Le numéro est requis').max(60) })

export type InvoiceFormValues = z.infer<typeof formSchema>

interface TiersOption {
  id: string
  name: string
  auxiliaryAccountNumber: string
  defaultAccountCode: string | null
  defaultVatRateBp: number | null
}

/** What the form needs of the company's numbering (GET /api/companies/[id]/invoice-numbering). */
export interface NumberingInfo {
  settings: { mode: 'AUTO' | 'MANUAL' }
  next: { invoice: string | null; creditNote: string | null }
  qonto: { connected: boolean; refusal: string | null; active: boolean }
}

/** The number of an invoice being edited: where it comes from and, for Kledg's series, the number given or the one it would get. */
export interface EditedNumber {
  origin: 'AUTO' | 'MANUAL' | 'RECORDED' | 'QONTO' | 'MANAGEMENT_FEES'
  number: string | null
  provisionalNumber: string | null
}

interface InvoiceFormProps {
  companyId: string
  direction: InvoiceDirection
  /** Editing a draft: its id and values. */
  invoiceId?: string
  initial?: InvoiceFormValues
  edited?: EditedNumber
}

/** Whether the number is typed in the form: a purchase, an invoice already issued, a company typing its numbers, or a draft edited with a typed number. */
export function numberIsTyped(sale: boolean, numbering: InvoiceFormValues['numbering'], info: NumberingInfo | null, edited?: EditedNumber): boolean {
  if (!sale) return true
  if (edited) return edited.origin !== 'AUTO' && edited.origin !== 'QONTO'
  if (numbering === 'recorded') return true
  if (numbering === 'qonto') return false
  return info?.settings.mode !== 'AUTO'
}

const emptyLine = (tiers?: TiersOption): InvoiceFormValues['lines'][number] => ({
  label: '',
  quantity: '1',
  unitPriceCents: null,
  vatRateBp: String(tiers?.defaultVatRateBp ?? 2000),
  accountCode: tiers?.defaultAccountCode ?? '',
  nature: 'SERVICES',
  fixedAsset: false,
})

/**
 * Form of a purchase or sales invoice: tiers, number, dates, lines with
 * their VAT rate, live totals computed with the server's rounding rule
 * (InvoiceTotals). A sales invoice is created in Qonto first, numbered by
 * Kledg's series when posted, or recorded with the number it was issued
 * with (the "Émission" choice, default from the company's numbering).
 */
export function InvoiceForm({ companyId, direction, invoiceId, initial, edited }: InvoiceFormProps) {
  const router = useRouter()
  const sale = direction === 'SALE'
  const [tiers, setTiers] = React.useState<TiersOption[] | null>(null)
  const [numbering, setNumbering] = React.useState<NumberingInfo | null>(null)
  // Read by the resolver: whether the number is typed changes with the "Émission" choice.
  const typedRef = React.useRef(true)
  const [submitting, setSubmitting] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<InvoiceFormValues>({
    resolver: (values, context, options) => zodResolver(typedRef.current ? typedNumberSchema : formSchema)(values, context, options),
    defaultValues: initial ?? {
      tiersId: '',
      number: '',
      numbering: 'kledg',
      issueDate: localDateToIso(new Date()),
      dueDate: '',
      typeCode: '380',
      label: '',
      lines: [emptyLine()],
    },
  })
  const { control, register, handleSubmit, formState, setValue } = form
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines = useWatch({ control, name: 'lines' })
  const choice = useWatch({ control, name: 'numbering' })
  const typeCode = useWatch({ control, name: 'typeCode' })
  const qontoStatus = useWatch({ control, name: 'qontoStatus' })

  // A new sales invoice follows the company's numbering: created in Qonto first when it is on.
  React.useEffect(() => {
    if (!sale || invoiceId) return
    let cancelled = false
    fetch(`/api/companies/${companyId}/invoice-numbering`)
      .then((response) => (response.ok ? (response.json() as Promise<NumberingInfo>) : null))
      .then((info) => {
        if (cancelled || !info) return
        setNumbering(info)
        if (info.qonto.active && form.getValues('typeCode') === '380' && !form.formState.dirtyFields.numbering) setValue('numbering', 'qonto')
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [companyId, sale, invoiceId, form, setValue])

  // Qonto does not let Kledg create credit notes: an avoir is numbered by Kledg.
  React.useEffect(() => {
    if (typeCode === '381' && choice === 'qonto') setValue('numbering', 'kledg')
  }, [typeCode, choice, setValue])

  const typed = numberIsTyped(sale, choice, numbering, edited)
  React.useEffect(() => {
    typedRef.current = typed
  }, [typed])
  const nextNumber = edited?.provisionalNumber ?? (typeCode === '381' ? numbering?.next.creditNote : numbering?.next.invoice) ?? null

  React.useEffect(() => {
    let cancelled = false
    fetch(`/api/tiers?${new URLSearchParams({ companyId, kind: sale ? 'CUSTOMER' : 'SUPPLIER', limit: '500' })}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, 'Les tiers ne se sont pas chargés.'))
        return response.json() as Promise<{ tiers: TiersOption[] }>
      })
      .then((result) => {
        if (!cancelled) setTiers(result.tiers)
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setTiers([])
          toast.error(e.message)
        }
      })
    return () => {
      cancelled = true
    }
  }, [companyId, sale])

  // Never lose typed data (docs/design-system.md, Forms)
  React.useEffect(() => {
    if (!formState.isDirty || submitting) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [formState.isDirty, submitting])

  const amountLines = (lines ?? []).map((line) => ({
    quantityThousandths: parseQuantity(line.quantity) ?? 0,
    unitPriceCents: line.unitPriceCents ?? 0,
    vatRateBp: rateOf(line.vatRateBp),
  }))

  const onSubmit = async (values: InvoiceFormValues) => {
    setSubmitting(true)
    setFormError(null)
    try {
      const body = {
        companyId,
        ...(invoiceId ? {} : { direction }),
        ...(invoiceId || !sale ? {} : { numbering: values.numbering }),
        ...(!invoiceId && sale && values.numbering === 'qonto' ? { qontoStatus: values.qontoStatus ?? 'finalized' } : {}),
        tiersId: values.tiersId,
        number: typed ? values.number : (edited?.number ?? null),
        issueDate: values.issueDate,
        dueDate: values.dueDate || null,
        typeCode: values.typeCode,
        label: values.label || null,
        lines: values.lines.map((line) => ({
          label: line.label,
          quantity: line.quantity.replace(',', '.'),
          unitPriceCents: line.unitPriceCents ?? 0,
          vatRateBp: rateOf(line.vatRateBp),
          vatExemption: sale && line.vatRateBp === EXEMPT_TRAINING ? 'training' : null,
          accountCode: line.accountCode || null,
          nature: line.nature,
          fixedAsset: sale ? false : line.fixedAsset,
        })),
      }
      const response = await fetch(invoiceId ? `/api/invoices/${invoiceId}` : '/api/invoices', {
        method: invoiceId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await responseError(response, 'La facture n’a pas été enregistrée. Réessayez.'))
      const saved = (await response.json()) as { id: string; number: string | null; origin: string; qontoDraft?: boolean }
      toast.success(invoiceId ? 'Facture modifiée' : saved.origin === 'QONTO' ? `${saved.qontoDraft ? 'Brouillon créé dans Qonto' : 'Facture créée dans Qonto'}${saved.number ? ` sous le n°\u00a0${saved.number}` : ''}` : 'Facture enregistrée')
      form.reset(values)
      router.push(`/${companyId}/invoices/${saved.id}`)
    } catch (e) {
      setFormError((e as Error).message)
      setSubmitting(false)
    }
  }

  const tiersById = new Map((tiers ?? []).map((t) => [t.id, t]))
  const kindLabel = sale ? 'client' : 'fournisseur'

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Facture</CardTitle>
          <CardDescription>
            {sale
              ? 'Une facture émise à un client. Kledg l’enregistre et la comptabilise, il ne l’envoie pas au client.'
              : 'Une facture reçue d’un fournisseur, avec son numéro et ses montants tels qu’ils figurent sur le document.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {sale && !invoiceId ? (
            <div className="space-y-2 sm:col-span-2">
              <p className="text-sm font-medium" id="invoice-numbering-label">
                Émission
              </p>
              <Controller
                control={control}
                name="numbering"
                render={({ field }) => (
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={field.value}
                    onValueChange={(value) => value && field.onChange(value)}
                    aria-labelledby="invoice-numbering-label"
                    className="flex-wrap"
                  >
                    {numbering?.qonto.connected ? (
                      <ToggleGroupItem value="qonto" disabled={!numbering.qonto.active || typeCode === '381'}>
                        Créer la facture dans Qonto
                      </ToggleGroupItem>
                    ) : null}
                    <ToggleGroupItem value="kledg">{numbering?.settings.mode === 'MANUAL' ? 'Saisir le numéro' : 'Numéroter dans Kledg'}</ToggleGroupItem>
                    <ToggleGroupItem value="recorded">Enregistrer une facture déjà émise</ToggleGroupItem>
                  </ToggleGroup>
                )}
              />
              <p className="text-muted-foreground text-xs">
                {choice === 'qonto'
                  ? 'Qonto crée la facture, lui donne son numéro et son PDF ; Kledg la garde et la comptabilise. Une facture créée dans Qonto ne se modifie plus : un avoir l’annule.'
                  : choice === 'recorded'
                    ? 'Une facture émise ailleurs ou avant Kledg : elle garde son numéro, n’est pas envoyée à Qonto et ne prend pas de numéro dans la série de Kledg.'
                    : numbering?.qonto.refusal && numbering.qonto.connected
                      ? numbering.qonto.refusal
                      : numbering?.settings.mode === 'MANUAL'
                        ? 'La société numérote ses factures ailleurs : saisissez le numéro.'
                        : 'Kledg donne le numéro suivant de sa série quand la facture est comptabilisée.'}
              </p>
              {choice === 'qonto' ? (
                <Controller
                  control={control}
                  name="qontoStatus"
                  render={({ field }) => (
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      size="sm"
                      value={field.value ?? 'finalized'}
                      onValueChange={(value) => value && field.onChange(value)}
                      aria-label="Statut dans Qonto"
                    >
                      <ToggleGroupItem value="finalized">Facture finalisée dans Qonto</ToggleGroupItem>
                      <ToggleGroupItem value="draft">Brouillon dans Qonto</ToggleGroupItem>
                    </ToggleGroup>
                  )}
                />
              ) : null}
            </div>
          ) : null}
          <Field label={sale ? 'Client' : 'Fournisseur'} htmlFor="invoice-tiers" required error={formState.errors.tiersId?.message}>
            <Controller
              control={control}
              name="tiersId"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(id) => {
                    field.onChange(id)
                    const chosen = tiersById.get(id)
                    // Prefill the lines still empty with the tiers' defaults
                    lines.forEach((line, i) => {
                      if (!line.accountCode && chosen?.defaultAccountCode) setValue(`lines.${i}.accountCode`, chosen.defaultAccountCode, { shouldDirty: true })
                      if (!line.unitPriceCents && chosen?.defaultVatRateBp !== null && chosen?.defaultVatRateBp !== undefined) {
                        setValue(`lines.${i}.vatRateBp`, String(chosen.defaultVatRateBp), { shouldDirty: true })
                      }
                    })
                  }}
                  disabled={tiers === null}
                >
                  <SelectTrigger id="invoice-tiers" className="w-full">
                    <SelectValue placeholder={tiers === null ? 'Chargement…' : `Choisissez un ${kindLabel}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {(tiers ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} <span className="text-muted-foreground font-mono text-xs">{t.auxiliaryAccountNumber}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          {typed ? (
            <Field
              label="Numéro"
              required
              error={formState.errors.number?.message}
              hint={
                !sale
                  ? 'Le numéro imprimé sur la facture du fournisseur, tel quel : il est unique pour ce fournisseur.'
                  : choice === 'recorded' && !invoiceId
                    ? 'Le numéro sous lequel la facture a été émise.'
                    : 'Numéro unique, dans la suite chronologique de vos factures.'
              }
            >
              <Input {...register('number')} placeholder={sale ? 'ex. F2026-0042' : 'ex. FA-12345'} autoComplete="off" />
            </Field>
          ) : (
            <div className="space-y-1" data-testid="invoice-number-hint">
              <p className="text-sm font-medium">Numéro</p>
              {edited?.number ? (
                <p className="font-mono text-sm">{edited.number}</p>
              ) : choice === 'qonto' && !edited ? (
                <p className="text-sm">{qontoStatus === 'draft' ? 'Donné par Qonto quand le brouillon sera finalisé dans Qonto' : 'Donné par Qonto à la création'}</p>
              ) : edited?.origin === 'QONTO' ? (
                <p className="text-sm">En attente de Qonto</p>
              ) : (
                <>
                  <p className="text-sm">Numéro attribué à l’émission</p>
                  {nextNumber ? <p className="text-muted-foreground text-xs">Prochain numéro prévu&nbsp;: <span className="font-mono">{nextNumber}</span></p> : null}
                </>
              )}
            </div>
          )}
          <Field label="Date de la facture" htmlFor="invoice-issue-date" required error={formState.errors.issueDate?.message}>
            <Controller control={control} name="issueDate" render={({ field }) => <DateInput id="invoice-issue-date" value={field.value} onValueChange={field.onChange} />} />
          </Field>
          <Field
            label="Échéance"
            htmlFor="invoice-due-date"
            optional
            hint="Vide&nbsp;: le délai de paiement du tiers, sinon celui de la société. Au plus 60 jours, ou 45 jours fin de mois (Code de commerce, art. L441-10)."
          >
            <Controller control={control} name="dueDate" render={({ field }) => <DateInput id="invoice-due-date" value={field.value} onValueChange={field.onChange} />} />
          </Field>
          <div className="space-y-2">
            <p className="text-sm font-medium">Type</p>
            <Controller
              control={control}
              name="typeCode"
              render={({ field }) => (
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={field.value}
                  onValueChange={(value) => value && field.onChange(value)}
                  aria-label="Type de document"
                >
                  <ToggleGroupItem value="380">Facture</ToggleGroupItem>
                  <ToggleGroupItem value="381">Avoir</ToggleGroupItem>
                </ToggleGroup>
              )}
            />
          </div>
          <Field label="Libellé" optional>
            <Input {...register('label')} placeholder="ex. Maintenance de septembre" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            Lignes
            <HelpTip term="Taux de TVA">
              Chaque ligne porte son taux. La TVA se calcule par taux, sur le total hors taxe des lignes de ce taux, arrondi au centime (CGI, annexe II, art. 242 nonies A).
            </HelpTip>
          </CardTitle>
          <CardDescription>Désignation, quantité, prix unitaire hors taxe et taux de TVA, comme sur la facture.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {fields.map((item, index) => {
            const errors = formState.errors.lines?.[index]
            return (
              <fieldset key={item.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-12" aria-label={`Ligne ${index + 1}`}>
                <Field label="Désignation" required error={errors?.label?.message} className="sm:col-span-2 lg:col-span-4">
                  <Input {...register(`lines.${index}.label`)} placeholder="ex. Abonnement logiciel" />
                </Field>
                <Field label="Quantité" required error={errors?.quantity?.message} className="lg:col-span-1">
                  <Input {...register(`lines.${index}.quantity`)} inputMode="decimal" autoComplete="off" className="text-right" />
                </Field>
                <Field label="Prix unitaire HT" htmlFor={`line-${index}-price`} required error={errors?.unitPriceCents?.message} className="lg:col-span-2">
                  <Controller
                    control={control}
                    name={`lines.${index}.unitPriceCents`}
                    render={({ field }) => <AmountInput id={`line-${index}-price`} value={field.value} onValueChange={field.onChange} placeholder="0,00" />}
                  />
                </Field>
                <Field label="TVA" htmlFor={`line-${index}-rate`} className="lg:col-span-1">
                  <Controller
                    control={control}
                    name={`lines.${index}.vatRateBp`}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id={`line-${index}-rate`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FRENCH_VAT_RATES_BP.map((rate) => (
                            <SelectItem key={rate} value={String(rate)}>
                              {formatVatRate(rate)}
                            </SelectItem>
                          ))}
                          {sale ? <SelectItem value={EXEMPT_TRAINING}>Exonérée, formation (art. 261, 4, 4° a)</SelectItem> : null}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
                <Field label="Compte" optional className="lg:col-span-2" hint={sale ? 'Vide\u00a0: 706 ou 707' : undefined}>
                  <Input {...register(`lines.${index}.accountCode`)} placeholder={sale ? 'ex. 706' : 'ex. 6064'} className="font-mono" autoComplete="off" />
                </Field>
                <Field label="Nature" htmlFor={`line-${index}-nature`} className="lg:col-span-2">
                  <Controller
                    control={control}
                    name={`lines.${index}.nature`}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id={`line-${index}-nature`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="SERVICES">Prestation</SelectItem>
                          <SelectItem value="GOODS">Bien</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
                <div className="flex items-end justify-between gap-3 sm:col-span-2 lg:col-span-12">
                  {!sale ? (
                    <Controller
                      control={control}
                      name={`lines.${index}.fixedAsset`}
                      render={({ field }) => (
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
                          Immobilisation (TVA au 44562)
                        </label>
                      )}
                    />
                  ) : (
                    <span />
                  )}
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)} disabled={fields.length === 1}>
                    <Trash2 aria-hidden />
                    Retirer la ligne
                  </Button>
                </div>
              </fieldset>
            )
          })}
          <Button type="button" variant="outline" size="sm" onClick={() => append(emptyLine(tiersById.get(form.getValues('tiersId'))))}>
            <Plus aria-hidden />
            Ajouter une ligne
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Totaux</CardTitle>
        </CardHeader>
        <CardContent className="max-w-md">
          <InvoiceTotals lines={amountLines} />
        </CardContent>
      </Card>

      {formError ? (
        <p role="alert" className="text-destructive text-sm">
          {formError}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Annuler
        </Button>
        <Button type="submit" loading={submitting}>
          {invoiceId
            ? 'Enregistrer les modifications'
            : sale && choice === 'qonto'
              ? qontoStatus === 'draft'
                ? 'Créer le brouillon dans Qonto'
                : 'Créer la facture dans Qonto'
              : 'Enregistrer la facture'}
        </Button>
      </div>
    </form>
  )
}
