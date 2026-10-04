'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DatePicker } from '@/components/ui/date-picker'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { CalendarPlus, Plus, AlertCircle, Loader2, CheckCircle2, XCircle, AlertTriangle, Info, ExternalLink } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { FiscalYearsTable } from '@/components/features/accounting/fiscal-years-table'
import { ResultAllocationDialog } from '@/components/features/accounting/result-allocation-dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { Amount, ConfirmDeleteDialog, EmptyState, PageHeader, formatAmount, formatDisplayDate } from '@/components/shared'
import { OpeningBalanceNotice } from '@/components/features/accounting/opening-balance-notice'
import { plural, pluralWord } from '@/lib/utils/plural'
import { docsUrl } from '@/lib/docs-links'
import { defaultFiscalYearDates } from '@/lib/accounting/default-fiscal-year-dates'

interface FiscalYear {
  id: string
  year: number
  closingDay: number | null
  closingMonth: number | null
  startDate: string
  endDate: string
  isClosed: boolean
}

const fiscalYearSchema = z.object({
  year: z.number().min(2000).max(2100),
  startDate: z.string().min(1, 'La date de début est requise'),
  endDate: z.string().min(1, 'La date de fin est requise'),
})

type FiscalYearFormData = z.infer<typeof fiscalYearSchema>

