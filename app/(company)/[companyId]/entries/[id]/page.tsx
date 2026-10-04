'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, Copy, FileQuestion, Lock, Pencil, Undo2 } from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Amount, DateDisplay, EmptyState, PageHeader, StatusBadge, formatDisplayDate } from '@/components/shared'
import { ReverseEntryDialog } from '@/components/features/accounting/reverse-entry-dialog'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import { parseCents, sumCents } from '@/lib/utils/money'

interface EntryLine {
  id: string
  debit: string | number
  credit: string | number
  description?: string | null
  auxiliaryAccountNumber?: string | null
  auxiliaryAccountLabel?: string | null
  letteringCode?: string | null
  account: {
    code: string
    label: string
  }
}

interface LinkedEntry {
  id: string
  entryNumber: string
}

interface Entry {
  id: string
  entryNumber: string
  date: string
  description?: string | null
  reference?: string | null
  status: string
  validatedAt?: string | null
  journal: {
    code: string
    label: string
  }
  lines: EntryLine[]
  reversalOf?: LinkedEntry | null
  reversedBy?: LinkedEntry | null
}

const cents = (value: string | number) => parseCents(String(value)) ?? 0

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-1 text-sm break-words">{children}</dd>
    </div>
  )
}

/**
 * Lines table under 36rem of container width (phones): each line becomes a
 * card (account, label, then the debit or credit with its name). Full class
 * strings so that Tailwind generates them.
 */
const STACK = {
  table: '@max-[36rem]/lines:block @max-[36rem]/lines:[&>tbody]:block @max-[36rem]/lines:[&>tfoot]:block',
  hidden: '@max-[36rem]/lines:hidden',
  row: '@max-[36rem]/lines:flex @max-[36rem]/lines:flex-wrap @max-[36rem]/lines:items-baseline @max-[36rem]/lines:gap-x-3 @max-[36rem]/lines:gap-y-1 @max-[36rem]/lines:px-3 @max-[36rem]/lines:py-2.5',
  full: '@max-[36rem]/lines:w-full @max-[36rem]/lines:min-w-0 @max-[36rem]/lines:p-0',
  amount:
    '@max-[36rem]/lines:p-0 @max-[36rem]/lines:empty:hidden @max-[36rem]/lines:before:mr-1.5 @max-[36rem]/lines:before:text-xs @max-[36rem]/lines:before:font-normal @max-[36rem]/lines:before:text-muted-foreground @max-[36rem]/lines:before:content-[attr(data-label)]',
} as const

