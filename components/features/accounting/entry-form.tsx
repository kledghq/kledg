'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AmountInput } from '@/components/ui/amount-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { Amount, Field, PageHeader, formatAmount } from '@/components/shared'
import { AccountCombobox } from '@/components/features/accounting/account-combobox'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { DatePicker } from '@/components/ui/date-picker'
import { logger } from '@/lib/logger'
import { parseCents, sumCents } from '@/lib/utils/money'
import { isoDateToLocal, localDateToIso } from '@/lib/utils/date'

/** Exact total of a side in cents (no floating point drift). */
function totalCents(lines: Array<{ debit: number; credit: number }>, side: 'debit' | 'credit'): bigint {
  return sumCents(lines.map((line) => parseCents(line[side] || 0) ?? 0))
}

// Montants négatifs autorisés (ex. compte en découvert)
const entryLineSchema = z.object({
  accountId: z.string().min(1, 'Compte requis'),
  debit: z.number(),
  credit: z.number(),
  description: z.string().optional(),
})

const entrySchema = z
  .object({
    journalId: z.string().min(1, 'Journal requis'),
    date: z.string().min(1, 'Date requise'),
    description: z.string().optional(),
    reference: z.string().optional(),
    lines: z.array(entryLineSchema).min(2, 'Au moins 2 lignes requises'),
  })
  .refine(
    (data) => {
      // Exact comparison in cents (the server refuses any difference)
      return totalCents(data.lines, 'debit') === totalCents(data.lines, 'credit')
    },
    {
      message: 'Le total débit doit être égal au total crédit',
      path: ['lines'],
    }
  )

type EntryFormData = z.infer<typeof entrySchema>

interface Journal {
  id: string
  code: string
  label: string
}

interface Account {
  id: string
  code: string
  label: string
  parentId?: string | null
}

interface EntryFormProps {
  companyId: string
  journals: Journal[]
  accounts: Account[]
  entryId?: string
  hideTitle?: boolean
  initialData?: {
    journalId: string
    date: string
    description?: string | null
    reference?: string | null
    fiscalYearId?: string | null
    lines: Array<{
      accountId: string
      debit: number
      credit: number
      description?: string | null
    }>
  }
}

