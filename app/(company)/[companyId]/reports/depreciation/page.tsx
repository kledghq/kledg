'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader, formatAmount, formatPercent } from '@/components/shared'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { logger } from '@/lib/logger'
import { buildCsv } from '@/lib/reports/csv-safe'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Download, FileText, Loader2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { toast } from 'sonner'
import { formatTransactionDate } from '@/lib/utils/date'
import { plural, pluralWord } from '@/lib/utils/plural'

interface DepreciationRow {
  id: string
  label: string
  acquisitionDate: string
  acquisitionValue: number
  amortizableAmount: number
  previousDepreciation: number
  currentDepreciation: number
  totalDepreciation: number
  netBookValue: number
  assetAccount: { code: string; label: string }
  depreciationAccount: { code: string; label: string }
  expenseAccount: { code: string; label: string }
  depreciationMethod: string
  depreciationRate: number | null
  depreciationDuration: number | null
  currentPosted?: boolean
}

interface FiscalYear {
  id: string
  year: number
  startDate: string
  endDate: string
  isClosed?: boolean
}

export default function DepreciationReportPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const [loading, setLoading] = useState(true)
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([])
  const [selectedFiscalYearId, setSelectedFiscalYearId] = useState<string>('all')
  const [depreciationTable, setDepreciationTable] = useState<DepreciationRow[]>([])
  const [fiscalYear, setFiscalYear] = useState<FiscalYear | null>(null)
  const [unposted, setUnposted] = useState<{ count: number; amount: number }>({ count: 0, amount: 0 })
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    if (companyId) {
      loadFiscalYears()
    }
  }, [companyId])

  useEffect(() => {
    if (companyId) {
      loadDepreciationTable()
    }
  }, [companyId, selectedFiscalYearId])

  const loadFiscalYears = async () => {
    if (!companyId) return

    try {
      const response = await fetch(`/api/companies/${companyId}/fiscal-years`)
      if (response.ok) {
        const data = await response.json()
        setFiscalYears(data)
      }
    } catch (error) {
      logger.error('Error loading fiscal years:', error)
    }
  }

  const loadDepreciationTable = async () => {
    if (!companyId) return

    setLoading(true)
    try {
      const params = new URLSearchParams({
        companyId: companyId,
      })

      if (selectedFiscalYearId && selectedFiscalYearId !== 'all') {
        params.append('fiscalYearId', selectedFiscalYearId)
      }

      const response = await fetch(`/api/reports/depreciation?${params}`)
      if (response.ok) {
        const data = await response.json()
        setDepreciationTable(data.depreciationTable || [])
        setFiscalYear(data.fiscalYear)
        setUnposted(data.unposted ?? { count: 0, amount: 0 })
      }
    } catch (error) {
      logger.error('Error loading depreciation table:', error)
    } finally {
      setLoading(false)
    }
  }

  const generateEntries = async () => {
    if (!companyId || !fiscalYear) return
    setGenerating(true)
    try {
      const response = await fetch(`/api/companies/${companyId}/fiscal-years/${fiscalYear.id}/depreciation`, {
        method: 'POST',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(data.error || 'Impossible de générer les dotations')
        return
      }
      toast.success(
        data.count > 0
          ? `${plural(data.count, 'écriture')} de dotation ${pluralWord(data.count, 'passée', 'passées')} pour ${formatCurrency(data.amount)}`
          : 'Toutes les dotations sont déjà comptabilisées'
      )
      await loadDepreciationTable()
    } catch (error) {
      logger.error('Error generating depreciation entries:', error)
      toast.error('Impossible de générer les dotations')
    } finally {
      setGenerating(false)
    }
  }

  const formatCurrency = (value: number) => formatAmount(value)

  const exportToCSV = () => {
    const headers = [
      'Libellé',
      'Date acquisition',
      'Valeur acquisition',
      'Montant amortissable',
      'Cumul amortissements exercices précédents',
      'Amortissement exercice',
      'Cumul amortissements',
      'Valeur nette comptable',
      'Compte actif',
      'Compte amortissement',
      'Méthode',
      'Taux (%)',
      'Durée (années)',
    ]

    const rows = depreciationTable.map((row) => [
      row.label,
      formatTransactionDate(row.acquisitionDate),
      row.acquisitionValue.toFixed(2),
      row.amortizableAmount.toFixed(2),
      row.previousDepreciation.toFixed(2),
      row.currentDepreciation.toFixed(2),
      row.totalDepreciation.toFixed(2),
      row.netBookValue.toFixed(2),
      `${row.assetAccount.code} - ${row.assetAccount.label}`,
      `${row.depreciationAccount.code} - ${row.depreciationAccount.label}`,
      row.depreciationMethod === 'linear' ? 'Linéaire' : 'Dégressif',
      row.depreciationRate ? row.depreciationRate.toFixed(2) : '',
      row.depreciationDuration?.toString() || '',
    ])

    // Neutralise formula injection and quote separators/newlines (lib/reports/csv-safe).
    const csvContent = buildCsv([headers, ...rows])

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute(
      'download',
      `tableau-amortissement-${fiscalYear?.year || new Date().getFullYear()}.csv`
    )
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  if (!companyId) {
    return (
      <NoCompanySelected 
        description="Veuillez sélectionner une société pour voir le tableau d'amortissement"
      />
    )
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Tableau d'amortissement"
        description="Tableau des amortissements pour la publication des comptes"
        actions={
          depreciationTable.length > 0 ? (
            <Button onClick={exportToCSV}>
              <Download className="h-4 w-4 mr-2" />
              Exporter en CSV
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Tableau d'amortissement</CardTitle>
              <CardDescription>
                {fiscalYear
                  ? `Exercice ${fiscalYear.year} (${formatTransactionDate(fiscalYear.startDate)} - ${formatTransactionDate(fiscalYear.endDate)})`
                  : 'Tous les exercices'}
              </CardDescription>
            </div>
            <div className="space-y-2 w-64">
              <Label htmlFor="fiscalYear">Exercice</Label>
              <Select
                value={selectedFiscalYearId}
                onValueChange={setSelectedFiscalYearId}
              >
                <SelectTrigger id="fiscalYear">
                  <SelectValue placeholder="Tous les exercices" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les exercices</SelectItem>
                  {fiscalYears.map((fy) => (
                    <SelectItem key={fy.id} value={fy.id}>
                      {fy.year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!loading && fiscalYear && !fiscalYear.isClosed && unposted.count > 0 && (
            <Alert className="mb-4">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-4">
                <span>
                  {plural(unposted.count, 'dotation')} de l'exercice {fiscalYear.year} {pluralWord(unposted.count, "n'est pas comptabilisée", 'ne sont pas comptabilisées')} (
                  {formatCurrency(unposted.amount)}). Les écritures sont passées au journal OD au{' '}
                  {formatTransactionDate(fiscalYear.endDate)}, comptes 68 / 28.
                </span>
                <Button onClick={generateEntries} disabled={generating}>
                  {generating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Générer les dotations
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : depreciationTable.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                Aucune immobilisation trouvée pour générer le tableau d'amortissement
              </p>
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Libellé</TableHead>
                    <TableHead>Date acquisition</TableHead>
                    <TableHead numeric>Valeur acquisition</TableHead>
                    <TableHead numeric>Montant amortissable</TableHead>
                    <TableHead numeric>Cumul exercices précédents</TableHead>
                    <TableHead numeric>Amortissement exercice</TableHead>
                    <TableHead numeric>Cumul amortissements</TableHead>
                    <TableHead numeric>Valeur nette comptable</TableHead>
                    <TableHead>Compte actif</TableHead>
                    <TableHead>Compte amortissement</TableHead>
                    <TableHead>Méthode</TableHead>
                    <TableHead numeric>Taux (%)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {depreciationTable.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.label}</TableCell>
                      <TableCell>
                        {formatTransactionDate(row.acquisitionDate)}
                      </TableCell>
                      <TableCell numeric>
                        {formatCurrency(row.acquisitionValue)}
                      </TableCell>
                      <TableCell numeric>
                        {formatCurrency(row.amortizableAmount)}
                      </TableCell>
                      <TableCell numeric>
                        {formatCurrency(row.previousDepreciation)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(row.currentDepreciation)}
                        {row.currentPosted === false && (
                          <div className="text-xs font-normal text-muted-foreground">non comptabilisée</div>
                        )}
                      </TableCell>
                      <TableCell numeric>
                        {formatCurrency(row.totalDepreciation)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(row.netBookValue)}
                      </TableCell>
                      <TableCell>
                        {row.assetAccount.code} - {row.assetAccount.label}
                      </TableCell>
                      <TableCell>
                        {row.depreciationAccount.code} - {row.depreciationAccount.label}
                      </TableCell>
                      <TableCell>
                        {row.depreciationMethod === 'linear' ? 'Linéaire' : 'Dégressif'}
                      </TableCell>
                      <TableCell numeric>
                        {row.depreciationRate ? formatPercent(row.depreciationRate) : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold bg-muted/50">
                    <TableCell colSpan={2}>Total</TableCell>
                    <TableCell numeric>
                      {formatCurrency(
                        depreciationTable.reduce((sum, row) => sum + row.acquisitionValue, 0)
                      )}
                    </TableCell>
                    <TableCell numeric>
                      {formatCurrency(
                        depreciationTable.reduce((sum, row) => sum + row.amortizableAmount, 0)
                      )}
                    </TableCell>
                    <TableCell numeric>
                      {formatCurrency(
                        depreciationTable.reduce((sum, row) => sum + row.previousDepreciation, 0)
                      )}
                    </TableCell>
                    <TableCell numeric>
                      {formatCurrency(
                        depreciationTable.reduce((sum, row) => sum + row.currentDepreciation, 0)
                      )}
                    </TableCell>
                    <TableCell numeric>
                      {formatCurrency(
                        depreciationTable.reduce((sum, row) => sum + row.totalDepreciation, 0)
                      )}
                    </TableCell>
                    <TableCell numeric>
                      {formatCurrency(
                        depreciationTable.reduce((sum, row) => sum + row.netBookValue, 0)
                      )}
                    </TableCell>
                    <TableCell colSpan={4}></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
