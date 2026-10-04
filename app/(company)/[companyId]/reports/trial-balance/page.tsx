'use client'

import { ReportsEmptyHint } from '@/components/features/onboarding/reports-empty-hint'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { logger } from '@/lib/logger'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader, formatAmount } from '@/components/shared'
import { Separator } from '@/components/ui/separator'
import { Download, RefreshCw, Calendar, EyeOff } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  TRIAL_BALANCE_PAIRS,
  pairAmounts,
  pairHeadings,
  pairTotals,
  type TrialBalanceColumnPair,
} from '@/components/features/reports/trial-balance-columns'
import type { TrialBalanceData } from '@/lib/reports/trial-balance/get-trial-balance.service'
import { formatTransactionDate } from '@/lib/utils/date'

interface FiscalYear {
  id: string
  year: number
  startDate: string
  endDate: string
}

export default function TrialBalancePage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const [trialBalance, setTrialBalance] = useState<TrialBalanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState<'fiscalYear' | 'dateRange'>('fiscalYear')
  const [selectedFiscalYearId, setSelectedFiscalYearId] = useState<string>('')
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [showZeroBalances, setShowZeroBalances] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  // Below 1024px: one pair of amounts per account, the balances first.
  const [columnPair, setColumnPair] = useState<TrialBalanceColumnPair>('closing')

  useEffect(() => {
    async function loadFiscalYears() {
      if (!companyId) return

      try {
        const response = await fetch(`/api/companies/${companyId}`)
        if (response.ok) {
          const companyData = await response.json()
          const years = companyData.fiscalYears || []
          setFiscalYears(years)
          
          // Sélectionner le dernier exercice par défaut
          if (years.length > 0) {
            const latestYear = years.sort((a: FiscalYear, b: FiscalYear) => b.year - a.year)[0]
            setSelectedFiscalYearId(latestYear.id)
          }
        }
      } catch (error) {
        logger.error('Error loading fiscal years:', error)
      }
    }

    if (companyId) {
      loadFiscalYears()
      const year = new Date().getFullYear()
      setStartDate(`${year}-01-01`)
      setEndDate(`${year}-12-31`)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId && (filterType === 'fiscalYear' ? selectedFiscalYearId : (startDate && endDate))) {
      loadTrialBalance()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, selectedFiscalYearId, startDate, endDate, filterType])

  const loadTrialBalance = async () => {
    if (!companyId) return

    setLoading(true)
    try {
      const params = new URLSearchParams({
        companyId: companyId,
      })

      if (filterType === 'fiscalYear' && selectedFiscalYearId) {
        params.append('fiscalYearId', selectedFiscalYearId)
      } else {
        if (startDate) params.append('startDate', startDate)
        if (endDate) params.append('endDate', endDate)
      }

      const response = await fetch(`/api/reports/trial-balance?${params.toString()}`)
      if (response.ok) {
        const data = await response.json()
        setTrialBalance(data)
      }
    } catch (error) {
      logger.error('Error loading trial balance:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value: number) => formatAmount(value)

  const filteredBalances = trialBalance?.balances.filter((balance) => {
    // Hide only accounts with no activity at all (no debit and no credit movement).
    // Accounts whose debit/credit net to zero (clearing, VAT, etc.) are still
    // meaningful and must be shown. The toggle below lets the user also display
    // truly empty accounts when needed.
    if (
      !showZeroBalances &&
      Math.abs(balance.debit) < 0.01 &&
      Math.abs(balance.credit) < 0.01 &&
      Math.abs(balance.balance) < 0.01
    ) {
      return false
    }
    
    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      return (
        balance.code.toLowerCase().includes(query) ||
        balance.label.toLowerCase().includes(query)
      )
    }
    
    return true
  }) || []

  if (!companyId) {
    return (
      <NoCompanySelected 
        description="Veuillez sélectionner une société"
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Header avec titre et actions */}
      <PageHeader
        title="Balance"
        description="Liste de tous les comptes avec leurs soldes débit/crédit"
        actions={
          <Button
            variant="outline"
            onClick={loadTrialBalance}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Actualiser
          </Button>
        }
      />
      <ReportsEmptyHint companyId={companyId} />

      {/* Contrôles de filtrage */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Période
          </CardTitle>
          <CardDescription>
            Sélectionnez la période pour laquelle vous souhaitez consulter la balance
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <Label className="text-base">Période</Label>
            <RadioGroup
              value={filterType}
              onValueChange={(value) => setFilterType(value as 'fiscalYear' | 'dateRange')}
              className="flex gap-6"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="fiscalYear" id="period-fiscal-year" />
                <Label htmlFor="period-fiscal-year" className="cursor-pointer font-normal">
                  Exercice
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="dateRange" id="period-date-range" />
                <Label htmlFor="period-date-range" className="cursor-pointer font-normal">
                  Période personnalisée
                </Label>
              </div>
            </RadioGroup>
          </div>

          <Separator />

          {filterType === 'fiscalYear' ? (
            <div className="space-y-2">
              <Label htmlFor="fiscalYear" className="text-base">Exercice</Label>
              <Select
                value={selectedFiscalYearId}
                onValueChange={setSelectedFiscalYearId}
              >
                <SelectTrigger id="fiscalYear" className="w-full sm:w-72">
                  <SelectValue placeholder="Sélectionner un exercice" />
                </SelectTrigger>
                <SelectContent>
                  {fiscalYears
                    .sort((a, b) => b.year - a.year)
                    .map((fy) => (
                      <SelectItem key={fy.id} value={fy.id}>
                        {fy.year}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="startDate" className="text-base">Date de début</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate" className="text-base">Date de fin</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Contrôles d'affichage */}
      <Card>
        <CardHeader>
          <CardTitle>Options d'affichage</CardTitle>
          <CardDescription>
            Personnalisez l'affichage de la balance
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="search" className="text-base">Rechercher</Label>
            <Input
              id="search"
              placeholder="Rechercher par code ou libellé..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between pt-2 border-t">
            <div className="space-y-0.5">
              <Label htmlFor="showZeroBalances" className="text-sm font-normal cursor-pointer">
                Afficher les comptes sans mouvement
              </Label>
              <p className="text-xs text-muted-foreground">
                Inclure les comptes sans aucun débit ni crédit sur la période
              </p>
            </div>
            <Switch
              id="showZeroBalances"
              checked={showZeroBalances}
              onCheckedChange={setShowZeroBalances}
            />
          </div>
        </CardContent>
      </Card>

      {/* Tableau de balance */}
      {loading ? (
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : !trialBalance ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              Erreur lors du chargement de la balance
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Balance</CardTitle>
            <CardDescription>
              Exercice {trialBalance.fiscalYear.year}, période du {formatTransactionDate(trialBalance.period.startDate)} au{' '}
              {formatTransactionDate(trialBalance.period.endDate)}. À-nouveaux&nbsp;: soldes reportés (journal AN) et
              écritures antérieures à la période.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-3 lg:hidden">
              <ToggleGroup
                type="single"
                variant="outline"
                value={columnPair}
                onValueChange={(value) => {
                  if (value) setColumnPair(value as TrialBalanceColumnPair)
                }}
                aria-label="Montants affichés"
                className="w-full"
              >
                {TRIAL_BALANCE_PAIRS.map((pair) => (
                  <ToggleGroupItem key={pair.value} value={pair.value} className="flex-1">
                    {pair.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {filteredBalances.length === 0 ? (
                <p className="text-muted-foreground rounded-md border px-3 py-8 text-center text-sm">Aucun compte trouvé</p>
              ) : (
                <ul className="divide-y rounded-md border" aria-label="Balance">
                  <li className="text-muted-foreground bg-muted/40 flex justify-between gap-3 px-3 py-2 text-xs" aria-hidden>
                    <span>Compte</span>
                    <span className="text-right">
                      {pairHeadings(columnPair).debit}
                      <br />
                      {pairHeadings(columnPair).credit}
                    </span>
                  </li>
                  {filteredBalances.map((balance) => {
                    const amounts = pairAmounts(balance, columnPair)
                    return (
                      <li key={balance.accountId} className="flex items-start justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                          <div className="font-mono text-sm">{balance.code}</div>
                          <div className="text-muted-foreground text-xs break-words">{balance.label}</div>
                        </div>
                        <dl className="num shrink-0 text-right text-sm">
                          <div className="flex items-baseline justify-end gap-2">
                            <dt className="text-muted-foreground text-xs">D</dt>
                            <dd className={columnPair === 'closing' ? 'font-semibold' : undefined}>
                              <span className="sr-only">{pairHeadings(columnPair).debit}&nbsp;: </span>
                              {amounts.debit > 0 ? formatCurrency(amounts.debit) : '-'}
                            </dd>
                          </div>
                          <div className="flex items-baseline justify-end gap-2">
                            <dt className="text-muted-foreground text-xs">C</dt>
                            <dd className={columnPair === 'closing' ? 'font-semibold' : undefined}>
                              <span className="sr-only">{pairHeadings(columnPair).credit}&nbsp;: </span>
                              {amounts.credit > 0 ? formatCurrency(amounts.credit) : '-'}
                            </dd>
                          </div>
                        </dl>
                      </li>
                    )
                  })}
                  <li className="bg-muted/50 flex items-start justify-between gap-3 border-t-2 border-t-foreground px-3 py-2.5 font-bold">
                    <span>TOTAL</span>
                    <dl className="num text-right text-sm">
                      <div className="flex items-baseline justify-end gap-2">
                        <dt className="text-muted-foreground text-xs font-normal">D</dt>
                        <dd>{formatCurrency(pairTotals(trialBalance.totals, columnPair).debit)}</dd>
                      </div>
                      <div className="flex items-baseline justify-end gap-2">
                        <dt className="text-muted-foreground text-xs font-normal">C</dt>
                        <dd>{formatCurrency(pairTotals(trialBalance.totals, columnPair).credit)}</dd>
                      </div>
                    </dl>
                  </li>
                </ul>
              )}
            </div>
            <div className="hidden rounded-md border lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Code</TableHead>
                    <TableHead>Libellé</TableHead>
                    <TableHead numeric>À-nouveaux débit</TableHead>
                    <TableHead numeric>À-nouveaux crédit</TableHead>
                    <TableHead numeric>Mouvements débit</TableHead>
                    <TableHead numeric>Mouvements crédit</TableHead>
                    <TableHead numeric>Solde débiteur</TableHead>
                    <TableHead numeric>Solde créditeur</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBalances.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
                        Aucun compte trouvé
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {filteredBalances.map((balance) => (
                        <TableRow key={balance.accountId}>
                          <TableCell className="font-mono text-sm">{balance.code}</TableCell>
                          <TableCell>{balance.label}</TableCell>
                          <TableCell numeric>
                            {balance.openingDebit > 0 ? formatCurrency(balance.openingDebit) : '-'}
                          </TableCell>
                          <TableCell numeric>
                            {balance.openingCredit > 0 ? formatCurrency(balance.openingCredit) : '-'}
                          </TableCell>
                          <TableCell numeric>
                            {balance.movementDebit > 0 ? formatCurrency(balance.movementDebit) : '-'}
                          </TableCell>
                          <TableCell numeric>
                            {balance.movementCredit > 0 ? formatCurrency(balance.movementCredit) : '-'}
                          </TableCell>
                          <TableCell numeric className="font-semibold">
                            {balance.closingDebit > 0 ? formatCurrency(balance.closingDebit) : '-'}
                          </TableCell>
                          <TableCell numeric className="font-semibold">
                            {balance.closingCredit > 0 ? formatCurrency(balance.closingCredit) : '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                      {/* Ligne de totaux */}
                      <TableRow className="border-t-2 border-t-foreground bg-muted/50 font-bold">
                        <TableCell colSpan={2} className="font-bold">
                          TOTAL
                        </TableCell>
                        <TableCell numeric className="font-bold">
                          {formatCurrency(trialBalance.totals.opening.debit)}
                        </TableCell>
                        <TableCell numeric className="font-bold">
                          {formatCurrency(trialBalance.totals.opening.credit)}
                        </TableCell>
                        <TableCell numeric className="font-bold">
                          {formatCurrency(trialBalance.totals.movements.debit)}
                        </TableCell>
                        <TableCell numeric className="font-bold">
                          {formatCurrency(trialBalance.totals.movements.credit)}
                        </TableCell>
                        <TableCell numeric className="font-bold">
                          {formatCurrency(trialBalance.totals.closing.debit)}
                        </TableCell>
                        <TableCell numeric className="font-bold">
                          {formatCurrency(trialBalance.totals.closing.credit)}
                        </TableCell>
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