export function EntryForm({ companyId, journals, accounts: initialAccounts, entryId, hideTitle = false, initialData }: EntryFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextEntryNumber, setNextEntryNumber] = useState<string | null>(null)
  const [selectedFiscalYearId, setSelectedFiscalYearId] = useState<string>('')
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts)
  const [loadingAccounts, setLoadingAccounts] = useState(false)

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors },
  } = useForm<EntryFormData>({
    resolver: zodResolver(entrySchema),
    defaultValues: initialData ? {
      ...initialData,
      description: initialData.description ?? undefined,
      reference: initialData.reference ?? undefined,
      lines: initialData.lines.map(line => ({
        ...line,
        description: line.description ?? undefined,
      })),
    } : {
      // Today as the user sees it (a UTC day would be yesterday in the evening west of Greenwich)
      date: localDateToIso(new Date()),
      lines: [
        { accountId: '', debit: 0, credit: 0, description: '' },
        { accountId: '', debit: 0, credit: 0, description: '' },
      ],
    },
  })

  // Load accounts when fiscal year changes
  useEffect(() => {
    if (selectedFiscalYearId) {
      loadAccountsForFiscalYear(selectedFiscalYearId)
    }
  }, [selectedFiscalYearId])

  // Initialize fiscal year from initialData or load most recent
  useEffect(() => {
    if (initialData?.fiscalYearId) {
      setSelectedFiscalYearId(initialData.fiscalYearId)
    } else if (companyId && !selectedFiscalYearId) {
      // Load most recent fiscal year
      fetch(`/api/companies/${companyId}/fiscal-years`)
        .then((res) => res.json())
        .then((fiscalYears) => {
          if (fiscalYears && fiscalYears.length > 0) {
            // Sort by year descending and take the first (most recent)
            const sorted = [...(fiscalYears as Array<{ id: string; year: number }>)].sort((a, b) => b.year - a.year)
            setSelectedFiscalYearId(sorted[0].id)
          }
        })
        .catch((err) => {
          logger.error('Error loading fiscal years:', err)
        })
    }
  }, [companyId, initialData?.fiscalYearId])

  const loadAccountsForFiscalYear = async (fiscalYearId: string) => {
    if (!fiscalYearId) return

    setLoadingAccounts(true)
    try {
      const response = await fetch(`/api/accounts?companyId=${companyId}&fiscalYearId=${fiscalYearId}`)
      if (response.ok) {
        const accountsData = await response.json()
        setAccounts(accountsData)
      } else {
        logger.error('Error loading accounts for fiscal year')
        toast.error('Erreur lors du chargement des comptes')
      }
    } catch (error) {
      logger.error('Error loading accounts:', error)
      toast.error('Erreur lors du chargement des comptes')
    } finally {
      setLoadingAccounts(false)
    }
  }

  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: 'lines',
  })

  // Reset form when initialData is set (e.g. edit mode). Depend on entryId so we only
  // run when editing a specific entry, avoiding loops from unstable initialData reference.
  useEffect(() => {
    if (!initialData) return

    const formattedLines = initialData.lines.map((line) => ({
      accountId: line.accountId || '',
      debit: line.debit || 0,
      credit: line.credit || 0,
      description: line.description ?? undefined,
    }))

    const formattedData = {
      ...initialData,
      description: initialData.description ?? undefined,
      reference: initialData.reference ?? undefined,
      lines: formattedLines,
    }

    replace(formattedLines)
    reset(formattedData)
  }, [entryId, initialData, reset, replace])

  // Drafts have no number: show the number the next validation will give
  useEffect(() => {
    if (!companyId) return
    fetch(`/api/entries/next-number?companyId=${companyId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.nextNumber) {
          setNextEntryNumber(data.nextNumber)
        }
      })
      .catch((err) => {
        logger.error('Error fetching next entry number:', err)
      })
  }, [companyId])

  const watchedLines = watch('lines')
  const debitCents = totalCents(watchedLines, 'debit')
  const creditCents = totalCents(watchedLines, 'credit')
  const totalDebit = Number(debitCents) / 100
  const totalCredit = Number(creditCents) / 100
  const title = entryId ? "Modifier l'écriture" : 'Nouvelle écriture'
  const isBalanced = debitCents === creditCents

  const onSubmit = async (data: EntryFormData) => {
    setLoading(true)
    setError(null)

    if (!selectedFiscalYearId) {
      setError("Choisissez l'exercice de l'écriture.")
      toast.error("Choisissez l'exercice de l'écriture.")
      setLoading(false)
      return
    }

    try {
      const url = entryId ? `/api/entries/${entryId}` : '/api/entries'
      const method = entryId ? 'PATCH' : 'POST'
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          companyId,
          fiscalYearId: selectedFiscalYearId,
          ...data,
        }),
      })

      if (response.ok) {
        toast.success(entryId ? 'Écriture modifiée avec succès' : 'Écriture créée avec succès')
        router.push(`/${companyId}/entries`)
        router.refresh()
      } else {
        const errorData = await response.json()
        const errorMessage = errorData.error || (entryId ? 'Erreur lors de la modification' : 'Erreur lors de la création')
        setError(errorMessage)
        toast.error(errorMessage)
      }
    } catch (error) {
      logger.error(`Error ${entryId ? 'updating' : 'creating'} entry:`, error)
      const errorMessage = entryId ? 'Erreur lors de la modification de l\'écriture' : 'Erreur lors de la création de l\'écriture'
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {!hideTitle && (
        <PageHeader
          title={title}
          description={
            entryId
              ? "Un brouillon reste modifiable jusqu'à sa validation."
              : "Chaque écriture équilibre ses débits et ses crédits. Elle reste un brouillon modifiable jusqu'à sa validation."
          }
        />
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Informations générales</CardTitle>
            <CardDescription>Le journal, la date et la pièce justificative de l&apos;écriture.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-4">
              <FiscalYearSelector
                companyId={companyId}
                value={selectedFiscalYearId}
                onValueChange={setSelectedFiscalYearId}
                disabled={!!entryId}
              />
              {loadingAccounts && (
                <p className="text-xs text-muted-foreground">
                  Chargement des comptes...
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Journal" htmlFor="journalId" required error={errors.journalId?.message}>
                <Controller
                  name="journalId"
                  control={control}
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger id="journalId" className="w-full" aria-invalid={errors.journalId ? true : undefined}>
                        <SelectValue placeholder="Choisir un journal" />
                      </SelectTrigger>
                      <SelectContent>
                        {journals.map((journal) => (
                          <SelectItem key={journal.id} value={journal.id}>
                            <span className="font-mono text-xs">{journal.code}</span> {journal.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <Field
                label="Numéro d'écriture"
                hint={
                  nextEntryNumber
                    ? `Un brouillon n'a pas de numéro\u00a0: il le reçoit à sa validation, sans rupture de séquence (prochain numéro\u00a0: ${nextEntryNumber}).`
                    : "Un brouillon n'a pas de numéro\u00a0: il le reçoit à sa validation, sans rupture de séquence."
                }
              >
                <Input id="entryNumber" value="Attribué à la validation" disabled readOnly />
              </Field>

              <Field label="Date" htmlFor="date" required error={errors.date?.message}>
                <Controller
                  name="date"
                  control={control}
                  render={({ field }) => (
                    <DatePicker
                      id="date"
                      date={field.value ? isoDateToLocal(field.value) : undefined}
                      onDateChange={(d) => field.onChange(d ? localDateToIso(d) : '')}
                      placeholder="Choisir la date de l'écriture"
                    />
                  )}
                />
              </Field>

              <Field label="Référence" optional>
                <Input id="reference" {...register('reference')} placeholder="ex. FA-2026-042" />
              </Field>
            </div>

            <Field label="Description" optional>
              <Input id="description" {...register('description')} placeholder="ex. Loyer de mars" />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lignes d&apos;écriture</CardTitle>
            <CardDescription>Une ligne par compte mouvementé&nbsp;: le total des débits égale celui des crédits.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/*
              One grid row per line on wide containers, one card per line on
              narrow ones (phones): the same fields, so nothing typed is lost
              when the screen rotates. Column titles are shown once above the
              rows, or as small labels inside each card.
            */}
            <div className="@container/lines">
              <div
                aria-hidden
                className="text-muted-foreground hidden h-9 grid-cols-[minmax(0,1fr)_12rem_9rem_9rem_2.75rem] items-center gap-3 border-b px-1 text-xs font-medium @min-[44rem]/lines:grid"
              >
                <span>Compte</span>
                <span>Libellé</span>
                <span className="text-right">Débit</span>
                <span className="text-right">Crédit</span>
                <span />
              </div>
              <ol className="space-y-3 @min-[44rem]/lines:space-y-0">
                {fields.map((field, index) => {
                  const n = index + 1
                  return (
                    <li
                      key={field.id}
                      aria-label={`Ligne ${n}`}
                      className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border p-3 @min-[44rem]/lines:grid-cols-[minmax(0,1fr)_12rem_9rem_9rem_2.75rem] @min-[44rem]/lines:items-center @min-[44rem]/lines:rounded-none @min-[44rem]/lines:border-0 @min-[44rem]/lines:border-b @min-[44rem]/lines:px-1 @min-[44rem]/lines:py-2"
                    >
                      <div className="col-start-1 row-start-1 flex items-center @min-[44rem]/lines:hidden">
                        <span className="text-sm font-medium">Ligne {n}</span>
                      </div>
                      <div className="col-span-2 min-w-0 space-y-1 @min-[44rem]/lines:col-span-1 @min-[44rem]/lines:space-y-0">
                        <span aria-hidden className="text-muted-foreground block text-xs @min-[44rem]/lines:hidden">
                          Compte
                        </span>
                        <Label htmlFor={`line-${index}-account`} className="sr-only">
                          Compte, ligne {n}
                        </Label>
                        <Controller
                          name={`lines.${index}.accountId`}
                          control={control}
                          render={({ field: fieldController }) => (
                            <AccountCombobox
                              id={`line-${index}-account`}
                              label={`Compte, ligne ${n}`}
                              accounts={accounts}
                              value={fieldController.value || 'none'}
                              onValueChange={(value) => fieldController.onChange(value === 'none' ? '' : value)}
                              placeholder="Choisir un compte"
                            />
                          )}
                        />
                      </div>
                      <div className="col-span-2 min-w-0 space-y-1 @min-[44rem]/lines:col-span-1 @min-[44rem]/lines:space-y-0">
                        <span aria-hidden className="text-muted-foreground block text-xs @min-[44rem]/lines:hidden">
                          Libellé
                        </span>
                        <Input {...register(`lines.${index}.description`)} placeholder="Libellé" aria-label={`Libellé, ligne ${n}`} />
                      </div>
                      {(['debit', 'credit'] as const).map((side) => (
                        <div key={side} className="min-w-0 space-y-1 @min-[44rem]/lines:space-y-0">
                          <span aria-hidden className="text-muted-foreground block text-xs @min-[44rem]/lines:hidden">
                            {side === 'debit' ? 'Débit' : 'Crédit'}
                          </span>
                          <Controller
                            name={`lines.${index}.${side}`}
                            control={control}
                            render={({ field: amount }) => {
                              const cents = parseCents(amount.value || 0) ?? 0
                              return (
                                <AmountInput
                                  aria-label={`${side === 'debit' ? 'Débit' : 'Crédit'}, ligne ${n}`}
                                  placeholder="0,00"
                                  allowNegative
                                  value={cents === 0 ? null : cents}
                                  onValueChange={(next) => amount.onChange(next === null ? 0 : next / 100)}
                                  onBlur={amount.onBlur}
                                />
                              )
                            }}
                          />
                        </div>
                      ))}
                      {/* First row of the card on narrow containers, last column on wide ones */}
                      <div className="col-start-2 row-start-1 flex justify-end @min-[44rem]/lines:col-start-auto @min-[44rem]/lines:row-start-auto">
                        {fields.length > 2 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="hover:text-destructive"
                            onClick={() => remove(index)}
                            aria-label={`Supprimer la ligne ${n}`}
                            title={`Supprimer la ligne ${n}`}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
              <div className="grid grid-cols-2 gap-3 px-1 pt-3 text-sm font-medium @min-[44rem]/lines:grid-cols-[minmax(0,1fr)_12rem_9rem_9rem_2.75rem] @min-[44rem]/lines:items-center">
                <span className="hidden text-right @min-[44rem]/lines:col-span-2 @min-[44rem]/lines:block">Total</span>
                <p className="flex items-baseline justify-between gap-2 @min-[44rem]/lines:block @min-[44rem]/lines:text-right">
                  <span className="text-muted-foreground text-xs font-normal @min-[44rem]/lines:sr-only">Total débit</span>{' '}
                  <Amount value={totalDebit} />
                </p>
                <p className="flex items-baseline justify-between gap-2 @min-[44rem]/lines:block @min-[44rem]/lines:text-right">
                  <span className="text-muted-foreground text-xs font-normal @min-[44rem]/lines:sr-only">Total crédit</span>{' '}
                  <Amount value={totalCredit} />
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ accountId: '', debit: 0, credit: 0, description: '' })}
            >
              <Plus aria-hidden />
              Ajouter une ligne
            </Button>

            {!isBalanced && (
              <Alert variant="destructive">
                <AlertDescription>
                  Le total débit ({formatAmount(totalDebit)}) doit être égal au total crédit ({formatAmount(totalCredit)}).
                </AlertDescription>
              </Alert>
            )}

            {errors.lines && (
              <Alert variant="destructive">
                <AlertDescription>{errors.lines.message}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/*
          Phones: the actions stay at the bottom of the screen above the home
          indicator while the lines are typed, with the balance in view.
        */}
        <div className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <p className="text-muted-foreground num w-full text-xs sm:hidden" aria-hidden>
            {isBalanced ? 'Écriture équilibrée' : `Écart de ${formatAmount(Number(debitCents > creditCents ? debitCents - creditCents : creditCents - debitCents) / 100)} entre débit et crédit`}
          </p>
          <Button type="submit" loading={loading} disabled={!isBalanced}>
            Enregistrer
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/${companyId}/entries`)}
          >
            Annuler
          </Button>
        </div>
      </form>
    </div>
  )
}
