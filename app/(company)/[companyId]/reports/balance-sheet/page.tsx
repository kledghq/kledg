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
import { Download, RefreshCw, AlertTriangle, Settings } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import Link from 'next/link'
import type { BalanceSheetData, BalanceSheetLine } from '@/lib/reports/balance-sheet/types'
import { LayoutNotice } from '@/components/features/reports/layout-notice'
import { HideZeroLinesToggle } from '@/components/features/reports/hide-zero-lines-toggle'
import { StatementTable, formatStatementAmount, type StatementColumn } from '@/components/features/reports/statement-table'
import { flattenStatementLines, isZeroAmount, type StatementValue } from '@/components/features/reports/statement-rows'
import { useHideZeroLines } from '@/hooks/use-hide-zero-lines'
import { cn } from '@/lib/utils'
import { plural } from '@/lib/utils/plural'

const NET_COLUMNS: StatementColumn[] = [{ key: 'net', label: 'Net' }]
// The actif is presented net of depreciation (PCG art. 821-1): Net is the
// main column, Brut and Amortissement move under the label on narrow screens.
const BRUT_AMORT_NET_COLUMNS: StatementColumn[] = [
  { key: 'brut', label: 'Brut', secondary: true },
  { key: 'amortissements', label: 'Amortissement', secondary: true },
  { key: 'net', label: 'Net' },
]
const EMPTY_MESSAGE = 'Aucune ligne configurée. Veuillez configurer le bilan.'

interface FiscalYear {
  id: string
  year: number
  startDate: string
  endDate: string
}