export default function EntryDetailPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const entryId = params.id as string
  const companyId = params.companyId as string
  const [entry, setEntry] = useState<Entry | null>(null)
  const [loading, setLoading] = useState(true)
  const [validating, setValidating] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [reverseOpen, setReverseOpen] = useState(false)

  const loadEntry = useCallback(async () => {
    if (!entryId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const response = await fetch(`/api/entries/${entryId}`)
      if (response.ok) {
        const data: Entry = await response.json()
        setEntry(data)
        if (searchParams.get('contrepasser') === '1' && data.status === 'validated' && !data.reversedBy) {
          setReverseOpen(true)
        }
      }
    } catch (error) {
      logger.error('Error loading entry:', error)
    } finally {
      setLoading(false)
    }
  }, [entryId, searchParams])

  useEffect(() => {
    loadEntry()
  }, [loadEntry])

  const handleValidate = async () => {
    if (!entry) return
    setValidating(true)
    try {
      const response = await fetch(`/api/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'validated' }),
      })
      const data = await response.json()
      if (response.ok) {
        setEntry(data)
        toast.success(`Écriture validée sous le n° ${data.entryNumber}`)
      } else {
        toast.error(data.error || 'La validation a échoué. Réessayez dans un instant.')
      }
    } catch (error) {
      logger.error('Error validating entry:', error)
      toast.error("Le serveur n'a pas répondu. Vérifiez votre connexion puis réessayez.")
    } finally {
      setValidating(false)
    }
  }

  const handleDuplicate = async () => {
    if (!entry) return
    setDuplicating(true)
    try {
      const response = await fetch(`/api/entries/${entryId}/duplicate`, { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        toast.success('Écriture dupliquée. Ouverture en modification.')
        router.push(`/${companyId}/entries/${data.id}/edit`)
      } else {
        toast.error(data.error || 'La duplication a échoué. Réessayez dans un instant.')
      }
    } catch (error) {
      logger.error('Error duplicating entry:', error)
      toast.error("Le serveur n'a pas répondu. Vérifiez votre connexion puis réessayez.")
    } finally {
      setDuplicating(false)
    }
  }

  const backToList = (
    <Button variant="outline" asChild>
      <Link href={`/${companyId}/entries`}>
        <ArrowLeft aria-hidden />
        Écritures
      </Link>
    </Button>
  )

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )
  }

  if (!entry) {
    return (
      <div className="space-y-6">
        <PageHeader title="Écriture" actions={backToList} />
        <EmptyState
          bordered
          icon={FileQuestion}
          title="Écriture introuvable"
          description="Elle a peut-être été supprimée, ou appartient à une autre société. Retrouvez vos écritures dans la liste."
          action={
            <Button size="sm" variant="outline" asChild>
              <Link href={`/${companyId}/entries`}>Voir les écritures</Link>
            </Button>
          }
        />
      </div>
    )
  }

  const isValidated = entry.status === 'validated'
  const totalDebit = Number(sumCents(entry.lines.map((line) => cents(line.debit))))
  const totalCredit = Number(sumCents(entry.lines.map((line) => cents(line.credit))))

  return (
    <div className="space-y-6">
      <PageHeader
        title={isValidated ? `Écriture n° ${entry.entryNumber}` : "Brouillon d'écriture"}
        description={
          <>
            {entry.journal.label}, <DateDisplay value={entry.date} format="long" />
          </>
        }
        actions={
          <>
            {backToList}
            {!isValidated ? (
              <Button variant="outline" asChild>
                <Link href={`/${companyId}/entries/${entryId}/edit`}>
                  <Pencil aria-hidden />
                  Modifier
                </Link>
              </Button>
            ) : null}
            <Button variant="outline" onClick={handleDuplicate} loading={duplicating}>
              <Copy aria-hidden />
              Dupliquer
            </Button>
            {isValidated ? (
              !entry.reversedBy && (
                <Button variant="outline" onClick={() => setReverseOpen(true)}>
                  <Undo2 aria-hidden />
                  Contre-passer
                </Button>
              )
            ) : (
              <Button onClick={handleValidate} loading={validating}>
                <CheckCircle2 aria-hidden />
                Valider
              </Button>
            )}
          </>
        }
      />

      {isValidated && (
        <Alert>
          <Lock aria-hidden />
          <AlertDescription>
            Écriture validée{entry.validatedAt ? ` le ${formatDisplayDate(entry.validatedAt, 'datetime')}` : ''} : elle est
            définitive et ne peut plus être modifiée ni supprimée. Pour la corriger, contre-passez-la puis saisissez
            l&apos;écriture correcte.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Informations générales</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="Date">
              <DateDisplay value={entry.date} />
            </Detail>
            <Detail label="Journal">
              <span className="font-mono text-xs">{entry.journal.code}</span> {entry.journal.label}
            </Detail>
            <Detail label="Numéro">
              {isValidated ? <span className="num">{entry.entryNumber}</span> : <span className="text-muted-foreground">Attribué à la validation</span>}
            </Detail>
            <Detail label="Statut">
              {isValidated ? <StatusBadge tone="success">Validée</StatusBadge> : <StatusBadge tone="warning">Brouillon</StatusBadge>}
            </Detail>
            {entry.reference ? <Detail label="Référence">{entry.reference}</Detail> : null}
            {entry.description ? <Detail label="Description">{entry.description}</Detail> : null}
            {entry.reversalOf ? (
              <Detail label="Contre-passation de">
                <Link className="text-link underline-offset-4 hover:underline" href={`/${companyId}/entries/${entry.reversalOf.id}`}>
                  l&apos;écriture n° {entry.reversalOf.entryNumber}
                </Link>
              </Detail>
            ) : null}
            {entry.reversedBy ? (
              <Detail label="Contre-passée par">
                <Link className="text-link underline-offset-4 hover:underline" href={`/${companyId}/entries/${entry.reversedBy.id}`}>
                  l&apos;écriture n° {entry.reversedBy.entryNumber}
                </Link>
              </Detail>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lignes d&apos;écriture</CardTitle>
          <CardDescription>Les comptes débités et crédités.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Narrow containers: one card per line, the debit or credit named in place */}
          <div className="@container/lines rounded-lg border">
            <Table className={STACK.table}>
              <TableHeader className={STACK.hidden}>
                <TableRow>
                  <TableHead>Compte</TableHead>
                  <TableHead>Libellé</TableHead>
                  <TableHead numeric>Débit</TableHead>
                  <TableHead numeric>Crédit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entry.lines.map((line) => (
                  <TableRow key={line.id} className={STACK.row}>
                    <TableCell className={cn('min-w-48 whitespace-normal', STACK.full)}>
                      <span className="font-mono text-xs">{line.account.code}</span> {line.account.label}
                      {line.auxiliaryAccountNumber && (
                        <span className="text-muted-foreground block text-xs">
                          Compte auxiliaire <span className="font-mono">{line.auxiliaryAccountNumber}</span>
                          {line.auxiliaryAccountLabel ? `, ${line.auxiliaryAccountLabel}` : ''}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className={cn('whitespace-normal', STACK.full, '@max-[36rem]/lines:text-muted-foreground')}>
                      {line.description || <span className="text-muted-foreground">Sans libellé</span>}
                      {line.letteringCode && (
                        <span className="text-muted-foreground block text-xs">Lettrage {line.letteringCode}</span>
                      )}
                    </TableCell>
                    <TableCell numeric data-label="Débit" className={STACK.amount}>
                      {cents(line.debit) !== 0 ? <Amount value={cents(line.debit) / 100} /> : null}
                    </TableCell>
                    <TableCell numeric data-label="Crédit" className={STACK.amount}>
                      {cents(line.credit) !== 0 ? <Amount value={cents(line.credit) / 100} /> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className={STACK.row}>
                  <TableCell colSpan={2} className={STACK.full}>
                    Total
                  </TableCell>
                  <TableCell numeric data-label="Débit" className={STACK.amount}>
                    <Amount value={totalDebit / 100} />
                  </TableCell>
                  <TableCell numeric data-label="Crédit" className={STACK.amount}>
                    <Amount value={totalCredit / 100} />
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>

      {isValidated && (
        <ReverseEntryDialog
          open={reverseOpen}
          onOpenChange={setReverseOpen}
          entry={entry}
          onReversed={(reversal) => router.push(`/${companyId}/entries/${reversal.id}`)}
        />
      )}
    </div>
  )
}
