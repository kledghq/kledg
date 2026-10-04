/**
 * Fixed asset form dialog component
 * 
 * This component handles creating and editing fixed assets
 */

'use client'

import React, { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DatePicker } from '@/components/ui/date-picker'
import { X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AccountCombobox } from '@/components/features/accounting/account-combobox'
import { formatAmount, formatPercent } from '@/components/shared'

export const fixedAssetSchema = z.object({
  label: z.string().min(1, 'Le libellé est requis'),
  comment: z.string().optional().nullable(),
  acquisitionDate: z.string().min(1, 'La date d\'acquisition est requise'),
  acquisitionValue: z.number().min(0.01, 'La valeur d\'acquisition doit être supérieure à 0'),
  amortizableAmount: z.number().min(0).optional().nullable(),
  disposalDate: z.string().optional().nullable(),
  depreciationRate: z.number().min(0).max(100).optional().nullable(),
  depreciationDuration: z.number().min(1).optional().nullable(),
  depreciationMethod: z.enum(['linear', 'declining', 'none']),
  depreciationStartDate: z.string(),
  decliningCoefficient: z.number().min(0).optional().nullable(),
  assetAccountId: z.string().min(1, 'Le compte d\'immobilisation est requis'),
  depreciationAccountId: z.string(),
  expenseAccountId: z.string(),
  isFullyPaid: z.boolean(),
  // Coûts d'emprunt (Art. 213-9)
  borrowingCostsMethod: z.enum(['capitalize', 'expense']).optional(),
  borrowingCostsDirectlyAttributable: z.number().min(0).optional(),
  borrowingCostsGeneral: z.number().min(0).optional(),
  borrowingCostsCapitalizationRate: z.number().min(0).max(100).optional().nullable(),
  borrowingCostsPeriodStart: z.string().optional().nullable(),
  borrowingCostsPeriodEnd: z.string().optional().nullable(),
  requiresLongPeriod: z.boolean().optional(),
}).superRefine((data, ctx) => {
  // Amortissement-related fields are only required when a depreciation
  // method is actually used. "none" = bien non amortissable.
  if (data.depreciationMethod === 'none') return

  if (!data.depreciationStartDate) {
    ctx.addIssue({
      code: 'custom',
      path: ['depreciationStartDate'],
      message: "La date de début d'amortissement est requise",
    })
  }
  if (!data.depreciationAccountId) {
    ctx.addIssue({
      code: 'custom',
      path: ['depreciationAccountId'],
      message: "Le compte d'amortissement est requis",
    })
  }
  if (!data.expenseAccountId) {
    ctx.addIssue({
      code: 'custom',
      path: ['expenseAccountId'],
      message: 'Le compte de charge est requis',
    })
  }
})

export type FixedAssetFormData = z.infer<typeof fixedAssetSchema>

interface DepreciationScheduleItem {
  year: number
  month: number
  monthName: string
  amount: number
  cumulative: number
}

interface Account {
  id: string
  code: string
  label: string
}

interface FixedAssetFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingAsset: {
    id: string
    label: string
    comment?: string | null
    acquisitionDate: string
    acquisitionValue: number
    amortizableAmount?: number | null
    disposalDate?: string | null
    depreciationRate?: number | null
    depreciationDuration?: number | null
    depreciationMethod: string
    decliningCoefficient?: number | null
    depreciationStartDate: string
    assetAccountId: string
    depreciationAccountId: string
    expenseAccountId: string
    isFullyPaid: boolean
  } | null
  accounts: Account[]
  submitting: boolean
  error: string | null
  onSubmit: (data: FixedAssetFormData) => void
  onCancel: () => void
}

/**
 * Calculate forecasted depreciation schedule
 */