export default function BalanceSheetPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetData | null>(null)
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
          
          // Select latest fiscal year by default
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
    async function loadBalanceSheet() {
      if (!companyId || !selectedFiscalYearId) return

      setLoading(true)
      try {
        const params = new URLSearchParams({
          fiscalYearId: selectedFiscalYearId,
          variant,
          // Add cache-busting timestamp to prevent browser cache
          _t: Date.now().toString(),
        })
        const response = await fetch(`/api/companies/${companyId}/balance-sheet?${params}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
          },
        })
        
        if (response.ok) {
          const data: BalanceSheetData = await response.json()
          setBalanceSheet(data)
        } else {
          const error = await response.json()
          logger.error('Error loading balance sheet:', error)
        }
      } catch (error) {
        logger.error('Error loading balance sheet:', error)
      } finally {
        setLoading(false)
      }
    }

    loadBalanceSheet()
  }, [companyId, selectedFiscalYearId, variant, reloadKey])

  const handleExportPDF = async () => {
    if (!companyId || !selectedFiscalYearId) return

    try {
      const params = new URLSearchParams({
        fiscalYearId: selectedFiscalYearId,
        variant,
      })
      const response = await fetch(`/api/companies/${companyId}/balance-sheet/export-pdf?${params}`)
      
      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `Bilan_${balanceSheet?.fiscalYearId || 'export'}.pdf`
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
      } else {
        const error = await response.json()
        logger.error('Error exporting PDF:', error)
      }
    } catch (error) {
      logger.error('Error exporting PDF:', error)
    }
  }

  // N-1 of the export: the fiscal year just before the one shown (none for the first one)
  const selectedYear = fiscalYears.find((fy) => fy.id === selectedFiscalYearId)?.year
  const previousFiscalYearId =
    selectedYear === undefined ? '' : (fiscalYears.find((fy) => fy.year < selectedYear)?.id ?? '')

  const handleExportExcel = async () => {
    if (!companyId || !selectedFiscalYearId) return

    try {
      const params = new URLSearchParams({
        fiscalYearId: selectedFiscalYearId,
        variant,
      })
      
      if (previousFiscalYearId) {
        params.append('previousFiscalYearId', previousFiscalYearId)
      }
      
      const response = await fetch(`/api/companies/${companyId}/balance-sheet/export-excel?${params}`)
      
      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `Bilan_${balanceSheet?.fiscalYearId || 'export'}.xlsx`
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
      } else {
        const error = await response.json()
        logger.error('Error exporting Excel:', error)
      }
    } catch (error) {
      logger.error('Error exporting Excel:', error)
    }
  }

  const formatDate = (date: Date | string): string => {
    const dateObj = date instanceof Date ? date : new Date(date)
    return dateObj.toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC',
    })
  }

  // "Résultat de l'exercice" (2051 DI, 2033-A 136): the year's result plus a
  // previous result still in account 12 (not allocated yet).
  const findByFormCode = (lines: BalanceSheetLine[], codes: string[]): BalanceSheetLine | null => {
    for (const line of lines) {
      if (line.formCode && codes.includes(line.formCode)) return line
      const found = findByFormCode(line.children ?? [], codes)
      if (found) return found
    }
    return null
  }
  const resultLine = balanceSheet ? findByFormCode(balanceSheet.passif.lines, ['DI', '136']) : null
  const pendingAllocation =
    resultLine && balanceSheet?.netResult !== undefined
      ? Math.round((resultLine.net - balanceSheet.netResult) * 100) / 100
      : 0

  // Check if any line in the section needs brut/amortissement/net display
  const needsBrutAmortDisplay = (lines: BalanceSheetLine[]): boolean => {
    for (const line of lines) {
      if (line.brut !== undefined || line.amortissements !== undefined) {
        return true
      }
      if (line.children && needsBrutAmortDisplay(line.children)) {
        return true
      }
    }
    return false
  }

  // Only show brut/amortissement/net for ACTIF, not PASSIF
  const showBrutAmortActif = balanceSheet 
    ? needsBrutAmortDisplay(balanceSheet.actif.lines)
    : false

  const flatten = (lines: BalanceSheetLine[], showBrutAmort: boolean) =>
    flattenStatementLines(lines, {
      hideZeroLines,
      isZero: (line) => isZeroAmount(line.net) && isZeroAmount(line.brut) && isZeroAmount(line.amortissements),
      toRow: (line, level) => {
        const isTotal = line.lineLabel.toLowerCase().includes('total')
        const isSection = !!line.children && line.children.length > 0
        const accountCount = line.accounts?.length ?? 0
        // Totals do not display brut/amortissement: they are sums of their children.
        const hasBrutAmort = !isTotal && (line.brut !== undefined || line.amortissements !== undefined)
        // Groups are organizational headers: no accounts and nothing to show.
        const isGroup = isSection && accountCount === 0 && line.net === 0 && line.value === 0
        const values: Record<string, StatementValue> = isGroup
          ? {}
          : showBrutAmort
            ? {
                brut: hasBrutAmort ? (line.brut ?? 0) : null,
                amortissements: hasBrutAmort ? (line.amortissements ?? 0) : null,
                net: line.net,
              }
            : { net: line.net }
        return {
          id: line.id,
          level,
          label: line.lineLabel,
          hideLabel: line.hideLabel,
          formCode: line.formCode,
          kind: isTotal ? 'total' : isSection ? 'section' : 'line',
          note: accountCount > 0 && !isTotal ? plural(accountCount, 'compte') : undefined,
          values,
        }
      },
    })
  const actif = balanceSheet ? flatten(balanceSheet.actif.lines, showBrutAmortActif) : null
  const passif = balanceSheet ? flatten(balanceSheet.passif.lines, false) : null
  const hiddenCount = (actif?.hiddenCount ?? 0) + (passif?.hiddenCount ?? 0)
  const actifColumns = showBrutAmortActif ? BRUT_AMORT_NET_COLUMNS : NET_COLUMNS

  if (!companyId) {
    return (
      <NoCompanySelected 
        description="Veuillez sélectionner une société pour voir le bilan"
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bilan"
        description="Ce que la société possède (actif) et ce qu'elle doit (passif) à la clôture de l'exercice."
        docsHref={docsUrl('balanceSheet')}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/${companyId}/reports/balance-sheet/config`}>
                <Settings aria-hidden />
                Configuration
              </Link>
            </Button>
            <Button variant="outline" onClick={handleExportExcel} disabled={!balanceSheet}>
              <Download aria-hidden />
              Exporter Excel
            </Button>
            <Button onClick={handleExportPDF} disabled={!balanceSheet}>
              <Download aria-hidden />
              Exporter PDF
            </Button>
          </>
        }
      />
      <ReportsEmptyHint companyId={companyId} />

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Paramètres</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="bs-fiscal-year" className="mb-2 block">Exercice</Label>
              <Select
                value={selectedFiscalYearId}
                onValueChange={setSelectedFiscalYearId}
              >
                <SelectTrigger id="bs-fiscal-year">
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
              <Label htmlFor="bs-variant" className="mb-2 block">Variante</Label>
              <Select value={variant} onValueChange={(v) => setVariant(v as 'complete' | 'simplified')}>
                <SelectTrigger id="bs-variant">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="complete">Complète</SelectItem>
                  <SelectItem value="simplified">Simplifiée</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
                <RefreshCw aria-hidden />
                Actualiser
              </Button>
            </div>
          </div>
          <div className="mt-4">
            <HideZeroLinesToggle
              id="bs-hide-zero-lines"
              checked={hideZeroLines}
              onCheckedChange={setHideZeroLines}
              hiddenCount={hiddenCount}
            />
          </div>
          <p className="mt-4 pt-4 border-t text-xs text-muted-foreground">
            Le bilan est établi avant l&apos;écriture de clôture (journal CL)&nbsp;: un exercice clôturé présente son
            résultat réel sur la ligne « Résultat de l&apos;exercice ».
          </p>
        </CardContent>
      </Card>

      <LayoutNotice
        companyId={companyId}
        kind="balance-sheet"
        variant={variant}
        status={balanceSheet?.layoutStatus}
        hasWarnings={!!balanceSheet?.diagnostic}
        onReset={() => setReloadKey((k) => k + 1)}
      />

      {/* Imbalance and mapping problems */}
      {balanceSheet?.diagnostic && (
        <Alert variant={balanceSheet.imbalance ? 'destructive' : 'default'}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{balanceSheet.imbalance ? 'Bilan non équilibré' : 'Configuration du bilan à vérifier'}</AlertTitle>
          <AlertDescription>
            {balanceSheet.imbalance ? (
              <p className="mb-2">
                Écart détecté&nbsp;: {formatStatementAmount(balanceSheet.imbalance)}
              </p>
            ) : null}
            {balanceSheet.diagnostic.causes.unbalancedEntries.length > 0 && (
              <div className="text-sm mb-2">
                <p className="font-semibold mb-1">
                  {plural(balanceSheet.diagnostic.causes.unbalancedEntries.length, 'écriture non équilibrée', 'écritures non équilibrées')} :
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  {balanceSheet.diagnostic.causes.unbalancedEntries.map((entry) => (
                    <li key={entry.entryId}>
                      <a
                        href={entry.link}
                        className="text-primary hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {entry.reference}
                      </a>
                      {' '}
                      ({formatDate(entry.date)}) - Écart&nbsp;: {formatStatementAmount(entry.difference)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {balanceSheet.diagnostic.causes.unmappedAccounts.length > 0 && (
              <div className="text-sm mb-2">
                <p className="font-semibold mb-1">
                  {plural(balanceSheet.diagnostic.causes.unmappedAccounts.length, 'compte rattaché', 'comptes rattachés')} à aucune ligne du bilan&nbsp;:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  {balanceSheet.diagnostic.causes.unmappedAccounts.map((account) => (
                    <li key={account.accountId}>
                      <span className="font-mono font-semibold">{account.code}</span>
                      {' - '}
                      {account.label}
                      {' '}
                      (Solde&nbsp;: {formatStatementAmount(account.balance)})
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {balanceSheet.diagnostic.causes.configurationIssues.length > 0 && (
              <div className="text-sm mb-2">
                <p className="font-semibold mb-1">
                  {plural(balanceSheet.diagnostic.causes.configurationIssues.length, 'problème')} de configuration&nbsp;:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  {balanceSheet.diagnostic.causes.configurationIssues.map((issue, index) => (
                    <li key={index}>
                      {issue.issue}
                      {' - '}
                      <span className="text-muted-foreground">{issue.suggestion}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {balanceSheet?.warnings && balanceSheet.warnings.length > 0 && !balanceSheet.diagnostic && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>À vérifier</AlertTitle>
          <AlertDescription>
            <ul className="list-disc list-inside space-y-1">
              {balanceSheet.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Balance Sheet */}
      {loading ? (
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-96" />
          </CardContent>
        </Card>
      ) : balanceSheet && actif && passif ? (
        // Side by side only when each half keeps its amount columns and a
        // readable label: from 68rem of container with the Net column only,
        // from 88rem with Brut, Amortissement and Net. Otherwise actif then passif.
        <div className="@container/statements">
          <div
            className={cn(
              'grid max-w-5xl grid-cols-1 gap-6',
              showBrutAmortActif
                ? '@min-[88rem]/statements:max-w-none @min-[88rem]/statements:grid-cols-2'
                : '@min-[68rem]/statements:max-w-none @min-[68rem]/statements:grid-cols-2',
            )}
          >
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>ACTIF</CardTitle>
              </CardHeader>
              <CardContent>
                <StatementTable
                  label="Actif"
                  columns={actifColumns}
                  rows={actif.rows}
                  emptyMessage={EMPTY_MESSAGE}
                  footer={{
                    label: 'TOTAL ACTIF (net)',
                    values: showBrutAmortActif
                      ? {
                          brut: balanceSheet.actif.brutTotal ?? null,
                          amortissements: balanceSheet.actif.amortissementsTotal ?? null,
                          net: balanceSheet.actifTotal,
                        }
                      : { net: balanceSheet.actifTotal },
                  }}
                />
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>PASSIF</CardTitle>
              </CardHeader>
              <CardContent>
                <StatementTable
                  label="Passif"
                  columns={NET_COLUMNS}
                  rows={passif.rows}
                  emptyMessage={EMPTY_MESSAGE}
                  footer={{ label: 'TOTAL PASSIF', values: { net: balanceSheet.passifTotal } }}
                />
                {pendingAllocation !== 0 && balanceSheet.netResult !== undefined && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Résultat de l&apos;exercice&nbsp;: {formatStatementAmount(balanceSheet.netResult)} pour l&apos;exercice, et{' '}
                    {formatStatementAmount(pendingAllocation)} de résultat antérieur en instance d&apos;affectation (compte 12)
                    inclus sur la ligne.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              Aucun bilan disponible. Choisissez un exercice.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
