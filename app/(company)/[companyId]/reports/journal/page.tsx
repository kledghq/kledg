'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { logger } from '@/lib/logger'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader, formatDisplayDate } from '@/components/shared'
import { Separator } from '@/components/ui/separator'
import { RefreshCw, Calendar } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { LEDGER } from '@/components/features/accounting/ledger-layout'
import { JournalReportTable, type JournalReportData } from '@/components/features/reports/journal-report-table'

interface FiscalYear {
  id: string
  year: number
  startDate: string
  endDate: string
}

interface Journal {
  id: string
  code: string
  label: string
}

export default function JournalPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const [journalData, setJournalData] = useState<JournalReportData | null>(null)
  const [journals, setJournals] = useState<Journal[]>([])
  const [selectedJournalId, setSelectedJournalId] = useState<string>('all')
  const [loading, setLoading] = useState(false)
  const [filterType, setFilterType] = useState<'fiscalYear' | 'dateRange'>('fiscalYear')
  const [selectedFiscalYearId, setSelectedFiscalYearId] = useState<string>('')
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  useEffect(() => {
    async function loadFiscalYears() {
      if (!companyId) return

      try {
        const response = await fetch(`/api/companies/${companyId}`)
        if (response.ok) {
          const companyData = await response.json()
          const years = companyData.fiscalYears || []
          setFiscalYears(years)
          
          if (years.length > 0) {
            const latestYear = years.sort((a: FiscalYear, b: FiscalYear) => b.year - a.year)[0]
            setSelectedFiscalYearId(latestYear.id)
          }
        }
      } catch (error) {
        logger.error('Error loading fiscal years:', error)
      }
    }

    async function loadJournals() {
      if (!companyId) return

      try {
        const response = await fetch(`/api/journals?companyId=${companyId}`)
        if (response.ok) {
          const data = await response.json()
          setJournals(data)
        }
      } catch (error) {
        logger.error('Error loading journals:', error)
      }
    }

    if (companyId) {
      loadFiscalYears()
      loadJournals()
      // Calendar days written directly: toISOString() of a local midnight is the
      // previous day east of UTC (31/12 instead of 01/01 in Paris)
      const year = new Date().getFullYear()
      setStartDate(`${year}-01-01`)
      setEndDate(`${year}-12-31`)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId && (filterType === 'fiscalYear' ? selectedFiscalYearId : (startDate && endDate))) {
      loadJournal()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, selectedJournalId, selectedFiscalYearId, startDate, endDate, filterType])

  const loadJournal = async () => {
    if (!companyId) return

    setLoading(true)
    try {
      const params = new URLSearchParams({
        companyId: companyId,
        journalId: selectedJournalId,
      })

      if (filterType === 'fiscalYear' && selectedFiscalYearId) {
        const fiscalYear = fiscalYears.find(fy => fy.id === selectedFiscalYearId)
        if (fiscalYear) {
          params.append('startDate', fiscalYear.startDate)
          params.append('endDate', fiscalYear.endDate)
        }
      } else {
        if (startDate) params.append('startDate', startDate)
        if (endDate) params.append('endDate', endDate)
      }

      const response = await fetch(`/api/reports/journal?${params.toString()}`)
      if (response.ok) {
        const data = await response.json()
        setJournalData(data)
      }
    } catch (error) {
      logger.error('Error loading journal:', error)
    } finally {
      setLoading(false)
    }
  }

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
        title="Journal comptable"
        description="Livre-journal&nbsp;: enregistrement chronologique de toutes les écritures"
        actions={
          <Button
            variant="outline"
            onClick={loadJournal}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Actualiser
          </Button>
        }
      />

      {/* Contrôles de filtrage */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Filtres
          </CardTitle>
          <CardDescription>
            Sélectionnez le journal et la période pour consulter le livre-journal
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="journal" className="text-base">Journal</Label>
            <Select value={selectedJournalId} onValueChange={setSelectedJournalId}>
              <SelectTrigger id="journal" className="w-full sm:w-72">
                <SelectValue placeholder="Sélectionner un journal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les journaux</SelectItem>
                {journals.map((journal) => (
                  <SelectItem key={journal.id} value={journal.id}>
                    {journal.code} - {journal.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="space-y-3">
            <Label className="text-base">Période</Label>
            <RadioGroup
              value={filterType}
              onValueChange={(value) => setFilterType(value as 'fiscalYear' | 'dateRange')}
              aria-label="Période"
              className="flex flex-wrap gap-x-6 gap-y-3"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="fiscalYear" id="period-fiscal-year" />
                <Label htmlFor="period-fiscal-year" className="cursor-pointer font-normal">
                  Exercice
                </Label>
              </div>
              <div className="flex items-center gap-2">
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

      {/* Tableau du journal */}
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
      ) : !journalData ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              Aucune donnée disponible
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Livre-journal</CardTitle>
            <CardDescription>
              {filterType === 'fiscalYear' && selectedFiscalYearId ? (
                <>
                  Exercice {fiscalYears.find(fy => fy.id === selectedFiscalYearId)?.year}
                  {', '}
                  du {formatDisplayDate(fiscalYears.find(fy => fy.id === selectedFiscalYearId)?.startDate)} au {formatDisplayDate(fiscalYears.find(fy => fy.id === selectedFiscalYearId)?.endDate)}
                </>
              ) : (
                <>
                  Du {formatDisplayDate(startDate)} au {formatDisplayDate(endDate)}
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className={LEDGER.container}>
            <JournalReportTable data={journalData} showJournalHeaders={selectedJournalId === 'all'} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
