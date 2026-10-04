'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { EntryForm } from '@/components/features/accounting/entry-form'
import { Skeleton } from '@/components/ui/skeleton'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { PageHeader } from '@/components/shared'
import { logger } from '@/lib/logger'

interface Journal {
  id: string
  code: string
  label: string
}

interface Account {
  id: string
  code: string
  label: string
}

export default function NewEntryPage() {
  const params = useParams()
  const companyId = params.companyId as string
  const [journals, setJournals] = useState<Journal[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      if (!companyId) {
        setLoading(false)
        return
      }

      setLoading(true)
      try {
        const [journalsResponse, accountsResponse] = await Promise.all([
          fetch(`/api/journals?companyId=${companyId}`),
          fetch(`/api/accounts?companyId=${companyId}`),
        ])

        if (journalsResponse.ok) {
          const journalsData = await journalsResponse.json()
          setJournals(journalsData)
        }

        if (accountsResponse.ok) {
          const accountsData = await accountsResponse.json()
          setAccounts(accountsData)
        }
      } catch (error) {
        logger.error('Error loading data:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [companyId])

  if (!companyId) {
    return (
      <NoCompanySelected 
        description="Choisissez une société pour saisir une écriture."
      />
    )
  }

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <PageHeader title="Nouvelle écriture" description="Chargement des journaux et des comptes." />
        <Skeleton className="h-56 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )
  }

  return (
    <EntryForm companyId={companyId} journals={journals} accounts={accounts} />
  )
}
