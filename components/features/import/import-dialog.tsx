'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FileInput } from '@/components/ui/file-input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { Checkbox } from '@/components/ui/checkbox'
import { logger } from '@/lib/logger'
import { CheckCircle2, XCircle, AlertCircle, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatAmount, formatDisplayDate } from '@/components/shared'
import { ColumnMapping } from '@/components/features/import/column-mapping'
import { AccountMappingComponent } from '@/components/features/import/account-mapping'
import type { FECColumnMapping } from '@/lib/import/types'
import { accountingImportAccept } from '@/components/features/import/file-accept'

interface FiscalYearInfo {
  id: string
  year: number
  startDate: string
  endDate: string
  wasCreated: boolean
  entriesCount: number
  linesCount: number
  accountsCount?: number
  journalsCount?: number
}

interface ExistingFiscalYear {
  id: string
  year: number
  startDate: string
  endDate: string
}

export interface ImportResult {
  success: boolean
  entriesCreated?: number
  accountsCreated?: number
  journalsCreated?: number
  errors?: string[]
  /** FEC import: entries refused (the import is then entirely cancelled). */
  refused?: Array<{ entry: string; line: number; reason: string }>
  /** FEC import: imported anyway, worth checking. */
  warnings?: string[]
  message?: string
  fiscalYears?: FiscalYearInfo[]
}

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  onImportSuccess?: (result: ImportResult) => void
}

