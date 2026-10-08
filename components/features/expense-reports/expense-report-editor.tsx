'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Car, Receipt, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DateInput } from '@/components/ui/date-input'
import { Input } from '@/components/ui/input'
import { AmountInput } from '@/components/ui/amount-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Amount, Field, HelpTip } from '@/components/shared'
import { responseError } from '@/hooks/use-cursor-list'
import { COMMON_VAT_RATES_BP, FRENCH_VAT_RATES_BP, formatVatRate } from '@/lib/invoices/amounts'
import { assignPriorDistances, computeReport, type LineInput } from '@/lib/expense-reports/amounts'
import { EXPENSE_CATEGORIES, EXPENSE_LINE_CATEGORIES, type ExpenseCategory } from '@/lib/expense-reports/categories'
import { matchCategoryRule, type CategoryRule } from '@/lib/expense-reports/category-rules'
import { VEHICLE_LABELS, type VehicleType } from '@/lib/expense-reports/mileage-scale'
import { CLAIMANT_KIND_LABELS } from '@/lib/expense-reports/status'
import { RECOVERY_LABELS } from '@/lib/expense-reports/vat-recovery'
import { localDateToIso } from '@/lib/utils/date'
import { ExpenseTotals } from './expense-totals'
import { mealLineTreatment } from '@/lib/expense-reports/exploitant-meals'
import type { MealRuleView } from '@/lib/expense-reports/meal-rule.service'
import { MealTreatmentNote } from './meal-split-note'

const lineSchema = z.object({
  kind: z.enum(['EXPENSE', 'MILEAGE']),
  date: z.string().min(1, 'La date est requise'),
  supplierName: z.string().max(200),
  label: z.string().trim().min(1, 'Le libellé est requis').max(300),
  category: z.string(),
  accountCode: z.string().trim().max(20),
  amountInclTaxCents: z.number().nullable(),
  vatRateBp: z.string(),
  vatCents: z.number().nullable(),
  receiptKind: z.enum(['NONE', 'RECEIPT', 'INVOICE']),
  receiptAttachmentId: z.string(),
  receiptReference: z.string().max(200),
  vehicleType: z.enum(['CAR', 'MOTORCYCLE', 'MOPED']),
  fiscalPower: z.string(),
  electric: z.boolean(),
  distanceKm: z.string(),
  /** Who took a meal alone when the claimant does not say it (company at IR); '' when not asked. */
  mealTaker: z.enum(['', 'EXPLOITANT', 'EMPLOYEE']),
})

const formSchema = z
  .object({
    claimantId: z.string(),
    label: z.string().max(200),
    periodStart: z.string().min(1, 'Le début de la période est requis'),
    periodEnd: z.string().min(1, 'La fin de la période est requise'),
    lines: z.array(lineSchema),
  })
  .superRefine((values, ctx) => {
    values.lines.forEach((line, i) => {
      if (line.kind === 'EXPENSE' && (line.amountInclTaxCents === null || line.amountInclTaxCents <= 0)) {
        ctx.addIssue({ code: 'custom', path: ['lines', i, 'amountInclTaxCents'], message: 'Montant payé requis' })
      }
      if (line.kind === 'MILEAGE' && !(Number(line.distanceKm) > 0 && Number.isInteger(Number(line.distanceKm)))) {
        ctx.addIssue({ code: 'custom', path: ['lines', i, 'distanceKm'], message: 'Distance en kilomètres entiers' })
      }
      if (line.kind === 'MILEAGE' && line.vehicleType !== 'MOPED' && !(Number(line.fiscalPower) >= 1)) {
        ctx.addIssue({ code: 'custom', path: ['lines', i, 'fiscalPower'], message: 'Puissance fiscale requise' })
      }
    })
  })

export type ExpenseFormValues = z.infer<typeof formSchema>
export type ExpenseFormLine = ExpenseFormValues['lines'][number]

interface ClaimantOption {
  id: string
  name: string
  kind: 'EMPLOYEE' | 'DIRIGEANT' | 'ASSOCIE'
  auxiliaryAccountNumber: string
}

interface ReceiptOption {
  id: string
  fileName: string
  transaction: { date: string; label: string; amountCents: number } | null
}

