'use client'

import * as React from 'react'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AmountInput } from '@/components/ui/amount-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Amount, Field, HelpTip, formatDisplayDate, useConfirm } from '@/components/shared'
import { responseError } from '@/hooks/use-cursor-list'
import { isMonthKey, type MonthKey } from '@/lib/budgets/months'
import { ACCOUNT_PREFIX } from '@/lib/budgets/prefixes'
import { BUDGET_FREQUENCIES, FREQUENCY_LABELS, plannedByMonth, spreadEvenly, type BudgetFrequency } from '@/lib/budgets/recurring'
import type { BudgetLineView } from '@/lib/budgets/manage-budgets.service'

const itemSchema = z
  .object({
    label: z.string().trim().min(1, 'Le libellé est requis').max(120, '120 caractères au maximum'),
    amountCents: z.number({ error: 'Le montant est requis' }).nullable().refine((v) => v !== null, 'Le montant est requis'),
    frequency: z.enum(BUDGET_FREQUENCIES),
    startMonth: z.string().refine(isMonthKey, 'Le premier mois est requis'),
    endMonth: z.string(),
  })
  .refine((item) => !item.endMonth || item.endMonth >= item.startMonth, { message: 'Le dernier mois précède le premier', path: ['endMonth'] })

const formSchema = z.object({
  accountPrefix: z
    .string()
    .trim()
    .regex(ACCOUNT_PREFIX, 'Un compte ou un début de compte de charges (6) ou de produits (7), par exemple 606 ou 706'),
  label: z.string().max(120, '120 caractères au maximum'),
  months: z.array(z.number().nullable()),
  recurringItems: z.array(itemSchema),
})

type FormValues = z.input<typeof formSchema>

const monthLabel = (month: MonthKey) => formatDisplayDate(`${month}-01`, 'month')

function valuesOf(line: BudgetLineView | null, months: readonly MonthKey[]): FormValues {
  const entered = new Map((line?.amounts ?? []).map((a) => [a.month, a.amountCents]))
  return {
    accountPrefix: line?.accountPrefix ?? '',
    label: line?.label ?? '',
    months: months.map((m) => entered.get(m) ?? null),
    recurringItems: (line?.recurringItems ?? []).map((item) => ({
      label: item.label,
      amountCents: item.amountCents,
      frequency: item.frequency,
      startMonth: item.startMonth,
      endMonth: item.endMonth ?? '',
    })),
  }
}

interface BudgetLineSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  budgetId: string
  months: MonthKey[]
  /** The line to edit, null to add one. The parent remounts the sheet (key) for each opening, so the form starts from it. */
  line: BudgetLineView | null
  onSaved: () => void
}

/**
 * Editor of a budget line in a side sheet, so the budget stays in view: the
 * accounts it covers, an amount per month (or an annual amount spread
 * evenly, the remainder on the last month) and recurring items. The annual
 * total follows what is typed with the server's rules
 * (lib/budgets/recurring.ts); the server checks everything again on save.
 */