function calculateDepreciationSchedule(
  acquisitionValue: number | undefined,
  amortizableAmount: number | null | undefined,
  depreciationStartDate: string | undefined,
  depreciationRate: number | null | undefined,
  depreciationDuration: number | null | undefined,
  depreciationMethod: string | undefined
): DepreciationScheduleItem[] {
  if (depreciationMethod === 'none') {
    return []
  }
  if (!acquisitionValue || !depreciationStartDate || (!depreciationRate && !depreciationDuration)) {
    return []
  }

  const baseAmount = Number(amortizableAmount || acquisitionValue)
  const startDate = new Date(depreciationStartDate + 'T00:00:00')

  // Calculate annual rate.
  // Priority: duration (if provided) determines the schedule length.
  // Rate is only used when no duration is set, this way a user who enters
  // "3 years" always sees 3 years in the forecast, regardless of what rate
  // they typed.
  let annualRate = 0
  if (depreciationDuration) {
    annualRate = 1 / Number(depreciationDuration)
  } else if (depreciationRate) {
    annualRate = Number(depreciationRate) / 100
  }

  // Calculate monthly depreciation (linear)
  const monthlyDepreciation = (baseAmount * annualRate) / 12

  const schedule: DepreciationScheduleItem[] = []

  // Calculate total months of depreciation. A start after the first day of
  // the month makes that month a prorata (PCG art. 214-13): the remainder
  // falls in one more month after the last full year, so the plan still ends
  // on the full base, as in the server plan (lib/fixed-assets/depreciation-plan.ts).
  const firstMonthIsPartial = startDate.getDate() > 1
  const totalMonths = depreciationDuration
    ? Number(depreciationDuration) * 12 + (firstMonthIsPartial ? 1 : 0)
    : Infinity
  // Plan prévisionnel complet depuis l'acquisition, indépendant de ce qui
  // aurait déjà été comptabilisé.
  let cumulative = 0
  let monthIndex = 0

  // Calculate depreciation start year
  const startYear = startDate.getFullYear()
  const startMonthIndex = startDate.getMonth()
  
  // Calculate until all months are covered
  const maxYears = depreciationDuration ? startYear + Number(depreciationDuration) : startYear + 10
  
  for (let year = startYear; year <= maxYears; year++) {
    const startMonth = year === startYear ? startMonthIndex : 0
    const endMonth = 11

    for (let month = startMonth; month <= endMonth; month++) {
      const monthStartDate = new Date(year, month, 1)
      const monthEndDate = new Date(year, month + 1, 0)

      // Skip uniquement les mois dont la FIN est antérieure au début
      // d'amortissement. Un mois qui contient partiellement la date de
      // début doit être inclus (prorata jours).
      if (monthEndDate < startDate) {
        continue
      }

      // Check if we exceed depreciation duration
      if (monthIndex >= totalMonths) {
        break
      }

      // Check if we have already reached the amortizable amount
      if (cumulative >= baseAmount) {
        break
      }

      let monthAmount = monthlyDepreciation

      // Prorata pour le mois qui contient la date de début.
      if (monthStartDate <= startDate && monthEndDate >= startDate) {
        const daysInMonth = monthEndDate.getDate()
        const daysToAmortize = daysInMonth - startDate.getDate() + 1
        monthAmount = (monthlyDepreciation * daysToAmortize) / daysInMonth
      }

      // Adjust last month if necessary to reach exactly the amortizable amount
      const remainingToAmortize = baseAmount - cumulative
      if (remainingToAmortize < monthAmount) {
        monthAmount = remainingToAmortize
      }

      cumulative += monthAmount

      schedule.push({
        year,
        month,
        monthName: new Date(Date.UTC(year, month, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
        amount: monthAmount,
        cumulative,
      })

      monthIndex++

      // Stop if we have reached the amortizable amount
      if (cumulative >= baseAmount) {
        break
      }
    }

    // Stop if we have reached the amortizable amount or duration
    if (cumulative >= baseAmount || monthIndex >= totalMonths) {
      break
    }
  }

  return schedule
}

interface DecliningYearScheduleItem {
  year: number
  annualRate: number // taux de l'année (constant en dégressif, linéaire/restant après bascule)
  cumulativeRate: number // cumul / base initiale (%)
  base: number // valeur nette comptable en début d'année
  amount: number // amortissement de l'année
  cumulative: number
  mode: 'declining' | 'linear' // bascule en linéaire quand linéaire > dégressif
}

/**
 * Amortissement dégressif, schedule annuel (taux × coefficient, bascule en
 * linéaire quand le taux linéaire sur la valeur résiduelle devient supérieur
 * au taux dégressif).
 */
function calculateDecliningYearlySchedule(
  baseAmount: number | undefined,
  duration: number | null | undefined,
  coefficient: number | null | undefined,
  depreciationStartDate: string | undefined
): DecliningYearScheduleItem[] {
  if (!baseAmount || !duration || duration <= 0) return []
  if (!depreciationStartDate) return []

  const coef = coefficient && coefficient > 0 ? Number(coefficient) : 1.75
  const decliningRate = (1 / Number(duration)) * coef
  const schedule: DecliningYearScheduleItem[] = []
  let book = Number(baseAmount)
  let cumulative = 0
  const totalBase = Number(baseAmount)
  let switched = false
  let switchLinearPerYear = 0

  const startDate = new Date(depreciationStartDate + 'T00:00:00')
  const firstYear = startDate.getFullYear()

  // En amortissement dégressif, l'année d'acquisition est prorata temporis sur
  // les mois restants (règle fiscale française, prorata en mois entiers, y
  // compris le mois d'acquisition). Les années suivantes sont pleines, et on
  // prévoit une année supplémentaire pour absorber le reliquat si la première
  // est partielle.
  const firstYearMonths = 12 - startDate.getMonth() // mois d'acquisition inclus
  const isFirstYearPartial = firstYearMonths < 12

  // Nombre d'années à faire défiler : duration pleines + 1 si la 1ère est partielle
  const maxYears = Number(duration) + (isFirstYearPartial ? 1 : 0)

  for (let y = 0; y < maxYears; y++) {
    if (book <= 0) break
    const yearsLeft = Number(duration) - y
    const yearFraction =
      y === 0 && isFirstYearPartial ? firstYearMonths / 12 : 1

    let amount: number
    let annualRate: number
    let mode: 'declining' | 'linear'

    if (switched) {
      amount = switchLinearPerYear * yearFraction
      annualRate = yearsLeft > 0 ? (100 / yearsLeft) * yearFraction : 0
      mode = 'linear'
    } else {
      const declineAmount = book * decliningRate * yearFraction
      // Le taux linéaire de bascule compare sur l'année pleine suivante,
      // pas sur la fraction, on bascule quand le linéaire annuel plein
      // devient supérieur au dégressif.
      const linearFullYear = yearsLeft > 0 ? book / yearsLeft : 0
      const declineFullYear = book * decliningRate
      if (linearFullYear > declineFullYear) {
        switched = true
        switchLinearPerYear = linearFullYear
        amount = linearFullYear * yearFraction
        annualRate = yearsLeft > 0 ? (100 / yearsLeft) * yearFraction : 0
        mode = 'linear'
      } else {
        amount = declineAmount
        annualRate = decliningRate * 100 * yearFraction
        mode = 'declining'
      }
    }

    // Ne jamais dépasser la valeur nette comptable
    if (amount > book) amount = book

    // Dernière itération : solder exactement pour éviter les arrondis
    if (y === maxYears - 1) {
      amount = book
    }

    const nextCumulative = cumulative + amount
    schedule.push({
      year: firstYear + y,
      annualRate,
      cumulativeRate: totalBase > 0 ? (nextCumulative / totalBase) * 100 : 0,
      base: book,
      amount,
      cumulative: nextCumulative,
      mode,
    })
    cumulative = nextCumulative
    book -= amount
  }
  return schedule
}

/**
 * Fixed asset form dialog component
 */
export function FixedAssetFormDialog({
  open,
  onOpenChange,
  editingAsset,
  accounts,
  submitting,
  error,
  onSubmit,
  onCancel,
}: FixedAssetFormDialogProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FixedAssetFormData>({
    resolver: zodResolver(fixedAssetSchema),
    defaultValues: {
      label: '',
      comment: '',
      acquisitionDate: '',
      acquisitionValue: 0,
      amortizableAmount: null,
      disposalDate: null,
      depreciationRate: null,
      depreciationDuration: null,
      depreciationMethod: 'linear',
      depreciationStartDate: '',
      decliningCoefficient: null,
      assetAccountId: '',
      depreciationAccountId: '',
      expenseAccountId: '',
      isFullyPaid: false,
      borrowingCostsMethod: 'expense',
      borrowingCostsDirectlyAttributable: 0,
      borrowingCostsGeneral: 0,
      borrowingCostsCapitalizationRate: null,
      borrowingCostsPeriodStart: null,
      borrowingCostsPeriodEnd: null,
      requiresLongPeriod: false,
    },
  })

  useEffect(() => {
    if (open && editingAsset) {
      reset({
        label: editingAsset.label,
        comment: editingAsset.comment || '',
        acquisitionDate: editingAsset.acquisitionDate.split('T')[0],
        acquisitionValue: Number(editingAsset.acquisitionValue),
        amortizableAmount: editingAsset.amortizableAmount ? Number(editingAsset.amortizableAmount) : null,
        disposalDate: editingAsset.disposalDate ? editingAsset.disposalDate.split('T')[0] : null,
        depreciationRate: editingAsset.depreciationRate ? Number(editingAsset.depreciationRate) : null,
        depreciationDuration: editingAsset.depreciationDuration ? Number(editingAsset.depreciationDuration) : null,
        depreciationMethod: (editingAsset.depreciationMethod || 'linear') as 'linear' | 'declining',
        decliningCoefficient: editingAsset.decliningCoefficient ? Number(editingAsset.decliningCoefficient) : null,
        depreciationStartDate: editingAsset.depreciationStartDate.split('T')[0],
        assetAccountId: editingAsset.assetAccountId,
        depreciationAccountId: editingAsset.depreciationAccountId,
        expenseAccountId: editingAsset.expenseAccountId,
        isFullyPaid: editingAsset.isFullyPaid || false,
      })
    } else if (open && !editingAsset) {
      reset({
        label: '',
        comment: '',
        acquisitionDate: '',
        acquisitionValue: 0,
        amortizableAmount: null,
        disposalDate: null,
        depreciationRate: null,
        depreciationDuration: null,
        depreciationMethod: 'linear',
        depreciationStartDate: '',
        decliningCoefficient: null,
        assetAccountId: '',
        depreciationAccountId: '',
        expenseAccountId: '',
        isFullyPaid: false,
      })
    }
  }, [open, editingAsset, reset])

  const depreciationSchedule = calculateDepreciationSchedule(
    watch('acquisitionValue'),
    watch('amortizableAmount'),
    watch('depreciationStartDate'),
    watch('depreciationRate'),
    watch('depreciationDuration'),
    watch('depreciationMethod')
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col !max-w-[90vw] !w-[90vw] sm:!max-w-[90vw]">
        <DialogHeader>
          <DialogTitle>
            {editingAsset ? 'Modifier l\'immobilisation' : 'Ajouter une immobilisation'}
          </DialogTitle>
          <DialogDescription>
            {editingAsset
              ? 'Modifiez les informations de l\'immobilisation'
              : 'Créez une nouvelle immobilisation'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
          <div className="space-y-4 py-4 flex-1 overflow-y-auto pr-2">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="label">Nom de cette immobilisation *</Label>
              <Input
                id="label"
                {...register('label')}
                placeholder="Ex&nbsp;: Mac Studio"
              />
              {errors.label && (
                <p className="text-sm text-destructive">{errors.label.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="comment">Commentaire</Label>
              <Textarea
                id="comment"
                {...register('comment')}
                placeholder="Commentaire optionnel"
                rows={3}
              />
            </div>
            <div className="border-t pt-4"></div>
            <div className="space-y-2">
              <Label htmlFor="depreciationMethod">Type d'amortissement *</Label>
              <Select
                value={watch('depreciationMethod')}
                onValueChange={(value) => setValue('depreciationMethod', value as 'linear' | 'declining' | 'none')}
              >
                <SelectTrigger id="depreciationMethod">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="linear">Linéaire</SelectItem>
                  <SelectItem value="declining">Dégressif</SelectItem>
                  <SelectItem value="none">Non amortissable</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="acquisitionDate">Date d'acquisition *</Label>
                <DatePicker
                  id="acquisitionDate"
                  date={watch('acquisitionDate') ? new Date(watch('acquisitionDate') + 'T00:00:00') : undefined}
                  onDateChange={(date) => {
                    if (date) {
                      const year = date.getFullYear()
                      const month = String(date.getMonth() + 1).padStart(2, '0')
                      const day = String(date.getDate()).padStart(2, '0')
                      setValue('acquisitionDate', `${year}-${month}-${day}`)
                    } else {
                      setValue('acquisitionDate', '')
                    }
                  }}
                  placeholder="Date d'acquisition"
                />
                {errors.acquisitionDate && (
                  <p className="text-sm text-destructive">{errors.acquisitionDate.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="acquisitionValue">Montant d'achat (Hors Taxes) *</Label>
                <div className="relative">
                  <Input
                    id="acquisitionValue"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    {...register('acquisitionValue', { valueAsNumber: true })}
                    placeholder="0.00"
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">€</span>
                </div>
                {errors.acquisitionValue && (
                  <p className="text-sm text-destructive">{errors.acquisitionValue.message}</p>
                )}
              </div>
              {watch('depreciationMethod') !== 'none' && (
                <div className="space-y-2">
                  <Label htmlFor="amortizableAmount">Montant amortissable</Label>
                  <div className="relative">
                    <Input
                      id="amortizableAmount"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      {...register('amortizableAmount', { valueAsNumber: true })}
                      placeholder="0.00"
                      className="pr-8"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">€</span>
                  </div>
                </div>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="disposalDate">Date de cession</Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <DatePicker
                      id="disposalDate"
                      date={watch('disposalDate') ? new Date(watch('disposalDate') + 'T00:00:00') : undefined}
                      onDateChange={(date) => {
                        if (date) {
                          const year = date.getFullYear()
                          const month = String(date.getMonth() + 1).padStart(2, '0')
                          const day = String(date.getDate()).padStart(2, '0')
                          setValue('disposalDate', `${year}-${month}-${day}`)
                        } else {
                          setValue('disposalDate', null)
                        }
                      }}
                      placeholder="jj/mm/aaaa"
                    />
                  </div>
                  {watch('disposalDate') && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setValue('disposalDate', null, { shouldDirty: true })}
                      title="Supprimer la date de cession"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="space-y-2 flex items-end">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="isFullyPaid"
                    checked={watch('isFullyPaid')}
                    onCheckedChange={(checked) => setValue('isFullyPaid', checked)}
                  />
                  <Label htmlFor="isFullyPaid" className="cursor-pointer">
                    Cette immobilisation est entièrement payée
                  </Label>
                </div>
              </div>
            </div>
            {watch('depreciationMethod') !== 'none' && (
            <>
            <div className="space-y-2">
              <Label htmlFor="depreciationStartDate">Date de début d'amortissement *</Label>
              <DatePicker
                id="depreciationStartDate"
                date={watch('depreciationStartDate') ? new Date(watch('depreciationStartDate') + 'T00:00:00') : undefined}
                onDateChange={(date) => {
                  if (date) {
                    const year = date.getFullYear()
                    const month = String(date.getMonth() + 1).padStart(2, '0')
                    const day = String(date.getDate()).padStart(2, '0')
                    setValue('depreciationStartDate', `${year}-${month}-${day}`)
                  } else {
                    setValue('depreciationStartDate', '')
                  }
                }}
                placeholder="Date de début d'amortissement"
              />
              {errors.depreciationStartDate && (
                <p className="text-sm text-destructive">{errors.depreciationStartDate.message}</p>
              )}
            </div>
            {watch('depreciationMethod') === 'declining' && (
              <div className="space-y-2">
                <Label htmlFor="decliningCoefficient">Coefficient dégressif</Label>
                <div className="relative">
                  <Input
                    id="decliningCoefficient"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    {...register('decliningCoefficient', { valueAsNumber: true })}
                    placeholder="1.25"
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">€</span>
                </div>
              </div>
            )}
            {watch('depreciationMethod') === 'linear' ? (
              <div className="space-y-2">
                <Label htmlFor="depreciationDuration">Nombre d'années d'amortissement *</Label>
                <Input
                  id="depreciationDuration"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  {...register('depreciationDuration', { 
                    valueAsNumber: true,
                    onChange: (e) => {
                      const duration = parseFloat(e.target.value)
                      if (duration && duration > 0 && !isNaN(duration)) {
                        const rate = (100 / duration).toFixed(2)
                        setValue('depreciationRate', parseFloat(rate))
                      } else {
                        setValue('depreciationRate', null)
                      }
                    }
                  })}
                  placeholder="3"
                />
                {(() => {
                  const duration = watch('depreciationDuration')
                  const durationNum = Number(duration)
                  if (duration && durationNum > 0 && !isNaN(durationNum) && isFinite(durationNum)) {
                    const calculatedRate = (100 / durationNum).toFixed(2)
                    if (!isNaN(parseFloat(calculatedRate)) && isFinite(parseFloat(calculatedRate))) {
                      return (
                        <p className="text-xs text-muted-foreground">
                          Taux calculé automatiquement&nbsp;: {calculatedRate}% par an
                        </p>
                      )
                    }
                  }
                  return null
                })()}
                {errors.depreciationDuration && (
                  <p className="text-sm text-destructive">{errors.depreciationDuration.message}</p>
                )}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="depreciationRate">Taux d'amortissement annuel (%)</Label>
                  <Input
                    id="depreciationRate"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    max="100"
                    {...register('depreciationRate', { valueAsNumber: true })}
                    placeholder="20"
                  />
                  {errors.depreciationRate && (
                    <p className="text-sm text-destructive">{errors.depreciationRate.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="depreciationDuration">Nombre d'années d'amortissement</Label>
                  <Input
                    id="depreciationDuration"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    {...register('depreciationDuration', { valueAsNumber: true })}
                    placeholder="3"
                  />
                  {errors.depreciationDuration && (
                    <p className="text-sm text-destructive">{errors.depreciationDuration.message}</p>
                  )}
                </div>
              </div>
            )}
            </>
            )}

            {/* Déclinaison annuelle des taux, uniquement pour l'amortissement dégressif */}
            {watch('depreciationMethod') === 'declining' &&
              (() => {
                const yearly = calculateDecliningYearlySchedule(
                  Number(watch('amortizableAmount') || watch('acquisitionValue') || 0),
                  watch('depreciationDuration'),
                  watch('decliningCoefficient'),
                  watch('depreciationStartDate') || undefined
                )
                if (yearly.length === 0) return null
                return (
                  <div className="border-t pt-4 space-y-4">
                    <div>
                      <h3 className="text-lg font-semibold mb-2">Taux annuels dégressifs</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Taux appliqué année par année à la valeur nette comptable, avec bascule
                        automatique en linéaire lorsque le taux linéaire sur la valeur résiduelle
                        devient supérieur.
                      </p>
                    </div>
                    <div className="border rounded-lg overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Année</TableHead>
                            <TableHead className="text-right">Valeur nette début</TableHead>
                            <TableHead className="text-right">Taux annuel</TableHead>
                            <TableHead className="text-right">Taux cumulé</TableHead>
                            <TableHead>Mode</TableHead>
                            <TableHead className="text-right">Amortissement</TableHead>
                            <TableHead className="text-right">Cumul</TableHead>
                            <TableHead className="text-right">VNC fin</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {yearly.map((row) => {
                            const baseTotal =
                              Number(watch('amortizableAmount') || watch('acquisitionValue') || 0)
                            const vncEnd = Math.max(0, baseTotal - row.cumulative)
                            return (
                              <TableRow key={row.year}>
                                <TableCell className="font-medium">{row.year}</TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatAmount(row.base)}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatPercent(row.annualRate)}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatPercent(row.cumulativeRate)}
                                </TableCell>
                                <TableCell>
                                  <span
                                    className={
                                      row.mode === 'linear'
                                        ? 'text-xs text-muted-foreground'
                                        : 'text-xs'
                                    }
                                  >
                                    {row.mode === 'declining' ? 'Dégressif' : 'Linéaire (bascule)'}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatAmount(row.amount)}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatAmount(row.cumulative)}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatAmount(vncEnd)}
                                </TableCell>
                              </TableRow>
                            )
                          })}
                          <TableRow className="font-semibold bg-muted/50">
                            <TableCell colSpan={5}>Total</TableCell>
                            <TableCell className="text-right font-mono">
                              {formatAmount(
                                yearly.reduce((s, r) => s + r.amount, 0)
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatAmount(yearly[yearly.length - 1].cumulative)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatAmount(0)}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )
              })()}

            {/* Récapitulatif annuel (linéaire), agrégé depuis le schedule mensuel */}
            {watch('depreciationMethod') === 'linear' && depreciationSchedule.length > 0 &&
              (() => {
                const base = Number(watch('amortizableAmount') || watch('acquisitionValue') || 0)
                const byYear = new Map<number, { amount: number; cumulative: number }>()
                for (const item of depreciationSchedule) {
                  const entry = byYear.get(item.year) ?? { amount: 0, cumulative: 0 }
                  entry.amount += item.amount
                  entry.cumulative = item.cumulative
                  byYear.set(item.year, entry)
                }
                const rows = Array.from(byYear.entries())
                  .sort(([a], [b]) => a - b)
                  .map(([year, v]) => ({
                    year,
                    amount: v.amount,
                    cumulative: v.cumulative,
                    annualRate: base > 0 ? (v.amount / base) * 100 : 0,
                    cumulativeRate: base > 0 ? (v.cumulative / base) * 100 : 0,
                  }))
                return (
                  <div className="border-t pt-4 space-y-4">
                    <div>
                      <h3 className="text-lg font-semibold mb-2">Récapitulatif annuel</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Amortissement annuel sur {rows.length} exercice{rows.length > 1 ? 's' : ''}
                        {' '}(base {formatAmount(base)}).
                      </p>
                    </div>
                    <div className="border rounded-lg overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Année</TableHead>
                            <TableHead className="text-right">Taux annuel</TableHead>
                            <TableHead className="text-right">Taux cumulé</TableHead>
                            <TableHead className="text-right">Amortissement</TableHead>
                            <TableHead className="text-right">Cumul</TableHead>
                            <TableHead className="text-right">VNC fin</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((row) => {
                            const vncEnd = Math.max(0, base - row.cumulative)
                            return (
                              <TableRow key={row.year}>
                                <TableCell className="font-medium">{row.year}</TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatPercent(row.annualRate)}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatPercent(row.cumulativeRate)}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatAmount(row.amount)}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatAmount(row.cumulative)}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatAmount(vncEnd)}
                                </TableCell>
                              </TableRow>
                            )
                          })}
                          <TableRow className="font-semibold bg-muted/50">
                            <TableCell colSpan={3}>Total</TableCell>
                            <TableCell className="text-right font-mono">
                              {formatAmount(rows.reduce((s, r) => s + r.amount, 0))}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {rows.length > 0
                                ? formatAmount(rows[rows.length - 1].cumulative)
                                : formatAmount(0)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatAmount(0)}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )
              })()}

            {/* Depreciation schedule preview */}
            {depreciationSchedule.length > 0 && (
              <div className="border-t pt-4 space-y-4">
                <div>
                  <h3 className="text-lg font-semibold mb-2">Tableau prévisionnel mensuel</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Amortissements répartis sur l'année {depreciationSchedule[0].year}
                    {depreciationSchedule[depreciationSchedule.length - 1].year !== depreciationSchedule[0].year &&
                      ` à ${depreciationSchedule[depreciationSchedule.length - 1].year}`
                    }
                  </p>
                </div>
                <div className="border rounded-lg overflow-hidden">
                  <div className="max-h-96 overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow>
                          <TableHead className="bg-background">Période</TableHead>
                          <TableHead className="text-right bg-background">Amortissement mensuel</TableHead>
                          <TableHead className="text-right bg-background">Cumul des amortissements</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {depreciationSchedule.map((item, index) => {
                          // Group by year for better readability
                          const isNewYear = index === 0 || depreciationSchedule[index - 1].year !== item.year
                          return (
                            <React.Fragment key={`${item.year}-${item.month}-${index}`}>
                              {isNewYear && (
                                <TableRow className="bg-muted/30">
                                  <TableCell colSpan={3} className="font-semibold text-center">
                                    Année {item.year}
                                  </TableCell>
                                </TableRow>
                              )}
                              <TableRow>
                                <TableCell className="font-medium">
                                  {item.monthName}
                                </TableCell>
                                <TableCell className="text-right">
                                  {formatAmount(item.amount)}
                                </TableCell>
                                <TableCell className="text-right">
                                  {formatAmount(item.cumulative)}
                                </TableCell>
                              </TableRow>
                            </React.Fragment>
                          )
                        })}
                        {depreciationSchedule.length > 0 && (
                          <TableRow className="font-semibold bg-muted/50">
                            <TableCell>Total prévisionnel</TableCell>
                            <TableCell className="text-right">
                              {formatAmount(
                                depreciationSchedule.reduce((sum, item) => sum + item.amount, 0)
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatAmount(
                                depreciationSchedule[depreciationSchedule.length - 1]?.cumulative || 0
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            )}
            <div className="border-t pt-4 space-y-4">
              <h3 className="text-lg font-semibold">Comptes comptables</h3>
              <div
                className={
                  watch('depreciationMethod') === 'none'
                    ? 'grid grid-cols-1 gap-4'
                    : 'grid grid-cols-1 md:grid-cols-3 gap-4'
                }
              >
                <div className="space-y-2">
                  <Label htmlFor="assetAccountId">Compte d'actif *</Label>
                  <AccountCombobox
                    id="assetAccountId"
                    accounts={accounts}
                    value={watch('assetAccountId') || 'none'}
                    onValueChange={(value) => setValue('assetAccountId', value === 'none' ? '' : value)}
                    placeholder="Sélectionner un compte"
                    className="w-full"
                    codePrefix="2"
                  />
                  {errors.assetAccountId && (
                    <p className="text-sm text-destructive">{errors.assetAccountId.message}</p>
                  )}
                </div>
                {watch('depreciationMethod') !== 'none' && (
                <>
                <div className="space-y-2">
                  <Label htmlFor="depreciationAccountId">Compte d'amortissement *</Label>
                  <AccountCombobox
                    id="depreciationAccountId"
                    accounts={accounts}
                    value={watch('depreciationAccountId') || 'none'}
                    onValueChange={(value) => setValue('depreciationAccountId', value === 'none' ? '' : value)}
                    placeholder="Sélectionner un compte"
                    className="w-full"
                    codePrefix="28"
                  />
                  {errors.depreciationAccountId && (
                    <p className="text-sm text-destructive">{errors.depreciationAccountId.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expenseAccountId">Compte de charge *</Label>
                  <AccountCombobox
                    id="expenseAccountId"
                    accounts={accounts}
                    value={watch('expenseAccountId') || 'none'}
                    onValueChange={(value) => setValue('expenseAccountId', value === 'none' ? '' : value)}
                    placeholder="Sélectionner un compte"
                    className="w-full"
                    codePrefix="68"
                  />
                  {errors.expenseAccountId && (
                    <p className="text-sm text-destructive">{errors.expenseAccountId.message}</p>
                  )}
                </div>
                </>
                )}
              </div>
            </div>

            {/* Section Coûts d'emprunt (Art. 213-9) */}
            <div className="space-y-4 border-t pt-4">
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Coûts d'emprunt (Art. 213-9)</h3>
                <p className="text-xs text-muted-foreground">
                  Les coûts d'emprunt pour financer l'acquisition ou la production d'un actif
                  éligible peuvent être inclus dans le coût de l'actif.
                </p>
              </div>
              
              <div className="space-y-2 flex items-center">
                <Switch
                  id="requiresLongPeriod"
                  checked={watch('requiresLongPeriod') || false}
                  onCheckedChange={(checked) => setValue('requiresLongPeriod', checked)}
                />
                <Label htmlFor="requiresLongPeriod" className="cursor-pointer">
                  Actif nécessitant une longue période de préparation/construction
                </Label>
              </div>
              
              {watch('requiresLongPeriod') && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="borrowingCostsMethod">Méthode de traitement</Label>
                    <Select
                      value={watch('borrowingCostsMethod') || 'expense'}
                      onValueChange={(value) => setValue('borrowingCostsMethod', value as 'capitalize' | 'expense')}
                    >
                      <SelectTrigger id="borrowingCostsMethod">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="expense">Comptabiliser en charges</SelectItem>
                        <SelectItem value="capitalize">Capitaliser dans le coût de l'actif</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {watch('borrowingCostsMethod') === 'capitalize' && (
                    <>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="borrowingCostsDirectlyAttributable">Coûts directement attribuables (€)</Label>
                          <Input
                            id="borrowingCostsDirectlyAttributable"
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            {...register('borrowingCostsDirectlyAttributable', { valueAsNumber: true })}
                            placeholder="0.00"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="borrowingCostsGeneral">Coûts d'emprunt généraux (€)</Label>
                          <Input
                            id="borrowingCostsGeneral"
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            {...register('borrowingCostsGeneral', { valueAsNumber: true })}
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                      
                      {watch('borrowingCostsGeneral') && Number(watch('borrowingCostsGeneral')) > 0 && (
                        <div className="space-y-2">
                          <Label htmlFor="borrowingCostsCapitalizationRate">Taux de capitalisation (%)</Label>
                          <Input
                            id="borrowingCostsCapitalizationRate"
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            max="100"
                            {...register('borrowingCostsCapitalizationRate', { valueAsNumber: true })}
                            placeholder="0.00"
                          />
                        </div>
                      )}
                      
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="borrowingCostsPeriodStart">Début période de production</Label>
                          <DatePicker
                            id="borrowingCostsPeriodStart"
                            date={watch('borrowingCostsPeriodStart') ? new Date(watch('borrowingCostsPeriodStart') + 'T00:00:00') : undefined}
                            onDateChange={(date) => {
                              if (date) {
                                const year = date.getFullYear()
                                const month = String(date.getMonth() + 1).padStart(2, '0')
                                const day = String(date.getDate()).padStart(2, '0')
                                setValue('borrowingCostsPeriodStart', `${year}-${month}-${day}`)
                              } else {
                                setValue('borrowingCostsPeriodStart', null)
                              }
                            }}
                            placeholder="jj/mm/aaaa"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="borrowingCostsPeriodEnd">Fin période de production</Label>
                          <DatePicker
                            id="borrowingCostsPeriodEnd"
                            date={watch('borrowingCostsPeriodEnd') ? new Date(watch('borrowingCostsPeriodEnd') + 'T00:00:00') : undefined}
                            onDateChange={(date) => {
                              if (date) {
                                const year = date.getFullYear()
                                const month = String(date.getMonth() + 1).padStart(2, '0')
                                const day = String(date.getDate()).padStart(2, '0')
                                setValue('borrowingCostsPeriodEnd', `${year}-${month}-${day}`)
                              } else {
                                setValue('borrowingCostsPeriodEnd', null)
                              }
                            }}
                            placeholder="jj/mm/aaaa"
                          />
                        </div>
                      </div>
                      
                      {watch('borrowingCostsDirectlyAttributable') && watch('borrowingCostsGeneral') && (
                        <Alert>
                          <AlertDescription>
                            Coûts d'emprunt totaux&nbsp;:{' '}
                            {(Number(watch('borrowingCostsDirectlyAttributable')) || 0) +
                              (Number(watch('borrowingCostsGeneral')) || 0)}{' '}
                            €
                            {watch('borrowingCostsMethod') === 'capitalize' && (
                              <span className="block mt-1 text-xs">
                                Ces coûts seront inclus dans la valeur d'acquisition de l'actif.
                              </span>
                            )}
                          </AlertDescription>
                        </Alert>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={submitting}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Enregistrement...' : editingAsset ? 'Modifier' : 'Créer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