export interface ExpenseReportEditorProps {
  companyId: string
  /** Editing an existing report: its id and values. */
  reportId?: string
  initial?: ExpenseFormValues
  /** The user validates reports: may choose the claimant. */
  canManage: boolean
  /** The user may read the company's bank receipts (Qonto attachments). */
  canReadReceipts?: boolean
  /** Distance already counted per vehicle and year by the claimant's other reports. */
  mileageBaselines?: Record<string, number>
  /** The company is under the VAT franchise (CGI art. 293 B): no VAT recovered. */
  vatExempt?: boolean
  /** Coefficient de déduction of each year (CGI ann. II art. 205), for the preview; null or absent: full deduction. */
  deductionPercentByYear?: Record<string, number | null>
}

export const emptyExpenseLine = (kind: 'EXPENSE' | 'MILEAGE', date: string): ExpenseFormLine => ({
  kind,
  date,
  supplierName: '',
  label: '',
  category: kind === 'MILEAGE' ? 'MILEAGE' : 'OTHER',
  accountCode: '',
  amountInclTaxCents: null,
  vatRateBp: kind === 'MILEAGE' ? '0' : '2000',
  vatCents: null,
  receiptKind: kind === 'MILEAGE' ? 'NONE' : 'RECEIPT',
  receiptAttachmentId: '',
  receiptReference: '',
  vehicleType: 'CAR',
  fiscalPower: '',
  electric: false,
  distanceKm: '',
  mealTaker: '',
})

/** The lines as the amounts module reads them (invalid fields count as empty). */
export function lineInputsOf(lines: readonly ExpenseFormLine[]): LineInput[] {
  return lines.map((line) => ({
    kind: line.kind,
    date: line.date,
    category: (line.kind === 'MILEAGE' ? 'MILEAGE' : line.category) as ExpenseCategory,
    amountInclTaxCents: line.amountInclTaxCents ?? 0,
    vatRateBp: Number(line.vatRateBp) || 0,
    vatCents: line.vatCents,
    receiptKind: line.receiptKind,
    vehicleType: line.vehicleType,
    fiscalPower: Number(line.fiscalPower) || null,
    electric: line.electric,
    distanceKm: Number(line.distanceKm) || null,
  }))
}

/**
 * Editor of an expense report: claimant (for a validator), period, and its
 * lines, one card per line stacked on phones, a grid from the tablet up.
 * Totals and the VAT recovered on each line follow the lines as they are
 * typed, with the server's rules (lib/expense-reports/amounts.ts); the
 * server recomputes everything on save.
 */