export function ImportDialog({
  open,
  onOpenChange,
  companyId,
  onImportSuccess,
}: ImportDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [type, setType] = useState<'fec' | 'csv' | 'excel'>('fec')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [showColumnMapping, setShowColumnMapping] = useState(false)
  const [showAccountMapping, setShowAccountMapping] = useState(false)
  const [showFiscalYearSelection, setShowFiscalYearSelection] = useState(false)
  const [selectedFiscalYearForMapping, setSelectedFiscalYearForMapping] = useState<FiscalYearInfo | null>(null)
  const [addingPCG, setAddingPCG] = useState(false)
  const [addingOptionalPCG, setAddingOptionalPCG] = useState(false)
  const [pcgAdded, setPcgAdded] = useState(false)
  const [columnMapping, setColumnMapping] = useState<FECColumnMapping | null>(null)
  const [cleanEntryNumbers, setCleanEntryNumbers] = useState(false)
  const [fiscalYearsPreview, setFiscalYearsPreview] = useState<FiscalYearInfo[] | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [showSuccessDialog, setShowSuccessDialog] = useState(false)
  const [existingFiscalYears, setExistingFiscalYears] = useState<ExistingFiscalYear[]>([])
  const [loadingExistingFiscalYears, setLoadingExistingFiscalYears] = useState(false)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      // Détecter le type automatiquement
      const extension = selectedFile.name.split('.').pop()?.toLowerCase()
      if (extension === 'fec' || extension === 'txt') {
        // Les fichiers .txt peuvent être des FEC
        setType('fec')
        // Lire le contenu pour le mapping
        try {
          const content = await selectedFile.text()
          setFileContent(content)
          setColumnMapping(null)
          setShowAccountMapping(false)
          setError(null)
          setFiscalYearsPreview(null)
          // Fermer le dialog principal et ouvrir le dialog de mapping des colonnes
          setShowColumnMapping(true)
          onOpenChange(false)
        } catch (err) {
          setError('Erreur lors de la lecture du fichier')
        }
      } else if (extension === 'csv') {
        setType('csv')
        setShowColumnMapping(false)
        setFileContent(null)
        setFiscalYearsPreview(null)
      } else if (extension === 'xlsx' || extension === 'xls') {
        setType('excel')
        setShowColumnMapping(false)
        setFileContent(null)
        setFiscalYearsPreview(null)
      }
    }
  }

  const previewFiscalYears = async (
    content: string,
    mapping?: FECColumnMapping | null
  ): Promise<FiscalYearInfo[] | null> => {
    if (!companyId || type !== 'fec') return null

    setLoadingPreview(true)
    try {
      const response = await fetch('/api/import/preview-fiscal-years', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          content,
          mapping: mapping ?? undefined,
        }),
      })
      
      if (response.ok) {
        const preview = await response.json()
        setFiscalYearsPreview(preview)
        return preview
      }
      return null
    } catch (error) {
      logger.error('Error previewing fiscal years:', error)
      return null
    } finally {
      setLoadingPreview(false)
    }
  }

  const [accountMapping, setAccountMapping] = useState<Record<string, string | null>>({})
  const [journalMapping, setJournalMapping] = useState<Record<string, string | null>>({})

  useEffect(() => {
    if (!showFiscalYearSelection || !companyId) return
    setLoadingExistingFiscalYears(true)
    fetch(`/api/companies/${companyId}/fiscal-years`)
      .then((res) => res.ok ? res.json() : [])
      .then((data: ExistingFiscalYear[]) => setExistingFiscalYears(Array.isArray(data) ? data : []))
      .catch(() => setExistingFiscalYears([]))
      .finally(() => setLoadingExistingFiscalYears(false))
  }, [showFiscalYearSelection, companyId])

  const handleColumnMappingComplete = async (mapping: FECColumnMapping) => {
    setColumnMapping(mapping)
    setShowColumnMapping(false)
    
    // Prévisualiser l'exercice fiscal avant le mapping des comptes
    if (fileContent && companyId) {
      setLoadingPreview(true)
      try {
        const preview = await previewFiscalYears(fileContent, mapping)
        if (preview && preview.length > 0) {
          setFiscalYearsPreview(preview)
          if (preview.length > 1) {
            // Plusieurs exercices : afficher la prévisualisation dans le dialog principal avec avertissement
            setShowFiscalYearSelection(false)
            onOpenChange(true)
          } else {
            setSelectedFiscalYearForMapping(preview[0])
            setShowFiscalYearSelection(true)
          }
        } else {
          setError('Aucun exercice fiscal détecté dans le fichier')
          onOpenChange(true)
        }
      } catch (error) {
        logger.error('Error previewing fiscal years:', error)
        setError('Erreur lors de la prévisualisation de l\'exercice fiscal')
        onOpenChange(true)
      } finally {
        setLoadingPreview(false)
      }
    } else {
      // Si pas de contenu, passer directement au mapping des comptes
      setShowAccountMapping(true)
    }
  }

  const handleAddPCG = async (includeOptional: boolean) => {
    if (!selectedFiscalYearForMapping || !companyId) return

    const stateSetter = includeOptional ? setAddingOptionalPCG : setAddingPCG
    stateSetter(true)
    setError(null)

    try {
      let fiscalYearId = selectedFiscalYearForMapping.id

      // Si l'exercice n'existe pas encore, le créer
      if (!fiscalYearId || selectedFiscalYearForMapping.wasCreated) {
        const startDate = new Date(selectedFiscalYearForMapping.startDate)
        const endDate = new Date(selectedFiscalYearForMapping.endDate)

        const response = await fetch(`/api/companies/${companyId}/fiscal-years`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            year: selectedFiscalYearForMapping.year,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Erreur lors de la création de l\'exercice')
        }

        const newFiscalYear = await response.json()
        fiscalYearId = newFiscalYear.id

        // Mettre à jour l'exercice sélectionné avec l'ID réel
        setSelectedFiscalYearForMapping({
          ...selectedFiscalYearForMapping,
          id: fiscalYearId,
          wasCreated: false,
        })
      }

      // Ajouter les comptes PCG
      const formData = new FormData()
      formData.append('companyId', companyId)
      formData.append('fiscalYearId', fiscalYearId)
      formData.append('includeOptionalAccounts', includeOptional.toString())

      const pcgResponse = await fetch('/api/accounts/seed-pcg', {
        method: 'POST',
        body: formData,
      })

      if (!pcgResponse.ok) {
        const errorData = await pcgResponse.json()
        throw new Error(errorData.error || 'Erreur lors de l\'ajout des comptes PCG')
      }

      // Succès - l'exercice est maintenant créé avec les comptes PCG
      logger.info(`PCG ajouté pour l'exercice ${selectedFiscalYearForMapping.year} (optionnels: ${includeOptional})`)
      setPcgAdded(true) // Marquer que les comptes PCG ont été ajoutés
    } catch (error) {
      logger.error('Error adding PCG:', error)
      setError(error instanceof Error ? error.message : 'Erreur lors de l\'ajout des comptes PCG')
    } finally {
      stateSetter(false)
    }
  }

  const handleFiscalYearConfirmed = () => {
    // Passer au mapping des comptes avec l'exercice sélectionné
    // Vérifier que l'exercice existe (a un ID)
    if (selectedFiscalYearForMapping && selectedFiscalYearForMapping.id) {
      setShowFiscalYearSelection(false)
      setShowAccountMapping(true)
    } else {
      setError('Veuillez d\'abord créer l\'exercice et ajouter les comptes PCG')
    }
  }

  const handleAccountMappingComplete = async (data: {
    accountMapping: Record<string, string | null>
    journalMapping?: Record<string, string | null>
  }) => {
    setAccountMapping((prev) => ({ ...prev, ...data.accountMapping }))
    if (data.journalMapping && Object.keys(data.journalMapping).length > 0) {
      setJournalMapping((prev) => ({ ...prev, ...data.journalMapping }))
    }
    setShowAccountMapping(false)
    setShowFiscalYearSelection(false)
    onOpenChange(true)
  }

  const handleImport = async () => {
    if (!file || !companyId) {
      setError('Veuillez sélectionner un fichier')
      return
    }

    // Pour les fichiers FEC, vérifier que le mapping est défini
    if (type === 'fec' && !columnMapping) {
      // Charger le contenu du fichier si nécessaire
      if (!fileContent) {
        try {
          const content = await file.text()
          setFileContent(content)
        } catch (err) {
          setError('Erreur lors de la lecture du fichier')
          return
        }
      }
      setError(null)
      // Fermer le dialog principal et ouvrir le dialog de mapping des colonnes
      setShowColumnMapping(true)
      onOpenChange(false)
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('companyId', companyId)
      formData.append('type', type)
      if (columnMapping) {
        formData.append('mapping', JSON.stringify(columnMapping))
      }
      if (Object.keys(accountMapping).length > 0) {
        formData.append('accountMapping', JSON.stringify(accountMapping))
      }
      if (type === 'fec' && journalMapping && Object.keys(journalMapping).length > 0) {
        formData.append('journalMapping', JSON.stringify(journalMapping))
      }
      if (type === 'fec' && cleanEntryNumbers) {
        formData.append('cleanEntryNumbers', 'true')
      }

      const response = await fetch('/api/import', {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const importResult = await response.json()
        setResult(importResult)

        // Toujours notifier le parent du résultat, même en cas d'import partiel,
        // la page parente doit pouvoir afficher le récapitulatif persistant.
        if (onImportSuccess) {
          onImportSuccess(importResult)
        }

        // Toujours afficher le dialog de résultat, même en cas d'échec partiel ou total,
        // l'utilisateur doit pouvoir consulter la liste des écritures ignorées.
        setShowSuccessDialog(true)
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Erreur lors de l\'import')
      }
    } catch (error) {
      logger.error('Error importing file:', error)
      setError('Erreur lors de l\'import du fichier')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setFile(null)
    setType('fec')
    setError(null)
    setResult(null)
    setFileContent(null)
    setShowColumnMapping(false)
    setShowAccountMapping(false)
    setShowFiscalYearSelection(false)
    setSelectedFiscalYearForMapping(null)
    setColumnMapping(null)
    setAccountMapping({})
    setFiscalYearsPreview(null)
    setShowSuccessDialog(false)
    setPcgAdded(false)
    setAddingPCG(false)
    setAddingOptionalPCG(false)
    setExistingFiscalYears([])
    onOpenChange(false)
  }

  return (
    <>
      {/* Dialog de résultat d'import */}
      <Dialog open={showSuccessDialog} onOpenChange={(open) => {
        if (!open) {
          setShowSuccessDialog(false)
          handleClose()
        }
      }}>
        <DialogContent className="sm:max-w-lg">
          {(() => {
            // FEC imports are atomic: refused entries cancel the whole import
            const refusedCount = result?.refused?.length ?? 0
            const errorsCount = refusedCount > 0 ? refusedCount : result?.errors?.length ?? 0
            const warnings = result?.warnings ?? []
            const createdCount = result?.entriesCreated ?? 0
            const hasErrors = errorsCount > 0
            const isFullSuccess = !hasErrors && createdCount > 0
            const isTotalFailure = createdCount === 0
            const iconCls = isFullSuccess ? 'text-success' : isTotalFailure ? 'text-destructive' : 'text-warning'
            const Icon = isFullSuccess ? CheckCircle2 : isTotalFailure ? XCircle : AlertCircle
            const title = isFullSuccess
              ? 'Import terminé avec succès'
              : isTotalFailure
                ? refusedCount > 0
                  ? 'Import refusé\u00a0: aucune écriture importée'
                  : 'Import échoué'
                : 'Import partiellement réussi'
            return (
              <>
                <div className="flex items-center gap-2 pt-2">
                  <Icon aria-hidden className={`size-5 shrink-0 ${iconCls}`} />
                  <DialogTitle>{title}</DialogTitle>
                </div>

                {result && (
                  <div className="space-y-4 mt-2">
                    <div className="grid gap-3 text-sm sm:grid-cols-2">
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">Écritures importées</div>
                        <div className="text-lg font-semibold">{createdCount}</div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          {refusedCount > 0 ? 'Écritures refusées' : 'Écritures ignorées'}
                        </div>
                        <div className={`num text-lg font-semibold ${hasErrors ? 'text-warning' : ''}`}>
                          {errorsCount}
                        </div>
                      </div>
                      {(result.accountsCreated || 0) > 0 && (
                        <div className="rounded-md border p-3">
                          <div className="text-xs text-muted-foreground">Comptes créés</div>
                          <div className="text-lg font-semibold">{result.accountsCreated}</div>
                        </div>
                      )}
                      {(result.journalsCreated || 0) > 0 && (
                        <div className="rounded-md border p-3">
                          <div className="text-xs text-muted-foreground">Journaux créés</div>
                          <div className="text-lg font-semibold">{result.journalsCreated}</div>
                        </div>
                      )}
                    </div>

                    {hasErrors && (
                      <div className="rounded-md border">
                        <div className="border-b px-3 py-2 text-sm font-medium">
                          {refusedCount > 0 ? `Écritures refusées (${errorsCount})` : `Écritures ignorées (${errorsCount})`}
                        </div>
                        <div className="max-h-64 overflow-y-auto p-3 space-y-1.5 text-xs">
                          {(result.errors ?? []).map((err, i) => (
                            <div
                              key={i}
                              className="font-mono text-muted-foreground break-words"
                            >
                              {err}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {warnings.length > 0 && (
                      <div className="rounded-md border">
                        <div className="border-b px-3 py-2 text-sm font-medium">À vérifier ({warnings.length})</div>
                        <div className="max-h-40 overflow-y-auto p-3 space-y-1.5 text-xs text-muted-foreground">
                          {warnings.map((warning, i) => (
                            <div key={i} className="break-words">
                              {warning}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <DialogFooter className="mt-4">
                  <Button onClick={() => {
                    setShowSuccessDialog(false)
                    handleClose()
                  }} className="w-full">
                    Fermer
                  </Button>
                </DialogFooter>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* Dialog choix ou création de l'exercice fiscal */}
      <Dialog
        open={showFiscalYearSelection}
        onOpenChange={(isOpen) => {
          if (!isOpen) handleClose()
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Choisir ou créer l&apos;exercice fiscal</DialogTitle>
            <DialogDescription>
              Sélectionnez l&apos;exercice dans lequel importer les écritures, ou créez un nouvel exercice.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {/* Creating the fiscal year or adding the PCG accounts can fail here: say why in this step */}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {loadingPreview ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">Analyse du fichier en cours...</p>
              </div>
            ) : fiscalYearsPreview && fiscalYearsPreview.length > 0 ? (
              <>
                {fiscalYearsPreview.length === 1 && (
                  <p className="text-sm text-muted-foreground">
                    Le fichier contient des écritures pour l&apos;exercice {fiscalYearsPreview[0].year} (
                    {fiscalYearsPreview[0].entriesCount} écritures, {fiscalYearsPreview[0].linesCount} lignes).
                  </p>
                )}

                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Exercices existants</Label>
                  {loadingExistingFiscalYears ? (
                    <p className="text-sm text-muted-foreground">Chargement...</p>
                  ) : existingFiscalYears.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Aucun exercice existant.</p>
                  ) : (
                    <div className="border rounded-lg divide-y max-h-40 overflow-y-auto">
                      {existingFiscalYears.map((fy) => {
                        const isSelected =
                          selectedFiscalYearForMapping?.id === fy.id && !selectedFiscalYearForMapping?.wasCreated
                        return (
                          <button
                            key={fy.id}
                            type="button"
                            onClick={() => {
                              setSelectedFiscalYearForMapping({
                                id: fy.id,
                                year: fy.year,
                                startDate: fy.startDate,
                                endDate: fy.endDate,
                                wasCreated: false,
                                entriesCount: 0,
                                linesCount: 0,
                              })
                            }}
                            className={`w-full px-4 py-3 text-left text-sm hover:bg-muted/50 transition-colors flex items-center justify-between ${
                              isSelected ? 'bg-primary/10 dark:bg-primary/20' : ''
                            }`}
                          >
                            <span>
                              Exercice {fy.year}, du {formatDisplayDate(fy.startDate)} au{' '}
                              {formatDisplayDate(fy.endDate)}
                            </span>
                            {isSelected && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {fiscalYearsPreview.length === 1 && fiscalYearsPreview[0].wasCreated && (
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Créer un nouvel exercice</Label>
                    <div className="border rounded-lg p-4 space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Exercice {fiscalYearsPreview[0].year}, du{' '}
                        {formatDisplayDate(fiscalYearsPreview[0].startDate)} au{' '}
                        {formatDisplayDate(fiscalYearsPreview[0].endDate)}
                      </p>
                      <Button
                        variant="outline"
                        className="w-full"
                        disabled={addingPCG || addingOptionalPCG}
                        onClick={async () => {
                          const suggested = fiscalYearsPreview[0]
                          if (!suggested || !companyId) return
                          setAddingPCG(true)
                          setError(null)
                          try {
                            const startDate = new Date(suggested.startDate)
                            const endDate = new Date(suggested.endDate)
                            const response = await fetch(`/api/companies/${companyId}/fiscal-years`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                year: suggested.year,
                                startDate: startDate.toISOString(),
                                endDate: endDate.toISOString(),
                              }),
                            })
                            if (!response.ok) {
                              const err = await response.json()
                              throw new Error(err.error || 'Erreur lors de la création')
                            }
                            const created = await response.json()
                            setSelectedFiscalYearForMapping({
                              id: created.id,
                              year: created.year,
                              startDate: created.startDate,
                              endDate: created.endDate,
                              wasCreated: false,
                              entriesCount: suggested.entriesCount,
                              linesCount: suggested.linesCount,
                            })
                            setExistingFiscalYears((prev) => [{ ...created }, ...prev])
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Erreur')
                          } finally {
                            setAddingPCG(false)
                          }
                        }}
                      >
                        {addingPCG ? 'Création...' : 'Créer cet exercice'}
                      </Button>
                    </div>
                  </div>
                )}

                {selectedFiscalYearForMapping?.id && selectedFiscalYearForMapping.wasCreated === false && (
                  <Alert>
                    <AlertDescription>
                      Exercice {selectedFiscalYearForMapping.year} sélectionné. Vous pouvez ajouter les comptes PCG
                      avant l&apos;import ou passer cette étape.
                    </AlertDescription>
                  </Alert>
                )}

                {selectedFiscalYearForMapping?.id && (
                  <div className="flex flex-col gap-2">
                    <Button
                      onClick={() => handleAddPCG(false)}
                      disabled={addingPCG || addingOptionalPCG || pcgAdded}
                      variant="outline"
                      className="w-full"
                    >
                      {addingPCG ? 'Ajout en cours...' : pcgAdded ? 'Comptes PCG ajoutés' : 'Ajouter les comptes PCG'}
                    </Button>
                    <Button
                      onClick={() => handleAddPCG(true)}
                      disabled={addingPCG || addingOptionalPCG || pcgAdded}
                      variant="outline"
                      className="w-full"
                    >
                      {addingOptionalPCG ? 'Ajout en cours...' : 'Ajouter les comptes PCG (avec optionnels)'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full text-muted-foreground"
                      onClick={() => setPcgAdded(true)}
                      disabled={addingPCG || addingOptionalPCG}
                    >
                      Les comptes existent déjà, passer cette étape
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground">Aucun exercice fiscal détecté dans le fichier.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowFiscalYearSelection(false)
                onOpenChange(true)
              }}
            >
              Annuler
            </Button>
            <Button
              onClick={handleFiscalYearConfirmed}
              disabled={
                !selectedFiscalYearForMapping?.id ||
                addingPCG ||
                addingOptionalPCG ||
                (selectedFiscalYearForMapping?.wasCreated === true && !pcgAdded)
              }
            >
              Continuer vers le mapping des comptes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de mapping des comptes */}
      <Dialog 
        open={showAccountMapping} 
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            // Si on ferme, fermer tous les dialogs
            handleClose()
          }
        }}
      >
        <DialogContent className="sm:max-w-7xl">
          <DialogHeader>
            <DialogTitle>
              Correspondance des comptes et journaux
              {selectedFiscalYearForMapping && ` - Exercice ${selectedFiscalYearForMapping.year}`}
            </DialogTitle>
            <DialogDescription>
              Configurez la correspondance entre les comptes et journaux du fichier FEC et ceux de Kledg
              {selectedFiscalYearForMapping && ` pour l'exercice ${selectedFiscalYearForMapping.year}`}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {fileContent && columnMapping && (
              <AccountMappingComponent
                fileContent={fileContent}
                columnMapping={columnMapping}
                companyId={companyId}
                fiscalYearId={selectedFiscalYearForMapping?.id || undefined}
                fiscalYearYear={selectedFiscalYearForMapping?.year}
                onMappingComplete={handleAccountMappingComplete}
                onCancel={() => {
                  setShowAccountMapping(false)
                  if (fiscalYearsPreview && fiscalYearsPreview.length > 0) {
                    setShowFiscalYearSelection(true)
                  } else {
                    setShowColumnMapping(true)
                  }
                }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog de mapping des colonnes */}
      <Dialog 
        open={showColumnMapping} 
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            // Si on ferme, fermer tous les dialogs
            handleClose()
          }
        }}
      >
        <DialogContent className="sm:max-w-7xl">
          <DialogHeader>
            <DialogTitle>Correspondance des colonnes</DialogTitle>
            <DialogDescription>
              Configurez la correspondance entre les colonnes de votre fichier et les champs attendus
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {fileContent && (
            <ColumnMapping
              fileContent={fileContent}
              companyId={companyId}
                onMappingComplete={handleColumnMappingComplete}
              onCancel={() => {
                  setShowColumnMapping(false)
                setFile(null)
                setFileContent(null)
                  onOpenChange(true)
              }}
            />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog principal d'import */}
      <Dialog open={open && !showColumnMapping && !showAccountMapping && !showFiscalYearSelection && !showSuccessDialog} onOpenChange={handleClose}>
        <DialogContent className={fiscalYearsPreview && fiscalYearsPreview.length > 0 ? "sm:max-w-xl" : "sm:max-w-lg"}>
          <DialogHeader>
            <DialogTitle>
              {fiscalYearsPreview && fiscalYearsPreview.length > 0 
                ? 'Prévisualisation de l\'import' 
                : 'Importer un fichier'}
            </DialogTitle>
            <DialogDescription>
              {fiscalYearsPreview && fiscalYearsPreview.length > 0
                ? 'Vérifiez les informations de l\'exercice fiscal détecté avant de continuer'
                : 'Sélectionnez le fichier à importer (FEC, CSV ou Excel)'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {result && (
            <Alert>
              <AlertDescription>
                <div className="space-y-3">
                  <p className="font-semibold">
                    Import {result.success ? 'réussi' : 'terminé avec des erreurs'}
                  </p>
                  
                  <div className="space-y-1">
                    <p>Écritures créées&nbsp;: {result.entriesCreated || 0}</p>
                    <p>Comptes créés&nbsp;: {result.accountsCreated || 0}</p>
                    <p>Journaux créés&nbsp;: {result.journalsCreated || 0}</p>
                  </div>

                  {result.fiscalYears && result.fiscalYears.length > 0 && (
                    <div className="mt-3 pt-3 border-t">
                      <p className="font-semibold mb-2">Exercices fiscaux&nbsp;:</p>
                      <div className="space-y-2">
                        {result.fiscalYears.map((fy) => (
                          <div key={fy.id} className="text-sm bg-muted p-3 rounded border">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-medium">
                                Exercice {fy.year}
                                {fy.wasCreated && (
                                  <span className="text-success ml-2 text-xs font-normal">
                                    (créé)
                                  </span>
                                )}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground mb-2">
                              Du {formatDisplayDate(fy.startDate)} au{' '}
                              {formatDisplayDate(fy.endDate)}
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div>
                                <span className="font-medium">Écritures&nbsp;:</span>{' '}
                                <span className="text-muted-foreground">{fy.entriesCount}</span>
                              </div>
                              {fy.linesCount !== undefined && (
                                <div>
                                  <span className="font-medium">Lignes&nbsp;:</span>{' '}
                                  <span className="text-muted-foreground">{fy.linesCount}</span>
                                </div>
                              )}
                              {fy.accountsCount !== undefined && (
                                <div>
                                  <span className="font-medium">Comptes&nbsp;:</span>{' '}
                                  <span className="text-muted-foreground">{fy.accountsCount}</span>
                                </div>
                              )}
                              {fy.journalsCount !== undefined && (
                                <div>
                                  <span className="font-medium">Journaux&nbsp;:</span>{' '}
                                  <span className="text-muted-foreground">{fy.journalsCount}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {result.errors && result.errors.length > 0 && (
                    <div className="mt-3 pt-3 border-t">
                      <p className="font-semibold">Erreurs&nbsp;:</p>
                      <ul className="list-disc list-inside mt-1">
                        {result.errors.map((err: string, i: number) => (
                          <li key={i} className="text-sm">{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Afficher uniquement la prévision si disponible, sinon les options d'import */}
          {fiscalYearsPreview && fiscalYearsPreview.length > 0 ? (
            <div className="space-y-4">
              {fiscalYearsPreview.length > 1 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Ce fichier FEC contient plusieurs exercices fiscaux (
                    {fiscalYearsPreview.map((fy) => fy.year).join(', ')}). Tous seront importés en
                    une seule fois.
                  </AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">
                  {fiscalYearsPreview.length === 1
                    ? 'Exercice fiscal détecté:'
                    : 'Exercices fiscaux détectés:'}
                </Label>
                {fiscalYearsPreview.map((fy) => (
                  <div key={fy.year} className="text-sm bg-muted p-4 rounded-lg border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-base">
                        Exercice {fy.year}
                        {fy.wasCreated && (
                          <span className="text-warning ml-2 text-xs font-normal">
                            (sera créé)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground mb-3">
                      Du {formatDisplayDate(fy.startDate)} au{' '}
                      {formatDisplayDate(fy.endDate)}
                    </div>
                    <div className="grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <span className="font-medium">Écritures&nbsp;:</span>{' '}
                        <span className="text-muted-foreground">{fy.entriesCount}</span>
                      </div>
                      {fy.linesCount !== undefined && (
                        <div>
                          <span className="font-medium">Lignes&nbsp;:</span>{' '}
                          <span className="text-muted-foreground">{fy.linesCount}</span>
                        </div>
                      )}
                      {fy.accountsCount !== undefined && (
                        <div>
                          <span className="font-medium">Comptes&nbsp;:</span>{' '}
                          <span className="text-muted-foreground">{fy.accountsCount}</span>
                        </div>
                      )}
                      {fy.journalsCount !== undefined && (
                        <div>
                          <span className="font-medium">Journaux&nbsp;:</span>{' '}
                          <span className="text-muted-foreground">{fy.journalsCount}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
          <div className="space-y-2">
            <Label htmlFor="type">Type de fichier</Label>
            <Select
              value={type}
              onValueChange={async (value: 'fec' | 'csv' | 'excel') => {
                setType(value)
                // Si on change vers FEC et qu'un fichier est déjà sélectionné, charger le contenu
                if (value === 'fec' && file && !fileContent) {
                  try {
                    const content = await file.text()
                    setFileContent(content)
                        setShowColumnMapping(true)
                    setColumnMapping(null)
                  } catch (err) {
                    setError('Erreur lors de la lecture du fichier')
                  }
                } else if (value !== 'fec') {
                      setShowColumnMapping(false)
                  setFileContent(null)
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fec">FEC (Fichier des Écritures Comptables)</SelectItem>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="excel">Excel (.xlsx, .xls)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="file">Fichier</Label>
            <FileInput
              id="file"
              accept={accountingImportAccept(type)}
              key={file?.name} // Reset input when file changes
              onChange={handleFileChange}
              disabled={loading}
            />
          </div>

          {file && (
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="min-w-0 break-all">
                Fichier choisi&nbsp;: {file.name} ({formatAmount(file.size / 1024, { currency: false, decimals: 1 })} Ko)
              </span>
              {type === 'fec' && columnMapping && (
                <span className="text-success inline-flex items-center gap-1">
                  <CheckCircle2 aria-hidden className="size-3.5" />
                  Correspondance configurée
                </span>
              )}
            </div>
          )}

          {type === 'fec' && file && !columnMapping && (
            <Alert>
              <AlertDescription>
                    Pour les fichiers FEC, vous devrez configurer la correspondance des colonnes et des comptes après la sélection du fichier.
              </AlertDescription>
            </Alert>
          )}

          {type === 'fec' && file && columnMapping && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="cleanEntryNumbers"
                checked={cleanEntryNumbers}
                onCheckedChange={(checked) => setCleanEntryNumbers(checked === true)}
              />
              <Label
                htmlFor="cleanEntryNumbers"
                className="text-sm font-normal cursor-pointer"
              >
                Nettoyer les numéros d'écriture (enlever les zéros à gauche)
              </Label>
            </div>
              )}
            </>
          )}

          {loading && (
            <div className="flex flex-col items-center gap-4 py-6">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground text-center max-w-sm">
                Import en cours… Merci de patienter, cette opération peut prendre quelques instants sur les fichiers volumineux.
              </p>
              <Progress value={undefined} className="w-full animate-pulse" />
            </div>
          )}
        </div>

        <DialogFooter>
          {!result && !fiscalYearsPreview && (
            <>
          {type === 'fec' && file && columnMapping && (
            <Button
              variant="outline"
              onClick={() => {
                    setShowColumnMapping(true)
              }}
              disabled={loading}
            >
                  Modifier le mapping
            </Button>
          )}
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Annuler
          </Button>
          <Button onClick={handleImport} disabled={loading || !file}>
            {loading ? 'Import en cours...' : 'Importer'}
          </Button>
            </>
          )}
          
          {!result && fiscalYearsPreview && fiscalYearsPreview.length > 0 && (
            <>
              <Button variant="outline" onClick={handleClose} disabled={loading}>
                Annuler
              </Button>
              <Button
                onClick={handleImport}
                disabled={loading || !file || !columnMapping}
              >
                {loading ? 'Import en cours...' : 'Importer'}
              </Button>
            </>
          )}
          
          {result && (
            <Button onClick={handleClose} className="w-full">
              Fermer
            </Button>
          )}
        </DialogFooter>
        </DialogContent>
    </Dialog>
    </>
  )
}
