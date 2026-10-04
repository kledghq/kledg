'use client'

import { ReportsEmptyHint } from '@/components/features/onboarding/reports-empty-hint'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { logger } from '@/lib/logger'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { docsUrl } from '@/lib/docs-links'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/shared'
import { AlertTriangle, Download, Settings } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import Link from 'next/link'
import type { IncomeStatementData, IncomeStatementLine } from '@/lib/reports/income-statement/types'
import { LayoutNotice } from '@/components/features/reports/layout-notice'
import { HideZeroLinesToggle } from '@/components/features/reports/hide-zero-lines-toggle'
import { StatementTable, formatStatementAmount, type StatementColumn } from '@/components/features/reports/statement-table'
import { flattenStatementLines, isZeroAmount } from '@/components/features/reports/statement-rows'
import { useHideZeroLines } from '@/hooks/use-hide-zero-lines'

const AMOUNT_COLUMNS: StatementColumn[] = [{ key: 'montant', label: 'Montant' }]

interface FiscalYear {
  id: string
  year: number
  startDate: string
  endDate: string
}

export default function IncomeStatementPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const [incomeStatement, setIncomeStatement] = useState<IncomeStatementData | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selectedFiscalYearId, setSelectedFiscalYearId] = useState<string>('')
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([])
  const [variant, setVariant] = useState<'complete' | 'simplified'>('complete')
  const [hideZeroLines, setHideZeroLines] = useHideZeroLines()

  useEffect(() => {
    async function loadFiscalYears() {
      if (!companyId) return

      try {
        const response = await fetch(`/api/companies/${companyId}/fiscal-years`)
        if (response.ok) {
          const years: FiscalYear[] = await response.json()
          setFiscalYears(years.sort((a, b) => b.year - a.year))
          
          if (years.length > 0) {
            setSelectedFiscalYearId(years[0].id)
          }
        }
      } catch (error) {
        logger.error('Error loading fiscal years:', error)
      }
    }

    if (companyId) {
      loadFiscalYears()
    }
  }, [companyId])

  useEffect(() => {
    async function loadIncomeStatement() {
      if (!companyId || !selectedFiscalYearId) return

      setLoading(true)
      try {
        const params = new URLSearchParams({
          fiscalYearId: selectedFiscalYearId,
          variant,
        })
        const response = await fetch(`/api/companies/${companyId}/income-statement?${params}`)
        
        if (response.ok) {
          const data: IncomeStatementData = await response.json()
          setIncomeStatement(data)
        }
      } catch (error) {
        logger.error('Error loading income statement:', error)
      } finally {
        setLoading(false)
      }
    }

    loadIncomeStatement()
  }, [companyId, selectedFiscalYearId, variant, reloadKey])

  const handleExport = async (format: 'pdf' | 'excel') => {
    if (!companyId || !selectedFiscalYearId) return

    try {
      const qs = new URLSearchParams({
        fiscalYearId: selectedFiscalYearId,
        variant,
      })

      const endpoint =
        format === 'pdf' ? 'export-pdf' : 'export-excel'
      const response = await fetch(
        `/api/companies/${companyId}/income-statement/${endpoint}?${qs}`
      )

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        logger.error(`Error exporting ${format}:`, error)
        return
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ext = format === 'pdf' ? 'pdf' : 'xlsx'
      a.download = `Compte_de_resultat_${selectedFiscalYearId}.${ext}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      logger.error(`Error exporting ${format}:`, error)
    }
  }

  const flatten = (lines: IncomeStatementLine[]) =>
    flattenStatementLines(lines, {
      hideZeroLines,
      isZero: (line) => isZeroAmount(line.value),
      toRow: (line, level) => ({
        id: line.id,
        level,
        label: line.lineLabel,
        hideLabel: line.hideLabel,
        formCode: line.formCode,
        // Totals and the intermediate results of the model (résultat d'exploitation...)
        kind:
          /RÉSULTAT|BÉNÉFICE/.test(line.lineLabel) || line.lineLabel.toLowerCase().includes('total')
            ? 'total'
            : line.children && line.children.length > 0
              ? 'section'
              : 'line',
        values: { montant: line.value },
      }),
    })
  const produits = incomeStatement ? flatten(incomeStatement.produits.lines) : null
  const charges = incomeStatement ? flatten(incomeStatement.charges.lines) : null
  const hiddenCount = (produits?.hiddenCount ?? 0) + (charges?.hiddenCount ?? 0)

  if (!companyId) {
    return (
      <NoCompanySelected 
        description="Veuillez sélectionner une société pour voir le compte de résultat"
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compte de résultat"
        description="Les produits et les charges de l'exercice, et le résultat qui en découle."
        docsHref={docsUrl('incomeStatement')}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/${companyId}/reports/income-statement/config`}>
                <Settings aria-hidden />
                Configuration
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => handleExport('excel')}
              disabled={!incomeStatement}
            >
              <Download aria-hidden />
              Exporter Excel
            </Button>
            <Button onClick={() => handleExport('pdf')} disabled={!incomeStatement}>
              <Download aria-hidden />
              Exporter PDF
            </Button>
          </>
        }
      />
      <ReportsEmptyHint companyId={companyId} />

      <Card>
        <CardHeader>
          <CardTitle>Paramètres</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="is-fiscal-year" className="mb-2 block">Exercice</Label>
              <Select
                value={selectedFiscalYearId}
                onValueChange={setSelectedFiscalYearId}
              >
                <SelectTrigger id="is-fiscal-year">
                  <SelectValue placeholder="Sélectionner un exercice" />
                </SelectTrigger>
                <SelectContent>
                  {fiscalYears.map((fy) => (
                    <SelectItem key={fy.id} value={fy.id}>
                      {fy.year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="is-variant" className="mb-2 block">Variante</Label>
              <Select value={variant} onValueChange={(v) => setVariant(v as 'complete' | 'simplified')}>
                <SelectTrigger id="is-variant">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="complete">Complète</SelectItem>
                  <SelectItem value="simplified">Simplifiée</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-4">
            <HideZeroLinesToggle
              id="is-hide-zero-lines"
              checked={hideZeroLines}
              onCheckedChange={setHideZeroLines}
              hiddenCount={hiddenCount}
            />
          </div>
          <Separator className="my-4" />
          <p className="text-xs text-muted-foreground">
            Le compte de résultat est établi avant l&apos;écriture de clôture (journal CL)&nbsp;: un exercice clôturé
            présente son résultat réel.
          </p>
        </CardContent>
      </Card>

      <LayoutNotice
        companyId={companyId}
        kind="income-statement"
        variant={variant}
        status={incomeStatement?.layoutStatus}
        hasWarnings={(incomeStatement?.warnings?.length ?? 0) > 0}
        onReset={() => setReloadKey((k) => k + 1)}
      />

      {incomeStatement?.warnings && incomeStatement.warnings.length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Configuration du compte de résultat à vérifier</AlertTitle>
          <AlertDescription>
            <ul className="list-disc list-inside space-y-1">
              {incomeStatement.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-96" />
          </CardContent>
        </Card>
      ) : incomeStatement && produits && charges ? (
        // Side by side only when each half keeps a readable label next to its
        // amount column (container from 68rem, about a 1440 px window with
        // the sidebar); otherwise Produits then Charges.
        <div className="@container/statements">
          <div className="grid max-w-5xl grid-cols-1 gap-6 @min-[68rem]/statements:max-w-none @min-[68rem]/statements:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Produits</CardTitle>
              </CardHeader>
              <CardContent>
                <StatementTable
                  label="Produits"
                  columns={AMOUNT_COLUMNS}
                  rows={produits.rows}
                  footer={{ label: 'Total produits', values: { montant: incomeStatement.totalProduits } }}
                />
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Charges</CardTitle>
              </CardHeader>
              <CardContent>
                <StatementTable
                  label="Charges"
                  columns={AMOUNT_COLUMNS}
                  rows={charges.rows}
                  footer={{ label: 'Total charges', values: { montant: incomeStatement.totalCharges } }}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {incomeStatement && (
        <Card>
          <CardHeader>
            <CardTitle>Résultat net</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold num">{formatStatementAmount(incomeStatement.netResult)}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
