'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowRight } from 'lucide-react'

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Amount, DateDisplay, StatCard } from '@/components/shared'
import { logger } from '@/lib/logger'
import { toCents } from '@/lib/utils/money'
import {
  AccountBalanceEvolutionChart,
  type AccountBalanceEvolutionData,
} from '@/components/features/accounting/account-balance-evolution-chart'
import { BALANCE_SIDE_LABELS, balanceSide, runningBalances } from './account-ledger'
import { LEDGER } from './ledger-layout'
import { cn } from '@/lib/utils'

interface AccountDetailsProps {
  accountId: string
  onAccountDeleted?: () => void
}

interface AccountData {
  account: {
    id: string
    code: string
    label: string
  }
  entryLines: Array<{
    id: string
    debit: number
    credit: number
    description: string | null
    accountingEntry: {
      id: string
      entryNumber: string
      date: string
      description: string | null
      reference: string | null
      journal: {
        code: string
        label: string
      }
    }
  }>
  totals: {
    debit: number
    credit: number
    balance: number
  }
}

const RECENT_LINES = 10

/** Summary of one account on the Comptes page: totals, monthly evolution and its latest lines. */
export function AccountDetails({ accountId }: AccountDetailsProps) {
  const params = useParams()
  const companyId = params?.companyId as string | undefined
  const [data, setData] = useState<AccountData | null>(null)
  const [evolutionData, setEvolutionData] = useState<AccountBalanceEvolutionData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadAccountDetails = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/accounts/${accountId}/entries`)
      if (response.ok) {
        setData((await response.json()) as AccountData)
      } else {
        setError("Le détail du compte n'a pas pu être chargé. Réessayez.")
      }
    } catch (err) {
      logger.error('Error loading account details:', err)
      setError("Le détail du compte n'a pas pu être chargé. Réessayez.")
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    if (accountId) void loadAccountDetails()
  }, [accountId, loadAccountDetails])

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    fetch(`/api/accounts/${accountId}/balance-evolution`)
      .then((res) => (res.ok ? res.json() : []))
      .then((evolution: AccountBalanceEvolutionData[]) => {
        if (!cancelled) setEvolutionData(evolution ?? [])
      })
      .catch(() => {
        if (!cancelled) setEvolutionData([])
      })
    return () => {
      cancelled = true
    }
  }, [accountId])

  if (loading) {
    return (
      <div className="space-y-6" aria-busy>
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-48" />
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                <TableSkeleton columns={6} rows={5} />
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          <p>{error}</p>
          <Button size="sm" variant="outline" onClick={() => void loadAccountDetails()}>
            Réessayer
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (!data) {
    return null
  }

  const { account, entryLines, totals } = data
  const balances = runningBalances(entryLines)
  // Most recent first, each with the balance after it
  const recent = entryLines
    .map((line, index) => ({ line, balance: balances[index] }))
    .slice(-RECENT_LINES)
    .reverse()
  const side = balanceSide(totals.balance)
  const entriesHref = companyId ? `/${companyId}/accounts/${account.id}/entries` : `/accounts/${account.id}/entries`

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total débit" value={<Amount value={totals.debit} />} />
        <StatCard label="Total crédit" value={<Amount value={totals.credit} />} />
        <StatCard
          label="Solde"
          value={<Amount value={Math.abs(totals.balance)} />}
          hint={BALANCE_SIDE_LABELS[side]}
        />
      </div>

      {evolutionData.length > 0 && <AccountBalanceEvolutionChart data={evolutionData} />}

      <Card>
        <CardHeader>
          <CardTitle>Dernières écritures</CardTitle>
          <CardDescription>
            {entryLines.length > RECENT_LINES
              ? `Compte ${account.code}\u00a0: les ${RECENT_LINES} plus récentes sur ${entryLines.length} lignes.`
              : `Compte ${account.code}, la plus récente en premier.`}
          </CardDescription>
          <CardAction>
            <Button asChild size="sm" variant="outline">
              <Link href={entriesHref}>
                Voir toutes les écritures
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className={LEDGER.container}>
          <Table className={LEDGER.table}>
            <TableHeader className={LEDGER.header}>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Journal</TableHead>
                <TableHead>N° de pièce</TableHead>
                <TableHead>Libellé</TableHead>
                <TableHead numeric>Débit</TableHead>
                <TableHead numeric>Crédit</TableHead>
                <TableHead numeric>Solde</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.length === 0 ? (
                <TableEmpty colSpan={7}>
                  Aucune écriture sur ce compte. Les écritures validées ou en brouillon qui l&apos;utilisent apparaîtront ici.
                </TableEmpty>
              ) : (
                recent.map(({ line, balance }) => (
                  <TableRow key={line.id} className={LEDGER.row}>
                    <TableCell className={LEDGER.date}>
                      <DateDisplay value={line.accountingEntry.date} />
                    </TableCell>
                    <TableCell className={LEDGER.journal}>
                      <span title={line.accountingEntry.journal.label}>
                        <span className="font-mono text-xs">{line.accountingEntry.journal.code}</span>
                        <span className="sr-only"> {line.accountingEntry.journal.label}</span>
                      </span>
                    </TableCell>
                    <TableCell className={cn('font-mono text-xs', LEDGER.piece)}>{line.accountingEntry.entryNumber}</TableCell>
                    <TableCell
                      className={cn('max-w-72 truncate', LEDGER.label)}
                      title={line.description || line.accountingEntry.description || undefined}
                    >
                      {line.description || line.accountingEntry.description || (
                        <span className="text-muted-foreground">Sans libellé</span>
                      )}
                    </TableCell>
                    <TableCell numeric data-label="Débit" className={LEDGER.amount}>
                      {toCents(line.debit) ? <Amount value={line.debit} /> : null}
                    </TableCell>
                    <TableCell numeric data-label="Crédit" className={LEDGER.amount}>
                      {toCents(line.credit) ? <Amount value={line.credit} /> : null}
                    </TableCell>
                    <TableCell numeric data-label="Solde" className={LEDGER.balance}>
                      <Amount value={balance} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
