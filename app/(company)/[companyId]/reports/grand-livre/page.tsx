'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

import { logger } from '@/lib/logger'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/shared'
import { Separator } from '@/components/ui/separator'
import { Calendar } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { formatTransactionDate } from '@/lib/utils/date'
import { LEDGER } from '@/components/features/accounting/ledger-layout'
import { GrandLivreTable, type GrandLivreData } from '@/components/features/reports/grand-livre-table'

interface FiscalYear {
  id: string
  year: number
  startDate: string
  endDate: string
}

export default function GrandLivrePage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const [grandLivre, setGrandLivre] = useState<GrandLivreData | null>(null)
  const [loading, setLoading] = useState(false)
  const [filterType, setFilterType] = useState<'fiscalYear' | 'dateRange'>('fiscalYear')
  const [selectedFiscalYearId, setSelectedFiscalYearId] = useState<string | undefined>(undefined)
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  useEffect(() => {
    async function loadFiscalYears() {
      if (!companyId) return

      try {
        const response = await fetch(`/api/companies/${companyId}/fiscal-years`)
        if (response.ok) {
          const years = await response.json()
          setFiscalYears(years)
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
      loadGrandLivre()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, selectedFiscalYearId, startDate, endDate, filterType, fiscalYears])

  const loadGrandLivre = async () => {
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

      const response = await fetch(`/api/reports/grand-livre?${params.toString()}`)
      if (response.ok) {
        const data = await response.json()
        setGrandLivre(data)
      }
    } catch (error) {
      logger.error('Error loading grand livre:', error)
    } finally {
      setLoading(false)
    }
  }

  // Accounting dates are calendar days stored at midnight UTC.
  const formatDate = (dateString: string) => formatTransactionDate(dateString)

  if (!companyId) {
    return (
      <NoCompanySelected 
        description="Veuillez sélectionner une société"
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Header avec titre */}
      <PageHeader
        title="Grand livre"
        description="Registre détaillé de tous les comptes avec leurs écritures"
      />

      {/* Contrôles de filtrage */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Période
          </CardTitle>
          <CardDescription>
            Sélectionnez la période pour laquelle vous souhaitez consulter le grand livre
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
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
              <FiscalYearSelector
                companyId={companyId}
                value={selectedFiscalYearId}
                onValueChange={setSelectedFiscalYearId}
              />
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

      {/* Tableau du grand livre */}
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
      ) : !grandLivre ? (
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
            <CardTitle>Grand Livre</CardTitle>
            <CardDescription>
              Exercice {grandLivre.fiscalYear.year}, du {formatDate(grandLivre.period.startDate)} au{' '}
              {formatDate(grandLivre.period.endDate)}. Le report à nouveau reprend les à-nouveaux (journal AN) et
              les écritures antérieures à la période.
            </CardDescription>
          </CardHeader>
          <CardContent className={LEDGER.container}>
            <GrandLivreTable data={grandLivre} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
