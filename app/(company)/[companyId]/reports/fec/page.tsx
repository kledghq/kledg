'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, AlertTriangle, Download } from 'lucide-react'
import { logger } from '@/lib/logger'

import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { PageHeader } from '@/components/shared'
import { docsUrl } from '@/lib/docs-links'
import { plural } from '@/lib/utils/plural'

interface FecIssue {
  line: number | null
  message: string
}

interface FecReport {
  fileName: string
  entries: number
  lines: number
  valid: boolean
  errors: FecIssue[]
  warnings: FecIssue[]
}

/** File name sent by the server (SirenFECAAAAMMJJ.txt). */
function fileNameOf(response: Response): string | null {
  const header = response.headers.get('Content-Disposition') ?? ''
  const encoded = /filename\*=UTF-8''([^;]+)/.exec(header)?.[1]
  if (encoded) return decodeURIComponent(encoded)
  return /filename="([^"]+)"/.exec(header)?.[1] ?? null
}

export default function FECExportPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const [selectedFiscalYearId, setSelectedFiscalYearId] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<FecReport | null>(null)

  const handleExport = async () => {
    if (!companyId || !selectedFiscalYearId) {
      toast.error("Choisissez l'exercice à exporter")
      return
    }

    setLoading(true)
    setReport(null)
    try {
      const query = new URLSearchParams({ companyId, fiscalYearId: selectedFiscalYearId })
      const response = await fetch(`/api/fec?${query.toString()}`)
      if (!response.ok) {
        const error = await response.json()
        toast.error(error.error || "Le FEC n'a pas été exporté. Réessayez.")
        return
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileNameOf(response) ?? 'FEC.txt'
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success('FEC exporté')

      // Compliance check of the same file (art. A47 A-1 du LPF)
      const check = await fetch(`/api/fec?${query.toString()}&report=1`)
      if (check.ok) setReport(await check.json())
    } catch (error) {
      logger.error('Error exporting FEC:', error)
      toast.error("Le FEC n'a pas été exporté. Vérifiez votre connexion et réessayez.")
    } finally {
      setLoading(false)
    }
  }

  if (!companyId) {
    return (
      <NoCompanySelected
        description="Veuillez sélectionner une société pour exporter le FEC"
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="FEC"
        description="Le fichier des écritures comptables à remettre à l'administration fiscale en cas de contrôle."
        docsHref={docsUrl('fec')}
      />
      <Card>
        <CardHeader>
          <CardTitle>Exporter un exercice</CardTitle>
          <CardDescription>
            Un FEC par exercice, au format de l&apos;article A47 A-1 du livre des procédures fiscales&nbsp;: écritures validées
            dans l&apos;ordre de validation, à-nouveaux en tête, fichier nommé SirenFECAAAAMMJJ. Kledg contrôle le fichier
            à l&apos;export&nbsp;; avant de le remettre, vous pouvez aussi le tester avec Test Compta Demat de la DGFiP.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <FiscalYearSelector
            companyId={companyId}
            value={selectedFiscalYearId}
            onValueChange={setSelectedFiscalYearId}
            showLabel={true}
          />

          <Button onClick={handleExport} loading={loading} disabled={!selectedFiscalYearId}>
            <Download aria-hidden />
            Exporter le FEC
          </Button>

          {report && (
            <Alert variant={report.valid ? 'default' : 'destructive'}>
              {report.valid ? <CheckCircle2 aria-hidden /> : <AlertTriangle aria-hidden />}
              <AlertTitle>
                {report.valid ? 'Aucune anomalie détectée par Kledg' : `${plural(report.errors.length, 'anomalie')} dans le fichier`}
              </AlertTitle>
              <AlertDescription>
                <p>
                  {report.fileName} : {plural(report.entries, 'écriture')}, {plural(report.lines, 'ligne')}.
                </p>
                {[...report.errors, ...report.warnings].length > 0 && (
                  <ul className="mt-2 list-disc pl-5 space-y-1">
                    {[...report.errors, ...report.warnings].slice(0, 20).map((issue, i) => (
                      <li key={i}>
                        {issue.line ? `Ligne ${issue.line}\u00a0: ` : ''}
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