export default function FiscalYearsPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closingFiscalYearId, setClosingFiscalYearId] = useState<string | null>(null)
  const [closeDialogOpen, setCloseDialogOpen] = useState(false)
  const [closingErrors, setClosingErrors] = useState<string[]>([])
  const [closingWarnings, setClosingWarnings] = useState<string[]>([])
  const [isClosing, setIsClosing] = useState(false)
  const [simulation, setSimulation] = useState<any>(null)
  const [loadingSimulation, setLoadingSimulation] = useState(false)
  const [editingFiscalYear, setEditingFiscalYear] = useState<FiscalYear | null>(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [fiscalYearToDelete, setFiscalYearToDelete] = useState<FiscalYear | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const [companyData, setCompanyData] = useState<any>(null)
  const [allocationYear, setAllocationYear] = useState<FiscalYear | null>(null)

  const loadFiscalYears = useCallback(async () => {
    if (!companyId) {
      setLoading(false)
      return
    }

    try {
      const response = await fetch(`/api/companies/${companyId}`)
      if (response.ok) {
        const companyDataResponse = await response.json()
        setCompanyData(companyDataResponse)
        setFiscalYears(companyDataResponse.fiscalYears || [])
      }
    } catch (error) {
      logger.error('Error loading fiscal years:', error)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    loadFiscalYears()
  }, [loadFiscalYears])

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
    setValue,
  } = useForm<FiscalYearFormData>({
    resolver: zodResolver(fiscalYearSchema),
    defaultValues: {
      year: new Date().getFullYear(),
      startDate: '',
      endDate: '',
    },
  })

  // Calculer automatiquement les dates quand l'année change ou quand le dialog s'ouvre
  useEffect(() => {
    const year = watch('year')

    if (year && companyData) {
      // Clamped to the length of the month, like the server (29 February in a common year is the 28th)
      const { startDate, endDate } = defaultFiscalYearDates({
        year,
        closingDay: companyData.closingDay,
        closingMonth: companyData.closingMonth,
        foundationDate: companyData.foundationDate,
        isFirstFiscalYear: fiscalYears.length === 0,
      })
      setValue('startDate', startDate)
      setValue('endDate', endDate)
    }
  }, [watch('year'), fiscalYears.length, companyData, setValue, dialogOpen])

  const onSubmit = async (data: FiscalYearFormData) => {
    if (!companyId) return

    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch(`/api/companies/${companyId}/fiscal-years`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })

      if (response.ok) {
        setDialogOpen(false)
        reset({
          year: new Date().getFullYear(),
          startDate: '',
          endDate: '',
        })
        await loadFiscalYears()
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Erreur lors de la création de l\'exercice')
      }
    } catch (error) {
      logger.error('Error creating fiscal year:', error)
      setError('Erreur lors de la création de l\'exercice')
    } finally {
      setSubmitting(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  }

  const formatDateShort = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  }

  const handleCloseFiscalYear = async () => {
    if (!closingFiscalYearId || !companyId) return

    setIsClosing(true)
    setClosingErrors([])

    try {
      const response = await fetch(
        `/api/companies/${companyId}/fiscal-years/${closingFiscalYearId}/close`,
        {
          method: 'POST',
        }
      )

      if (response.ok) {
        const data = await response.json().catch(() => ({}))
        toast.success(
          typeof data.result === 'number'
            ? `Exercice clôturé\u00a0: résultat de ${formatAmount(data.result)}`
            : 'Exercice clôturé avec succès'
        )
        setCloseDialogOpen(false)
        setClosingFiscalYearId(null)
        await loadFiscalYears()
      } else {
        const errorData = await response.json()
        if (errorData.details && Array.isArray(errorData.details)) {
          setClosingErrors(errorData.details)
        } else {
          setClosingErrors([errorData.error || 'Erreur lors de la clôture'])
        }
      }
    } catch (error) {
      logger.error('Error closing fiscal year:', error)
      setClosingErrors(['Erreur lors de la clôture de l\'exercice'])
    } finally {
      setIsClosing(false)
    }
  }

  const openCloseDialog = async (fiscalYearId: string) => {
    setClosingFiscalYearId(fiscalYearId)
    setClosingErrors([])
    setClosingWarnings([])
    setSimulation(null)
    setCloseDialogOpen(true)
    
    // Load simulation
    if (companyId) {
      setLoadingSimulation(true)
      try {
        const response = await fetch(
          `/api/companies/${companyId}/fiscal-years/${fiscalYearId}/close/simulate`
        )
        if (response.ok) {
          const data = await response.json()
          setSimulation(data)
          setClosingWarnings(data.warnings || [])
        } else {
          // Blocked closing: the reasons and, when it could be computed, the simulation on the entries as they are
          const errorData = await response.json()
          setClosingErrors(errorData.details?.length ? errorData.details : [errorData.error || 'La simulation de la clôture a échoué.'])
          setClosingWarnings(errorData.warnings || [])
          setSimulation(errorData.simulation ?? null)
        }
      } catch (error) {
        logger.error('Error loading simulation:', error)
        setClosingErrors(['Erreur lors du chargement de la simulation'])
      } finally {
        setLoadingSimulation(false)
      }
    }
  }

  const openEditDialog = (fiscalYear: FiscalYear) => {
    setEditingFiscalYear(fiscalYear)
    setUpdateError(null)
    setEditDialogOpen(true)
  }

  const openDeleteDialog = (fiscalYear: FiscalYear) => {
    setFiscalYearToDelete(fiscalYear)
    setDeleteDialogOpen(true)
  }

  const handleDeleteFiscalYear = async () => {
    if (!fiscalYearToDelete || !companyId) return

    setIsDeleting(true)
    try {
      const response = await fetch(
        `/api/companies/${companyId}/fiscal-years/${fiscalYearToDelete.id}`,
        { method: 'DELETE' }
      )

      if (response.ok) {
        toast.success('Exercice supprimé')
        setDeleteDialogOpen(false)
        setFiscalYearToDelete(null)
        await loadFiscalYears()
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Erreur lors de la suppression')
      }
    } catch (error) {
      logger.error('Error deleting fiscal year:', error)
      toast.error('Erreur lors de la suppression')
    } finally {
      setIsDeleting(false)
    }
  }

  const {
    register: registerEdit,
    handleSubmit: handleSubmitEdit,
    formState: { errors: editErrors },
    reset: resetEdit,
    watch: watchEdit,
    setValue: setValueEdit,
  } = useForm<FiscalYearFormData>({
    resolver: zodResolver(fiscalYearSchema),
  })

  // Initialiser le formulaire d'édition quand l'exercice change
  useEffect(() => {
    if (editingFiscalYear) {
      setValueEdit('startDate', editingFiscalYear.startDate.split('T')[0])
      setValueEdit('endDate', editingFiscalYear.endDate.split('T')[0])
    }
  }, [editingFiscalYear, setValueEdit])

  const onEditSubmit = async (data: FiscalYearFormData) => {
    if (!editingFiscalYear || !companyId) return

    setUpdating(true)
    setUpdateError(null)

    try {
      const response = await fetch(
        `/api/companies/${companyId}/fiscal-years/${editingFiscalYear.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            startDate: data.startDate,
            endDate: data.endDate,
          }),
        }
      )

      if (response.ok) {
        setEditDialogOpen(false)
        setEditingFiscalYear(null)
        resetEdit()
        await loadFiscalYears()
        toast.success('Exercice modifié avec succès')
      } else {
        const errorData = await response.json()
        setUpdateError(errorData.error || 'Erreur lors de la modification de l\'exercice')
      }
    } catch (error) {
      logger.error('Error updating fiscal year:', error)
      setUpdateError('Erreur lors de la modification de l\'exercice')
    } finally {
      setUpdating(false)
    }
  }

  if (!companyId) {
    return (
      <NoCompanySelected 
        description="Veuillez sélectionner une société pour voir les exercices comptables"
      />
    )
  }

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Chargement des exercices">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exercices"
        description="Un exercice est la période (12 mois en général) sur laquelle la société arrête ses comptes&nbsp;: bilan, compte de résultat et FEC."
        docsHref={docsUrl('fiscalYear')}
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus aria-hidden />
              Ajouter un exercice
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ajouter un exercice</DialogTitle>
              <DialogDescription>
                Créez un nouvel exercice comptable pour {companyData?.name || 'la société'}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)}>
              <div className="space-y-4 py-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2">
                  <Label htmlFor="year">Année de l'exercice *</Label>
                  <Select
                    value={watch('year')?.toString() || ''}
                    onValueChange={(value) => setValue('year', parseInt(value, 10))}
                  >
                    <SelectTrigger id="year">
                      <SelectValue placeholder="Sélectionner une année" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 20 }, (_, i) => {
                        const year = new Date().getFullYear() - 10 + i
                        return (
                          <SelectItem key={year} value={year.toString()}>
                            {year}
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                  {errors.year && (
                    <p className="text-sm text-destructive">{errors.year.message}</p>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="startDate">Date de début *</Label>
                    <DatePicker
                      id="startDate"
                      date={watch('startDate') ? new Date(watch('startDate') + 'T00:00:00') : undefined}
                      onDateChange={(date) => {
                        if (date) {
                          const year = date.getFullYear()
                          const month = String(date.getMonth() + 1).padStart(2, '0')
                          const day = String(date.getDate()).padStart(2, '0')
                          setValue('startDate', `${year}-${month}-${day}`)
                        } else {
                          setValue('startDate', '')
                        }
                      }}
                      placeholder="Date de début"
                    />
                    {fiscalYears.length === 0 && companyData?.foundationDate && (
                      <p className="text-xs text-muted-foreground">
                        Pour le premier exercice, la date de création de la société est utilisée automatiquement.
                      </p>
                    )}
                    {errors.startDate && (
                      <p className="text-sm text-destructive">{errors.startDate.message}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="endDate">Date de fin *</Label>
                    <DatePicker
                      id="endDate"
                      date={watch('endDate') ? new Date(watch('endDate') + 'T00:00:00') : undefined}
                      onDateChange={(date) => {
                        // Permettre la modification manuelle si nécessaire
                        if (date) {
                          const year = date.getFullYear()
                          const month = String(date.getMonth() + 1).padStart(2, '0')
                          const day = String(date.getDate()).padStart(2, '0')
                          setValue('endDate', `${year}-${month}-${day}`)
                        } else {
                          setValue('endDate', '')
                        }
                      }}
                      placeholder="Date de fin (calculée automatiquement)"
                    />
                    {companyData && watch('year') && (
                      <p className="text-xs text-muted-foreground">
                        Calculée automatiquement&nbsp;: {companyData.closingDay || 31} {companyData.closingMonth ? new Date(2000, companyData.closingMonth - 1).toLocaleDateString('fr-FR', { month: 'long' }) : 'décembre'} {watch('year')}
                      </p>
                    )}
                    {errors.endDate && (
                      <p className="text-sm text-destructive">{errors.endDate.message}</p>
                    )}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Annuler
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Création...' : 'Créer'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        }
      />

      {fiscalYears.length === 0 ? (
        <EmptyState
          bordered
          icon={CalendarPlus}
          title="Aucun exercice pour cette société"
          description="Créez le premier exercice pour pouvoir saisir des écritures. Pour une société créée en cours d'année, le premier exercice commence à la date de création."
          action={
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus aria-hidden />
              Ajouter un exercice
            </Button>
          }
          docsHref={docsUrl('fiscalYear')}
        />
      ) : (
        <>
        <OpeningBalanceNotice
          companyId={companyId}
          foundationDate={companyData?.foundationDate ?? null}
          firstFiscalYearStart={
            [...fiscalYears].sort((a, b) => a.startDate.localeCompare(b.startDate))[0]?.startDate ?? null
          }
        />
        <FiscalYearsTable
          data={fiscalYears}
          onClose={openCloseDialog}
          onEdit={openEditDialog}
          onDelete={openDeleteDialog}
          onAllocate={(fiscalYear) => setAllocationYear(fiscalYear)}
          formatDateShort={formatDateShort}
        />
        </>
      )}

      <ResultAllocationDialog
        companyId={companyId}
        fiscalYear={allocationYear}
        open={allocationYear !== null}
        onOpenChange={(open) => {
          if (!open) setAllocationYear(null)
        }}
        onDone={loadFiscalYears}
      />

      <AlertDialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <AlertDialogContent className="sm:max-w-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Clôturer l'exercice</AlertDialogTitle>
            <AlertDialogDescription>
              La clôture solde les comptes de charges et de produits dans le résultat (compte 120 ou 129, journal CL),
              crée l'exercice suivant avec ses comptes et reporte les soldes des comptes de bilan (journal AN). Elle est
              définitive et sans réouverture possible&nbsp;: aucune écriture de l'exercice clôturé ne pourra plus être ajoutée,
              modifiée ni supprimée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          {closingErrors.length > 0 && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-semibold mb-2">
                  {pluralWord(closingErrors.length, 'Ce point bloque la clôture', 'Ces points bloquent la clôture')}&nbsp;:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  {closingErrors.map((error, index) => (
                    <li key={index} className="text-sm">{error}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {closingWarnings.length > 0 && (
            <Alert className="mt-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-semibold mb-2">À vérifier avant de clôturer&nbsp;:</p>
                <ul className="list-disc list-inside space-y-1">
                  {closingWarnings.map((warning, index) => (
                    <li key={index} className="text-sm">{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {loadingSimulation ? (
            <div className="space-y-3 py-4" aria-busy="true" aria-label="Chargement de la simulation">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : simulation ? (
            <div className="space-y-6 mt-4">
              {closingErrors.length > 0 ? (
                <p className="text-muted-foreground text-sm">
                  Simulation sur les écritures actuelles&nbsp;: elle évoluera une fois les points ci-dessus réglés.
                </p>
              ) : null}
              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold mb-2">Nouvel exercice</h4>
                  <div className="bg-muted p-3 rounded-md">
                    <p className="text-sm">
                      <span className="font-medium">Année&nbsp;:</span> {simulation.nextFiscalYear.year}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Période&nbsp;:</span> du {formatDisplayDate(simulation.nextFiscalYear.startDate)} au{' '}
                      {formatDisplayDate(simulation.nextFiscalYear.endDate)}
                    </p>
                  </div>
                </div>

                {simulation.closingEntries?.result && (
                  <div>
                    <h4 className="font-semibold mb-2">Résultat de l&apos;exercice</h4>
                    <div className="bg-muted p-3 rounded-md">
                      <p className="text-sm">
                        <Amount value={simulation.closingEntries.result.amount} className="font-medium" /> porté au compte{' '}
                        {simulation.closingEntries.result.accountCode} ({simulation.closingEntries.result.accountLabel}), en attente
                        d&apos;affectation par les associés.
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {plural(simulation.closingEntries.incomeStatement.accountsToClose, 'compte')} de charges et de produits{' '}
                        {pluralWord(simulation.closingEntries.incomeStatement.accountsToClose, 'soldé', 'soldés')} par l&apos;écriture de
                        clôture.
                      </p>
                    </div>
                  </div>
                )}

                <div>
                  <h4 className="font-semibold mb-2">Comptes à créer</h4>
                  <div className="bg-muted p-3 rounded-md">
                    <p className="text-sm mb-2">
                      <span className="font-medium">{plural(simulation.accountsToCreate, 'compte')}</span>{' '}
                      {simulation.accountsToCreate === 0
                        ? 'à créer\u00a0: le nouvel exercice a déjà tous les comptes'
                        : `${pluralWord(simulation.accountsToCreate, 'sera créé', 'seront créés')} pour le nouvel exercice`}
                    </p>
                    {simulation.accountsPreview.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs text-muted-foreground mb-1">Aperçu (premiers comptes)&nbsp;:</p>
                        <div className="max-h-32 overflow-y-auto space-y-1">
                          {simulation.accountsPreview.map((acc: { code: string; label: string }, idx: number) => (
                            <div key={idx} className="text-xs">
                              <span className="font-mono">{acc.code}</span> {acc.label}
                            </div>
                          ))}
                        </div>
                        {simulation.accountsToCreate > simulation.accountsPreview.length && (
                          <p className="text-xs text-muted-foreground mt-1">
                            et {plural(simulation.accountsToCreate - simulation.accountsPreview.length, 'autre compte', 'autres comptes')}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Écriture d&apos;ouverture (à-nouveaux)</h4>
                  <div className="bg-muted p-3 rounded-md space-y-2">
                    <p className="text-sm">
                      {simulation.openingEntries.entryCount === 0
                        ? "Aucune écriture d'ouverture\u00a0: aucun compte de bilan n'a de solde."
                        : `${plural(simulation.openingEntries.entryCount, "écriture d'ouverture", "écritures d'ouverture")} de ${plural(simulation.openingEntries.totalLines, 'ligne')}, pour ${plural(simulation.openingEntries.accountsWithBalance, 'compte')} de bilan avec un solde.`}
                    </p>
                    <div className="mt-3 pt-3 border-t">
                      <p className="text-xs font-medium mb-2">Total de l&apos;écriture d&apos;ouverture&nbsp;:</p>
                      <div className="grid gap-2 text-xs sm:grid-cols-2">
                        <div>
                          <span className="text-muted-foreground">Débit&nbsp;:</span>{' '}
                          <Amount value={simulation.openingEntries.totalDebit} className="font-medium" />
                        </div>
                        <div>
                          <span className="text-muted-foreground">Crédit&nbsp;:</span>{' '}
                          <Amount value={simulation.openingEntries.totalCredit} className="font-medium" />
                        </div>
                      </div>
                    </div>
                    {simulation.openingEntries.preview.length > 0 && (
                      <div className="mt-3 pt-3 border-t">
                        <p className="text-xs text-muted-foreground mb-2">Aperçu des comptes avec solde&nbsp;:</p>
                        <div className="max-h-40 overflow-y-auto space-y-1">
                          {simulation.openingEntries.preview.map(
                            (item: { accountCode: string; accountLabel: string; balance: number }, idx: number) => (
                              <div key={idx} className="text-xs flex items-center justify-between gap-3">
                                <span className="min-w-0 truncate">
                                  <span className="font-mono">{item.accountCode}</span> {item.accountLabel}
                                </span>
                                <Amount value={item.balance} />
                              </div>
                            ),
                          )}
                        </div>
                        {simulation.openingEntries.accountsWithBalance > simulation.openingEntries.preview.length && (
                          <p className="text-xs text-muted-foreground mt-1">
                            et{' '}
                            {plural(
                              simulation.openingEntries.accountsWithBalance - simulation.openingEntries.preview.length,
                              'autre compte',
                              'autres comptes',
                            )}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Phones: the long simulation scrolls under the actions, which stay in reach. */}
          <AlertDialogFooter className="max-sm:bg-background max-sm:sticky max-sm:-bottom-6 max-sm:-mx-6 max-sm:border-t max-sm:px-6 max-sm:py-3">
            <AlertDialogCancel disabled={isClosing}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCloseFiscalYear}
              disabled={isClosing || closingErrors.length > 0 || loadingSimulation}
            >
              {isClosing ? 'Clôture en cours...' : 'Confirmer la clôture'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={`Supprimer l'exercice ${fiscalYearToDelete?.year ?? ''} ?`}
        description="L'exercice sera supprimé définitivement. Un exercice qui contient des écritures ne peut pas être supprimé."
        loading={isDeleting}
        onConfirm={() => handleDeleteFiscalYear()}
      />

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier l'exercice {editingFiscalYear?.year}</DialogTitle>
            <DialogDescription>
              Modifiez les dates de début et de fin de l'exercice. Seuls les exercices non clôturés peuvent être modifiés.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmitEdit(onEditSubmit)}>
            <div className="space-y-4 py-4">
              {updateError && (
                <Alert variant="destructive">
                  <AlertDescription>{updateError}</AlertDescription>
                </Alert>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-startDate">Date de début *</Label>
                  <DatePicker
                    id="edit-startDate"
                    date={watchEdit('startDate') ? new Date(watchEdit('startDate') + 'T00:00:00') : undefined}
                    onDateChange={(date) => {
                      if (date) {
                        const year = date.getFullYear()
                        const month = String(date.getMonth() + 1).padStart(2, '0')
                        const day = String(date.getDate()).padStart(2, '0')
                        setValueEdit('startDate', `${year}-${month}-${day}`)
                      } else {
                        setValueEdit('startDate', '')
                      }
                    }}
                    placeholder="Date de début"
                  />
                  {editErrors.startDate && (
                    <p className="text-sm text-destructive">{editErrors.startDate.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-endDate">Date de fin *</Label>
                  <DatePicker
                    id="edit-endDate"
                    date={watchEdit('endDate') ? new Date(watchEdit('endDate') + 'T00:00:00') : undefined}
                    onDateChange={(date) => {
                      if (date) {
                        const year = date.getFullYear()
                        const month = String(date.getMonth() + 1).padStart(2, '0')
                        const day = String(date.getDate()).padStart(2, '0')
                        setValueEdit('endDate', `${year}-${month}-${day}`)
                      } else {
                        setValueEdit('endDate', '')
                      }
                    }}
                    placeholder="Date de fin"
                  />
                  {editErrors.endDate && (
                    <p className="text-sm text-destructive">{editErrors.endDate.message}</p>
                  )}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={updating}>
                {updating ? 'Modification...' : 'Modifier'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
