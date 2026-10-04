'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FileInput } from '@/components/ui/file-input'
import { Label } from '@/components/ui/label'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { logger } from '@/lib/logger'
import { ColumnMapping } from '@/components/features/import/column-mapping'
import type { FECColumnMapping } from '@/lib/import/types'
import type { ImportResult } from '@/lib/import/fec/types'
import type { PCGWarning } from '@/lib/accounting/services/types'
import { AlertTriangle, Info, AlertCircle, CheckCircle2, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { PageHeader, formatAmount } from '@/components/shared'
import { docsUrl } from '@/lib/docs-links'
import { plural } from '@/lib/utils/plural'
import { accountingImportAccept } from '@/components/features/import/file-accept'

export default function ImportPage() {
  const params = useParams()
  const companyId = params?.companyId as string | undefined
  const [file, setFile] = useState<File | null>(null)
  const [type, setType] = useState<'fec' | 'csv' | 'excel'>('fec')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<(ImportResult & { pcgWarnings?: Array<{ entryNumber: string; warnings: PCGWarning[] }> }) | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [showMapping, setShowMapping] = useState(false)
  const [columnMapping, setColumnMapping] = useState<FECColumnMapping | null>(null)
  const [accountMapping, setAccountMapping] = useState<Record<string, string | null>>({})

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
          setShowMapping(true)
          setColumnMapping(null)
          setError(null)
        } catch (err) {
          logger.error('Error reading the import file:', err)
          setError("Le fichier n'a pas pu être lu. Vérifiez qu'il s'agit d'un fichier texte et réessayez.")
        }
      } else if (extension === 'csv') {
        setType('csv')
        setShowMapping(false)
        setFileContent(null)
      } else if (extension === 'xlsx' || extension === 'xls') {
        setType('excel')
        setShowMapping(false)
        setFileContent(null)
      }
    }
  }

  const handleMappingComplete = (mapping: FECColumnMapping, accountMapping?: Record<string, string | null>) => {
    setColumnMapping(mapping)
    setAccountMapping(accountMapping || {})
    setShowMapping(false)
  }

  const handleImport = async () => {
    if (!file || !companyId) {
      setError('Choisissez le fichier à importer.')
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
          logger.error('Error reading the import file:', err)
          setError("Le fichier n'a pas pu être lu. Vérifiez qu'il s'agit d'un fichier texte et réessayez.")
          return
        }
      }
      setError(null)
      setShowMapping(true)
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

      const response = await fetch('/api/import', {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const importResult = await response.json()
        setResult(importResult)
        // Réinitialiser après un import réussi
        if (importResult.success) {
          setFile(null)
          setFileContent(null)
          setColumnMapping(null)
          setShowMapping(false)
        }
      } else {
        const errorData = await response.json()
        setError(errorData.error || "L'import a échoué. Vérifiez le fichier et réessayez.")
      }
    } catch (error) {
      logger.error('Error importing file:', error)
      setError("L'import a échoué. Vérifiez votre connexion et réessayez.")
    } finally {
      setLoading(false)
    }
  }

  if (!companyId) {
    return (
      <NoCompanySelected 
        description="Veuillez sélectionner une société pour importer des données"
      />
    )
  }

  // Afficher le composant de mapping si nécessaire
  if (showMapping && fileContent && type === 'fec') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Import"
          description={`Associez les colonnes et les comptes du FEC${file ? ` « ${file.name} »` : ''} à ceux de la société, puis lancez l'import.`}
          docsHref={docsUrl('fec')}
        />
        <ColumnMapping
          fileContent={fileContent}
          companyId={companyId}
          onMappingComplete={handleMappingComplete}
          onCancel={() => {
            setShowMapping(false)
            setFile(null)
            setFileContent(null)
          }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import"
        description="Reprenez des écritures depuis un autre logiciel&nbsp;: un FEC, un CSV ou un fichier Excel."
        docsHref={docsUrl('fec')}
      />
      <Card>
        <CardHeader>
          <CardTitle>Importer un fichier</CardTitle>
          <CardDescription>
            Pour un FEC, vous associez ensuite ses colonnes et ses comptes à ceux de la société.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {result && (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  <div className="space-y-2">
                    <p className="font-semibold">
                      {result.success
                        ? 'Import réussi'
                        : result.entriesCreated === 0
                          ? 'Import refusé\u00a0: aucune écriture importée'
                          : 'Import terminé avec des erreurs'}
                    </p>
                    <p>Écritures créées&nbsp;: {result.entriesCreated}</p>
                    <p>Comptes créés&nbsp;: {result.accountsCreated}</p>
                    <p>Journaux créés&nbsp;: {result.journalsCreated}</p>
                    {result.errors.length > 0 && (
                      <div>
                        <p className="font-semibold">Erreurs&nbsp;:</p>
                        <ul className="list-disc list-inside max-h-64 overflow-y-auto">
                          {result.errors.map((err: string, i: number) => (
                            <li key={i}>{err}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </AlertDescription>
              </Alert>

              {/* Rapport PCG */}
              {(() => {
                const pcgWarnings = result && 'pcgWarnings' in result && result.pcgWarnings ? result.pcgWarnings : null
                if (!pcgWarnings || pcgWarnings.length === 0) return null
                
                const hasErrors = pcgWarnings.some((w) => w.warnings.some((w2) => w2.severity === 'error'))
                const totalWarnings = pcgWarnings.reduce((sum, w) => sum + w.warnings.length, 0)
                
                return (
                  <Alert variant={hasErrors ? 'destructive' : 'default'}>
                    <AlertTriangle aria-hidden />
                    <AlertTitle>Avertissements PCG</AlertTitle>
                    <AlertDescription>
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p>
                            {plural(totalWarnings, 'avertissement détecté', 'avertissements détectés')}
                          </p>
                          <Badge variant="outline">
                            {pcgWarnings.length} écriture{pcgWarnings.length > 1 ? 's' : ''} concernée{pcgWarnings.length > 1 ? 's' : ''}
                          </Badge>
                        </div>
                        
                        <details className="mt-2">
                          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                            Voir les détails
                          </summary>
                          <div className="mt-2 space-y-2 max-h-64 overflow-y-auto">
                            {pcgWarnings.map((entryWarning, idx: number) => (
                              <div key={idx} className="border rounded p-3 space-y-2">
                                <p className="text-sm font-medium">
                                  Écriture {entryWarning.entryNumber} :
                                </p>
                                <ul className="space-y-1">
                                  {entryWarning.warnings.map((warning, wIdx: number) => (
                                  <li key={wIdx} className="text-sm flex items-start gap-2">
                                    {warning.severity === 'error' && (
                                      <AlertCircle aria-label="Erreur" className="text-destructive mt-0.5 size-4 shrink-0" />
                                    )}
                                    {warning.severity === 'warning' && (
                                      <AlertTriangle aria-label="Avertissement" className="text-warning mt-0.5 size-4 shrink-0" />
                                    )}
                                    {warning.severity === 'info' && (
                                      <Info aria-label="Information" className="text-info mt-0.5 size-4 shrink-0" />
                                    )}
                                    <span className="flex-1">
                                      <Badge variant="outline" className="mr-2">
                                        {warning.code}
                                        {warning.article && ` (Art. ${warning.article})`}
                                      </Badge>
                                      {warning.message}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  </AlertDescription>
                </Alert>
                )
              })()}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="type">Type de fichier</Label>
            <Select value={type} onValueChange={(value: 'fec' | 'csv' | 'excel') => setType(value)}>
              <SelectTrigger id="type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fec">FEC (fichier des écritures comptables)</SelectItem>
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
              fileName={file?.name ?? null}
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
                Pour les fichiers FEC, vous devrez configurer la correspondance des colonnes après la sélection du fichier.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            {type === 'fec' && file && columnMapping && (
              <Button
                variant="outline"
                onClick={() => {
                  setShowMapping(true)
                }}
                disabled={loading}
              >
                Modifier la correspondance
              </Button>
            )}
            <Button onClick={handleImport} loading={loading} disabled={!file}>
              <Upload aria-hidden />
              Importer
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