export function ExpenseReportEditor({
  companyId,
  reportId,
  initial,
  canManage,
  canReadReceipts = false,
  mileageBaselines = {},
  vatExempt = false,
  deductionPercentByYear = {},
}: ExpenseReportEditorProps) {
  const router = useRouter()
  const today = localDateToIso(new Date())
  const [claimants, setClaimants] = React.useState<ClaimantOption[] | null>(canManage ? null : [])
  const [rules, setRules] = React.useState<CategoryRule[]>([])
  const [receipts, setReceipts] = React.useState<ReceiptOption[]>([])
  const [submitting, setSubmitting] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: initial ?? { claimantId: '', label: '', periodStart: `${today.slice(0, 8)}01`, periodEnd: today, lines: [emptyExpenseLine('EXPENSE', today)] },
  })
  const { control, register, handleSubmit, formState, setValue, getValues } = form
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines = useWatch({ control, name: 'lines' })

  React.useEffect(() => {
    let cancelled = false
    const load = async <T,>(url: string): Promise<T | null> => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(await responseError(response, 'Les données de la note de frais ne se sont pas chargées.'))
      return response.json() as Promise<T>
    }
    const query = new URLSearchParams({ companyId }).toString()
    Promise.all([
      canManage ? load<{ claimants: ClaimantOption[] }>(`/api/expense-claimants?${query}`) : Promise.resolve(null),
      load<{ rules: CategoryRule[] }>(`/api/expense-category-rules?${query}`),
      canReadReceipts ? load<{ receipts: ReceiptOption[] }>(`/api/expense-reports/receipts?${query}`) : Promise.resolve(null),
    ])
      .then(([c, r, rc]) => {
        if (cancelled) return
        if (c) setClaimants(c.claimants)
        setRules(r?.rules ?? [])
        if (rc) setReceipts(rc.receipts)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setClaimants((current) => current ?? [])
        toast.error(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, canManage, canReadReceipts])

  // Never lose typed data (docs/design-system.md, Forms)
  React.useEffect(() => {
    if (!formState.isDirty || submitting) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [formState.isDirty, submitting])

  // The coefficient de déduction of the line's year: the server applies the one of its day when saving
  const inputs = assignPriorDistances(lineInputsOf(lines ?? []), mileageBaselines).map((line) => ({ ...line, deductionPercent: deductionPercentByYear[line.date.slice(0, 4)] ?? null }))
  const totals = computeReport(inputs, { vatExempt })

  // Meals of the exploitant at a company taxed at IR: the company side and the claimant's role, for the report's last day
  const claimantId = useWatch({ control, name: 'claimantId' })
  const periodEnd = useWatch({ control, name: 'periodEnd' })
  const hasMeals = (lines ?? []).some((l) => l.kind === 'EXPENSE' && l.category === 'MEALS')
  const [mealRule, setMealRule] = React.useState<MealRuleView | null>(null)
  React.useEffect(() => {
    if (!hasMeals) return
    let cancelled = false
    const query = new URLSearchParams({ companyId, ...(claimantId ? { claimantId } : {}), ...(/^\d{4}-\d{2}-\d{2}$/.test(periodEnd ?? '') ? { day: periodEnd } : {}) })
    fetch(`/api/expense-reports/meal-rule?${query.toString()}`)
      .then(async (response) => (response.ok ? ((await response.json()) as MealRuleView) : null))
      .then((view) => !cancelled && setMealRule(view))
      .catch(() => !cancelled && setMealRule(null))
    return () => {
      cancelled = true
    }
  }, [companyId, claimantId, periodEnd, hasMeals])

  /** Proposes the category of the company's keyword rules while the line still has the default one. */
  const applyRule = (index: number) => {
    const line = getValues(`lines.${index}`)
    if (line.kind !== 'EXPENSE' || line.category !== 'OTHER') return
    const rule = matchCategoryRule(rules, line)
    if (!rule) return
    setValue(`lines.${index}.category`, rule.category, { shouldDirty: true })
    if (rule.accountCode && !line.accountCode) setValue(`lines.${index}.accountCode`, rule.accountCode, { shouldDirty: true })
  }

  const onSubmit = async (values: ExpenseFormValues) => {
    setSubmitting(true)
    setFormError(null)
    try {
      const body = {
        companyId,
        ...(values.claimantId ? { claimantId: values.claimantId } : {}),
        label: values.label || null,
        periodStart: values.periodStart,
        periodEnd: values.periodEnd,
        lines: values.lines.map((line) =>
          line.kind === 'MILEAGE'
            ? {
                kind: 'MILEAGE',
                date: line.date,
                label: line.label,
                category: 'MILEAGE',
                accountCode: line.accountCode || null,
                vehicleType: line.vehicleType,
                fiscalPower: line.vehicleType === 'MOPED' ? null : Number(line.fiscalPower),
                electric: line.electric,
                distanceKm: Number(line.distanceKm),
              }
            : {
                kind: 'EXPENSE',
                date: line.date,
                supplierName: line.supplierName || null,
                label: line.label,
                category: line.category,
                accountCode: line.accountCode || null,
                amountInclTaxCents: line.amountInclTaxCents ?? 0,
                vatRateBp: Number(line.vatRateBp),
                vatCents: line.vatCents,
                receiptKind: line.receiptKind,
                receiptAttachmentId: line.receiptAttachmentId || null,
                receiptReference: line.receiptReference || null,
                mealTaker: line.category === 'MEALS' && line.mealTaker ? line.mealTaker : null,
              },
        ),
      }
      const response = await fetch(reportId ? `/api/expense-reports/${reportId}` : '/api/expense-reports', {
        method: reportId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await responseError(response, 'La note de frais n’a pas été enregistrée. Réessayez.'))
      const saved = (await response.json()) as { id: string }
      toast.success(reportId ? 'Note de frais modifiée' : 'Note de frais enregistrée')
      form.reset(values)
      router.push(`/${companyId}/expense-reports/${saved.id}`)
    } catch (e) {
      setFormError((e as Error).message)
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Note de frais</CardTitle>
          <CardDescription>Les dépenses avancées pour la société sur une période, et les trajets faits avec un véhicule personnel.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {canManage ? (
            <Field label="Bénéficiaire" htmlFor="expense-claimant" hint="Vide&nbsp;: votre propre note de frais.">
              <Controller
                control={control}
                name="claimantId"
                render={({ field }) => (
                  <Select value={field.value || 'self'} onValueChange={(v) => field.onChange(v === 'self' ? '' : v)} disabled={claimants === null}>
                    <SelectTrigger id="expense-claimant" className="w-full">
                      <SelectValue placeholder={claimants === null ? 'Chargement…' : 'Choisissez'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="self">Moi</SelectItem>
                      {(claimants ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} <span className="text-muted-foreground text-xs">{CLAIMANT_KIND_LABELS[c.kind]}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          ) : null}
          <Field label="Libellé" optional>
            <Input {...register('label')} placeholder="ex. Déplacements de mars" />
          </Field>
          <Field label="Début de la période" htmlFor="expense-start" required error={formState.errors.periodStart?.message}>
            <Controller control={control} name="periodStart" render={({ field }) => <DateInput id="expense-start" value={field.value} onValueChange={field.onChange} />} />
          </Field>
          <Field label="Fin de la période" htmlFor="expense-end" required error={formState.errors.periodEnd?.message} hint="L’écriture est datée de ce jour.">
            <Controller control={control} name="periodEnd" render={({ field }) => <DateInput id="expense-end" value={field.value} onValueChange={field.onChange} />} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            Dépenses et trajets
            <HelpTip term="TVA récupérable">
              La TVA d’une dépense se récupère avec une facture au nom de la société, ou un ticket détaillé de 150 € HT au plus. Elle ne se récupère jamais sur le transport de
              personnes ni sur l’hébergement des dirigeants et du personnel (CGI, annexe II, art. 206, IV, 2).
            </HelpTip>
          </CardTitle>
          <CardDescription>Une ligne par justificatif. Un ticket à deux taux de TVA se saisit sur deux lignes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {fields.map((item, index) => {
            const line = lines?.[index] ?? item
            const errors = formState.errors.lines?.[index]
            const computed = totals.lines[index]
            const mileage = line.kind === 'MILEAGE'
            const category = EXPENSE_CATEGORIES[(line.category as ExpenseCategory) ?? 'OTHER'] ?? EXPENSE_CATEGORIES.OTHER
            const meal =
              mealRule && !mileage && computed && !computed.error
                ? mealLineTreatment(
                    {
                      kind: line.kind,
                      category: line.category,
                      amountInclTaxCents: computed.amountInclTaxCents,
                      recoverableVatCents: computed.recoverableVatCents,
                      date: /^\d{4}-\d{2}-\d{2}$/.test(line.date) ? line.date : mealRule.day,
                      mealTaker: line.mealTaker || null,
                    },
                    mealRule.company,
                    mealRule.claimant,
                  )
                : null
            const askTaker = !mileage && line.category === 'MEALS' && mealRule?.company.applies === true && mealRule.claimant.role === 'unknown'
            return (
              <fieldset key={item.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-12" aria-label={`Ligne ${index + 1}`} data-testid="expense-line">
                <legend className="sr-only">{`Ligne ${index + 1}`}</legend>
                <Field label="Date" htmlFor={`line-${index}-date`} required error={errors?.date?.message} className="lg:col-span-2">
                  <Controller control={control} name={`lines.${index}.date`} render={({ field }) => <DateInput id={`line-${index}-date`} value={field.value} onValueChange={field.onChange} />} />
                </Field>
                {mileage ? (
                  <>
                    <Field label="Trajet et motif" required error={errors?.label?.message} className="sm:col-span-2 lg:col-span-4">
                      <Input {...register(`lines.${index}.label`)} placeholder="ex. Paris, Lyon, visite client Martin" />
                    </Field>
                    <Field label="Distance (km)" required error={errors?.distanceKm?.message} className="lg:col-span-2">
                      <Input {...register(`lines.${index}.distanceKm`)} inputMode="numeric" autoComplete="off" className="text-right" />
                    </Field>
                    <Field label="Véhicule" htmlFor={`line-${index}-vehicle`} className="lg:col-span-2">
                      <Controller
                        control={control}
                        name={`lines.${index}.vehicleType`}
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger id={`line-${index}-vehicle`} className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(Object.keys(VEHICLE_LABELS) as VehicleType[]).map((v) => (
                                <SelectItem key={v} value={v}>
                                  {VEHICLE_LABELS[v]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </Field>
                    {line.vehicleType !== 'MOPED' ? (
                      <Field label="Puissance (CV)" required error={errors?.fiscalPower?.message} className="lg:col-span-2" hint="Sur la carte grise (P.6).">
                        <Input {...register(`lines.${index}.fiscalPower`)} inputMode="numeric" autoComplete="off" className="text-right" />
                      </Field>
                    ) : null}
                    <Controller
                      control={control}
                      name={`lines.${index}.electric`}
                      render={({ field }) => (
                        <label className="flex items-center gap-2 self-end text-sm sm:col-span-2 lg:col-span-4">
                          <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
                          Véhicule électrique (barème majoré de 20 %)
                        </label>
                      )}
                    />
                  </>
                ) : (
                  <>
                    <Field label="Fournisseur" optional className="lg:col-span-3">
                      <Input {...register(`lines.${index}.supplierName`, { onBlur: () => applyRule(index) })} placeholder="ex. SNCF" autoComplete="off" />
                    </Field>
                    <Field label="Libellé" required error={errors?.label?.message} className="lg:col-span-4">
                      <Input {...register(`lines.${index}.label`, { onBlur: () => applyRule(index) })} placeholder="ex. Billet Paris, Lyon" />
                    </Field>
                    <Field label="Catégorie" htmlFor={`line-${index}-category`} className="lg:col-span-3" hint={category.hint}>
                      <Controller
                        control={control}
                        name={`lines.${index}.category`}
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger id={`line-${index}-category`} className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {EXPENSE_LINE_CATEGORIES.map((key) => (
                                <SelectItem key={key} value={key}>
                                  {EXPENSE_CATEGORIES[key].label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </Field>
                    <Field label="Montant payé TTC" htmlFor={`line-${index}-amount`} required error={errors?.amountInclTaxCents?.message} className="lg:col-span-2">
                      <Controller
                        control={control}
                        name={`lines.${index}.amountInclTaxCents`}
                        render={({ field }) => <AmountInput id={`line-${index}-amount`} value={field.value} onValueChange={field.onChange} placeholder="0,00" />}
                      />
                    </Field>
                    <Field label="Taux de TVA" htmlFor={`line-${index}-rate`} className="lg:col-span-2">
                      <Controller
                        control={control}
                        name={`lines.${index}.vatRateBp`}
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger id={`line-${index}-rate`} className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {[...COMMON_VAT_RATES_BP, ...FRENCH_VAT_RATES_BP.filter((r) => !(COMMON_VAT_RATES_BP as readonly number[]).includes(r))].map((rate) => (
                                <SelectItem key={rate} value={String(rate)}>
                                  {formatVatRate(rate)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </Field>
                    <Field label="Montant de TVA" htmlFor={`line-${index}-vat`} className="lg:col-span-2" hint="Celui du justificatif. Vide&nbsp;: calculé depuis le montant et le taux.">
                      <Controller
                        control={control}
                        name={`lines.${index}.vatCents`}
                        render={({ field }) => <AmountInput id={`line-${index}-vat`} value={field.value} onValueChange={field.onChange} placeholder="auto" />}
                      />
                    </Field>
                    <Field label="Justificatif" htmlFor={`line-${index}-receipt`} className="lg:col-span-3">
                      <Controller
                        control={control}
                        name={`lines.${index}.receiptKind`}
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger id={`line-${index}-receipt`} className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="INVOICE">Facture au nom de la société</SelectItem>
                              <SelectItem value="RECEIPT">Ticket ou facture simplifiée</SelectItem>
                              <SelectItem value="NONE">Aucun justificatif</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </Field>
                    {canReadReceipts ? (
                      <Field label="Pièce dans Kledg" htmlFor={`line-${index}-file`} optional className="lg:col-span-3">
                        <Controller
                          control={control}
                          name={`lines.${index}.receiptAttachmentId`}
                          render={({ field }) => (
                            <Select value={field.value || 'none'} onValueChange={(v) => field.onChange(v === 'none' ? '' : v)}>
                              <SelectTrigger id={`line-${index}-file`} className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Aucune</SelectItem>
                                {receipts.map((r) => (
                                  <SelectItem key={r.id} value={r.id}>
                                    {r.transaction ? `${r.transaction.label}, ` : ''}
                                    {r.fileName}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </Field>
                    ) : null}
                    <Field label="Référence du justificatif" optional className="lg:col-span-3">
                      <Input {...register(`lines.${index}.receiptReference`)} placeholder="ex. ticket n° 4521, classé mars" autoComplete="off" />
                    </Field>
                    {askTaker ? (
                      <Field
                        label="Qui a pris ce repas ?"
                        htmlFor={`line-${index}-taker`}
                        required
                        className="lg:col-span-4"
                        hint="La société est imposée à l’impôt sur le revenu : le repas seul de l’exploitant n’est déductible que pour ses frais supplémentaires."
                      >
                        <Controller
                          control={control}
                          name={`lines.${index}.mealTaker`}
                          render={({ field }) => (
                            <Select value={field.value || undefined} onValueChange={field.onChange}>
                              <SelectTrigger id={`line-${index}-taker`} className="w-full">
                                <SelectValue placeholder="Choisissez" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="EXPLOITANT">L’exploitant ou un associé</SelectItem>
                                <SelectItem value="EMPLOYEE">Un salarié</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </Field>
                    ) : null}
                  </>
                )}
                <Field label="Compte" optional className="lg:col-span-2" hint={`Vide\u00a0: ${(mileage ? EXPENSE_CATEGORIES.MILEAGE : category).account ?? 'à choisir'}`}>
                  <Input {...register(`lines.${index}.accountCode`)} placeholder={(mileage ? EXPENSE_CATEGORIES.MILEAGE : category).account ?? 'ex. 6068'} className="font-mono" autoComplete="off" />
                </Field>
                <div className="flex flex-wrap items-end justify-between gap-3 sm:col-span-2 lg:col-span-12">
                  <p className="text-muted-foreground text-xs" data-testid="line-outcome">
                    {computed?.error ? (
                      <span className="text-destructive">{computed.error}</span>
                    ) : mileage ? (
                      <>
                        Indemnité <Amount value={(computed?.amountInclTaxCents ?? 0) / 100} />
                        {computed?.scaleYear ? `, barème ${computed.scaleYear}, ${computed.powerClass}` : ''}
                        {inputs[index]?.priorDistanceKm ? `, ${inputs[index].priorDistanceKm} km déjà comptés dans l’année` : ''}
                      </>
                    ) : (
                      <>
                        {RECOVERY_LABELS[computed?.reason ?? 'no-vat']}&nbsp;: <Amount value={(computed?.recoverableVatCents ?? 0) / 100} />
                      </>
                    )}
                  </p>
                  {meal ? <MealTreatmentNote treatment={meal} account={line.accountCode || category.account || '6256'} /> : null}
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)}>
                    <Trash2 aria-hidden />
                    Retirer la ligne
                  </Button>
                </div>
              </fieldset>
            )
          })}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => append(emptyExpenseLine('EXPENSE', getValues('periodEnd') || today))}>
              <Receipt aria-hidden />
              Ajouter une dépense
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => append(emptyExpenseLine('MILEAGE', getValues('periodEnd') || today))}>
              <Car aria-hidden />
              Ajouter un trajet
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Totaux</CardTitle>
          {vatExempt ? <CardDescription>La société est en franchise en base de TVA (CGI art. 293 B)&nbsp;: aucune TVA n’est récupérée.</CardDescription> : null}
        </CardHeader>
        <CardContent className="max-w-md">
          <ExpenseTotals totals={totals} />
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
          {reportId ? 'Enregistrer les modifications' : 'Enregistrer la note de frais'}
        </Button>
      </div>
    </form>
  )
}