export function BudgetLineSheet({ open, onOpenChange, budgetId, months, line, onSaved }: BudgetLineSheetProps) {
  const [saving, setSaving] = React.useState(false)
  const [annual, setAnnual] = React.useState<number | null>(null)
  const { confirm, dialog } = useConfirm()
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: valuesOf(line, months) })
  const { control, register, handleSubmit, formState, setValue } = form
  const { fields, append, remove } = useFieldArray({ control, name: 'recurringItems' })
  const watched = useWatch({ control })

  const planned = plannedByMonth(
    months,
    months.map((month, i) => ({ month, amountCents: watched.months?.[i] ?? 0 })),
    (watched.recurringItems ?? [])
      .filter((item) => item?.amountCents != null && isMonthKey(item.startMonth) && item.frequency)
      .map((item) => ({
        amountCents: item!.amountCents as number,
        frequency: item!.frequency as BudgetFrequency,
        startMonth: item!.startMonth as MonthKey,
        endMonth: isMonthKey(item!.endMonth) ? item!.endMonth : null,
      })),
  )
  const plannedTotal = planned.reduce((sum, cents) => sum + cents, 0)

  const close = async () => {
    if (formState.isDirty && !(await confirm({ title: 'Abandonner les modifications ?', description: 'Ce que vous avez saisi sur cette ligne sera perdu.', confirmLabel: 'Abandonner' }))) return
    onOpenChange(false)
  }

  const spread = () => {
    if (annual === null) return
    spreadEvenly(annual, months.length).forEach((cents, i) => setValue(`months.${i}`, cents, { shouldDirty: true }))
  }

  const submit = handleSubmit(async (values) => {
    setSaving(true)
    try {
      const body = {
        accountPrefix: values.accountPrefix.trim(),
        label: values.label.trim() || null,
        amounts: months.map((month, i) => ({ month, amountCents: values.months[i] ?? 0 })).filter((a) => a.amountCents !== 0),
        recurringItems: values.recurringItems.map((item) => ({
          label: item.label.trim(),
          amountCents: item.amountCents as number,
          frequency: item.frequency,
          startMonth: item.startMonth,
          endMonth: item.endMonth || null,
        })),
      }
      const response = await fetch(line ? `/api/budget-lines/${line.id}` : `/api/budgets/${budgetId}/lines`, {
        method: line ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await responseError(response, "La ligne ne s'est pas enregistrée. Réessayez dans un instant."))
      toast.success(line ? 'Ligne enregistrée' : 'Ligne ajoutée')
      onOpenChange(false)
      onSaved()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  })

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (next) onOpenChange(true)
          else void close()
        }}
      >
        <SheetContent className="w-full gap-0 sm:max-w-xl">
          <SheetHeader className="border-b">
            <SheetTitle>{line ? `Ligne ${line.accountPrefix}` : 'Nouvelle ligne de budget'}</SheetTitle>
            <SheetDescription>
              Les comptes dont le numéro commence par ce début, au montant prévu chaque mois. Un compte va à la ligne au début le plus long.
            </SheetDescription>
          </SheetHeader>
          <form id="budget-line-form" onSubmit={submit} className="flex-1 space-y-6 overflow-y-auto p-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
              <Field
                label="Compte"
                required
                error={formState.errors.accountPrefix?.message}
                help={
                  <HelpTip term="Début de compte">
                    62 couvre tous les comptes 62 (autres services extérieurs), 6226 les seuls honoraires. Classe 6 pour les charges, classe 7
                    pour les produits.
                  </HelpTip>
                }
              >
                <Input inputMode="numeric" autoComplete="off" placeholder="ex. 6226" className="font-mono" {...register('accountPrefix')} />
              </Field>
              <Field label="Libellé" optional hint="Vide&nbsp;: le libellé du compte." error={formState.errors.label?.message}>
                <Input autoComplete="off" placeholder="ex. Honoraires comptables" {...register('label')} />
              </Field>
            </div>

            <section className="space-y-3" aria-labelledby="budget-months-title">
              <div className="flex flex-wrap items-end gap-2">
                <h3 id="budget-months-title" className="mr-auto text-sm font-medium">
                  Montants par mois
                </h3>
                <div className="flex items-end gap-2">
                  <Field label="Montant annuel" className="w-36" htmlFor="budget-annual">
                    <AmountInput id="budget-annual" value={annual} onValueChange={setAnnual} allowNegative placeholder="ex. 12 000" />
                  </Field>
                  <Button type="button" size="sm" variant="outline" onClick={spread} disabled={annual === null}>
                    Répartir
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {months.map((month, i) => (
                  <Field key={month} label={monthLabel(month)} htmlFor={`budget-month-${month}`}>
                    <Controller
                      control={control}
                      name={`months.${i}`}
                      render={({ field }) => (
                        <AmountInput id={`budget-month-${month}`} value={field.value ?? null} onValueChange={field.onChange} onBlur={field.onBlur} allowNegative />
                      )}
                    />
                  </Field>
                ))}
              </div>
            </section>

            <section className="space-y-3" aria-labelledby="budget-recurring-title">
              <div className="flex items-center justify-between gap-2">
                <h3 id="budget-recurring-title" className="flex items-center gap-1.5 text-sm font-medium">
                  Éléments récurrents
                  <HelpTip term="Élément récurrent">
                    Un abonnement, un loyer ou une prime d&apos;assurance, ajouté aux mois où il tombe à partir de son premier mois (tous les
                    mois, tous les trois mois ou une fois par an).
                  </HelpTip>
                </h3>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => append({ label: '', amountCents: null, frequency: 'MONTHLY', startMonth: months[0], endMonth: '' })}
                >
                  <Plus aria-hidden />
                  Ajouter
                </Button>
              </div>
              {fields.length === 0 ? <p className="text-muted-foreground text-sm">Aucun élément récurrent sur cette ligne.</p> : null}
              <ul className="space-y-3">
                {fields.map((item, i) => {
                  const errors = formState.errors.recurringItems?.[i]
                  return (
                    <li key={item.id} className="space-y-3 rounded-md border p-3">
                      <div className="flex items-start gap-2">
                        <Field label="Libellé" required error={errors?.label?.message} className="flex-1">
                          <Input autoComplete="off" placeholder="ex. Logiciel de paie" {...register(`recurringItems.${i}.label`)} />
                        </Field>
                        <Button type="button" variant="ghost" size="icon-sm" className="mt-6 hover:text-destructive" aria-label="Retirer l'élément" title="Retirer l'élément" onClick={() => remove(i)}>
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Montant" required error={errors?.amountCents?.message} htmlFor={`budget-item-${item.id}-amount`}>
                          <Controller
                            control={control}
                            name={`recurringItems.${i}.amountCents`}
                            render={({ field }) => (
                              <AmountInput id={`budget-item-${item.id}-amount`} value={field.value ?? null} onValueChange={field.onChange} onBlur={field.onBlur} allowNegative />
                            )}
                          />
                        </Field>
                        <Field label="Fréquence" htmlFor={`budget-item-${item.id}-frequency`}>
                          <Controller
                            control={control}
                            name={`recurringItems.${i}.frequency`}
                            render={({ field }) => (
                              <Select value={field.value} onValueChange={field.onChange}>
                                <SelectTrigger id={`budget-item-${item.id}-frequency`} className="w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {BUDGET_FREQUENCIES.map((f) => (
                                    <SelectItem key={f} value={f}>
                                      {FREQUENCY_LABELS[f]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          />
                        </Field>
                        <Field label="Premier mois" required error={errors?.startMonth?.message} hint="Il fixe le rythme, même avant l'exercice.">
                          <Input type="month" {...register(`recurringItems.${i}.startMonth`)} />
                        </Field>
                        <Field label="Dernier mois" optional error={errors?.endMonth?.message}>
                          <Input type="month" {...register(`recurringItems.${i}.endMonth`)} />
                        </Field>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          </form>
          <SheetFooter className="bg-background sticky bottom-0 flex-row flex-wrap items-center justify-between gap-2 border-t">
            <p className="text-sm">
              Total de l&apos;exercice&nbsp;: <Amount value={plannedTotal / 100} className="font-semibold" />
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => void close()}>
                Annuler
              </Button>
              <Button type="submit" form="budget-line-form" loading={saving}>
                Enregistrer la ligne
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      {dialog}
    </>
  )
}
