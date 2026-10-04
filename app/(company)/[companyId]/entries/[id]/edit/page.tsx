'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { EntryForm } from '@/components/features/accounting/entry-form'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { ArrowLeft, FileQuestion, Undo2 } from 'lucide-react'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { EmptyState, PageHeader } from '@/components/shared'
import { logger } from '@/lib/logger'
import { toIsoDateUtc } from '@/lib/utils/date'
import { parseCents } from '@/lib/utils/money'
import { Alert, AlertDescription } from '@/components/ui/alert'
import Link from 'next/link'

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

interface EntryLine {
  id: string
  debit: number
  credit: number
  description?: string | null
  account: {
    id: string
    code: string
    label: string
  }
}

interface Entry {
  id: string
  journalId: string
  date: string
  description?: string | null
  reference?: string | null
  fiscalYearId?: string | null
  status: string
  entryNumber: string
  lines: EntryLine[]
}

export default function EditEntryPage() {
  const params = useParams()
  const router = useRouter()
  const entryId = params.id as string
  const companyId = params.companyId as string
  const [journals, setJournals] = useState<Journal[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [entry, setEntry] = useState<Entry | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      if (!companyId || !entryId) {
        setLoading(false)
        return
      }

      setLoading(true)
      try {
        const [journalsResponse, entryResponse] = await Promise.all([
          fetch(`/api/journals?companyId=${companyId}`),
          fetch(`/api/entries/${entryId}`),
        ])

        if (journalsResponse.ok) {
          const journalsData = await journalsResponse.json()
          setJournals(journalsData)
        }

        if (entryResponse.ok) {
          const entryData = await entryResponse.json()
          setEntry(entryData)
          // Load accounts for the entry's fiscal year (not the latest one)
          if (entryData.fiscalYearId) {
            const accountsResponse = await fetch(
              `/api/accounts?companyId=${companyId}&fiscalYearId=${entryData.fiscalYearId}`
            )
            if (accountsResponse.ok) {
              const accountsData = await accountsResponse.json()
              setAccounts(accountsData)
            }
          }
        } else if (entryResponse.status === 404) {
          router.push(`/${companyId}/entries`)
        }
      } catch (error) {
        logger.error('Error loading data:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [companyId, entryId, router])

  const initialData = useMemo(() => {
    if (!entry) return null
    return {
      journalId: entry.journalId,
      date: toIsoDateUtc(entry.date),
      description: entry.description || '',
      reference: entry.reference || '',
      fiscalYearId: entry.fiscalYearId || undefined,
      lines: entry.lines.map((line) => ({
        accountId: line.account.id,
        // Exact cents (no float drift), back to a number with two decimals
        debit: (parseCents(String(line.debit)) ?? 0) / 100,
        credit: (parseCents(String(line.credit)) ?? 0) / 100,
        description: line.description || '',
      })),
    }
  }, [entry])

  if (!companyId) {
    return (
      <NoCompanySelected 
        description="Choisissez une société pour modifier une écriture."
      />
    )
  }

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <PageHeader title="Modifier l'écriture" description="Chargement du brouillon." />
        <Skeleton className="h-56 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )
  }

  if (!entry) {
    return (
      <div className="space-y-6">
        <PageHeader title="Modifier l'écriture" />
        <EmptyState
          bordered
          icon={FileQuestion}
          title="Écriture introuvable"
          description="Elle a peut-être été supprimée. Retrouvez vos écritures dans la liste."
          action={
            <Button size="sm" variant="outline" asChild>
              <Link href={`/${companyId}/entries`}>Voir les écritures</Link>
            </Button>
          }
        />
      </div>
    )
  }

  // A validated entry is definitive (PCG art. 1031-3): no edit form
  if (entry.status === 'validated') {
    return (
      <div className="space-y-6">
        <PageHeader title={`Écriture n° ${entry.entryNumber}`} description="Écriture validée" />
        <Alert>
          <AlertDescription>
            Cette écriture est validée&nbsp;: elle ne peut plus être modifiée. Pour la corriger, contre-passez-la depuis sa
            fiche puis saisissez l&apos;écriture correcte.
          </AlertDescription>
        </Alert>
        <Button variant="outline" asChild>
          <Link href={`/${companyId}/entries/${entryId}?contrepasser=1`}>
            <Undo2 aria-hidden />
            Contre-passer l&apos;écriture
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Modifier le brouillon"
        description="Un brouillon reste modifiable jusqu'à sa validation, qui lui donne son numéro définitif."
        actions={
          <Button variant="outline" asChild>
            <Link href={`/${companyId}/entries/${entryId}`}>
              <ArrowLeft aria-hidden />
              Retour à l&apos;écriture
            </Link>
          </Button>
        }
      />

      <EntryForm
        companyId={companyId}
        journals={journals}
        accounts={accounts}
        entryId={entryId}
        hideTitle={true}
        initialData={initialData ?? undefined}
      />
    </div>
  )
}
