'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Eye, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Prisma } from '@prisma/client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
} from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Amount, ConfirmDialog, DateDisplay, Field, PageHeader, StatCard, StatusBadge } from '@/components/shared'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { AccountCombobox } from '@/components/features/accounting/account-combobox'
import { BALANCE_SIDE_LABELS, balanceSide, runningBalances } from '@/components/features/accounting/account-ledger'
import { LEDGER } from '@/components/features/accounting/ledger-layout'
import { responseError } from '@/hooks/use-cursor-list'
import { docsUrl } from '@/lib/docs-links'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import { toCents } from '@/lib/utils/money'

type Account = Prisma.AccountGetPayload<object>

interface EntryLine {
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
    status: string
    journal: {
      code: string
      label: string
    }
  }
}

interface AccountEntriesData {
  account: {
    id: string
    code: string
    label: string
    isPCG: boolean
  }
  entryLines: EntryLine[]
  totals: {
    debit: number
    credit: number
    balance: number
  }
}

interface FiscalYear {
  id: string
  year: number
  startDate: string
  endDate: string
  isClosed?: boolean
}

const ALL = 'all'

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`

export default function AccountEntriesPage() {
  const params = useParams()
  const router = useRouter()
  const accountId = params.id as string
  const companyId = params?.companyId as string
  const [data, setData] = useState<AccountEntriesData | null>(null)
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([])
  const [selectedFiscalYearId, setSelectedFiscalYearId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [opening, setOpening] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [editCode, setEditCode] = useState('')
  const [editLabel, setEditLabel] = useState('')
  const [editParentId, setEditParentId] = useState<string>('')
  const [allAccounts, setAllAccounts] = useState<Account[]>([])
  const [editDialogAccounts, setEditDialogAccounts] = useState<Account[] | null>(null)
  const [editingAccountId, setEditingAccountId] = useState<string>('')
  const [editFiscalYearId, setEditFiscalYearId] = useState<string>('')

  useEffect(() => {
    if (!companyId) return
    let cancelled = false

    async function loadFiscalYears() {
      try {
        const response = await fetch(`/api/companies/${companyId}`)
        const list: FiscalYear[] = response.ok ? ((await response.json()).fiscalYears ?? []) : []
        if (cancelled) return
        setFiscalYears(list)
        // The open fiscal year by default, else the most recent one
        const open = list.find((fy) => !fy.isClosed)
        setSelectedFiscalYearId(open?.id ?? list[0]?.id ?? ALL)
      } catch (error) {
        logger.error('Error loading fiscal years:', error)
        if (!cancelled) setSelectedFiscalYearId(ALL)
      }
    }

    async function loadAllAccounts() {
      try {
        const response = await fetch(`/api/accounts?companyId=${companyId}`)
        if (response.ok && !cancelled) setAllAccounts((await response.json()) || [])
      } catch (error) {
        logger.error('Error loading accounts:', error)
      }
    }

    void loadFiscalYears()
    void loadAllAccounts()
    return () => {
      cancelled = true
    }
  }, [companyId])

  const entriesUrl = useCallback(
    (fiscalYearId: string | null) =>
      fiscalYearId && fiscalYearId !== ALL
        ? `/api/accounts/${accountId}/entries?fiscalYearId=${fiscalYearId}`
        : `/api/accounts/${accountId}/entries`,
    [accountId],
  )

  const loadAccountEntries = useCallback(async () => {
    if (!accountId || selectedFiscalYearId === null) return
    setLoading(true)
    setLoadError(null)
    try {
      const response = await fetch(entriesUrl(selectedFiscalYearId))
      if (response.ok) {
        setData((await response.json()) as AccountEntriesData)
      } else {
        setLoadError(await responseError(response, "Les écritures du compte n'ont pas pu être chargées. Réessayez."))
      }
    } catch (error) {
      logger.error('Error loading account entries:', error)
      setLoadError("Les écritures du compte n'ont pas pu être chargées. Réessayez.")
    } finally {
      setLoading(false)
    }
  }, [accountId, selectedFiscalYearId, entriesUrl])

  useEffect(() => {
    void loadAccountEntries()
  }, [loadAccountEntries])

  const openEditDialog = async () => {
    setEditError(null)
    setOpening(true)
    try {
      const accountResponse = await fetch(`/api/accounts/${accountId}`)
      if (!accountResponse.ok) {
        toast.error(await responseError(accountResponse, "Le compte n'a pas pu être chargé. Réessayez."))
        return
      }
      const accountData = (await accountResponse.json()) as Account
      setEditingAccountId(accountId)
      setEditFiscalYearId(accountData.fiscalYearId ?? '')
      setEditCode(accountData.code)
      setEditLabel(accountData.label)
      setEditParentId(accountData.parentId ?? '')
      setEditDialogAccounts(null)
      if (accountData.fiscalYearId && companyId) {
        const listResponse = await fetch(`/api/accounts?companyId=${companyId}&fiscalYearId=${accountData.fiscalYearId}`)
        if (listResponse.ok) setEditDialogAccounts(await listResponse.json())
      }
      setEditDialogOpen(true)
    } catch {
      toast.error("Le compte n'a pas pu être chargé. Réessayez.")
    } finally {
      setOpening(false)
    }
  }

  const changeEditFiscalYear = async (fiscalYearId: string) => {
    setEditFiscalYearId(fiscalYearId)
    setEditError(null)
    if (!companyId || !fiscalYearId) return
    try {
      const listResponse = await fetch(`/api/accounts?companyId=${companyId}&fiscalYearId=${fiscalYearId}`)
      if (!listResponse.ok) {
        setEditDialogAccounts(null)
        return
      }
      const list = (await listResponse.json()) as Account[]
      setEditDialogAccounts(list)
      const accountForYear = list.find((a) => a.code === editCode)
      if (accountForYear) {
        setEditingAccountId(accountForYear.id)
        setEditLabel(accountForYear.label)
        setEditParentId(accountForYear.parentId ?? '')
      } else {
        setEditError(`Aucun compte ${editCode} sur cet exercice. Créez-le d'abord dans le plan de comptes.`)
      }
    } catch {
      setEditError("Les comptes de cet exercice n'ont pas pu être chargés. Réessayez.")
    }
  }

  const saveAccount = async () => {
    if (!editCode || !editLabel) {
      setEditError('Le numéro et le libellé du compte sont obligatoires.')
      return
    }
    if (!editParentId) {
      setEditError('Choisissez le compte parent.')
      return
    }
    setEditing(true)
    setEditError(null)
    try {
      const response = await fetch(`/api/accounts/${editingAccountId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: editCode, label: editLabel, parentId: editParentId }),
      })
      if (!response.ok) {
        setEditError(await responseError(response, "Le compte n'a pas pu être modifié. Réessayez."))
        return
      }
      toast.success('Compte modifié')
      setEditDialogOpen(false)
      if (editingAccountId === accountId) await loadAccountEntries()
      router.refresh()
    } catch (error) {
      logger.error('Error updating account:', error)
      setEditError("Le compte n'a pas pu être modifié. Réessayez.")
    } finally {
      setEditing(false)
    }
  }

  const deleteAccount = async () => {
    setDeleting(true)
    try {
      const response = await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' })
      if (response.ok) {
        toast.success('Compte supprimé')
        router.push(`/${companyId}/accounts`)
        router.refresh()
        return
      }
      toast.error(await responseError(response, "Le compte n'a pas pu être supprimé. Réessayez."))
      setDeleteDialogOpen(false)
    } catch (error) {
      logger.error('Error deleting account:', error)
      toast.error("Le compte n'a pas pu être supprimé. Réessayez.")
      setDeleteDialogOpen(false)
    } finally {
      setDeleting(false)
    }
  }

  if (!companyId) {
    return <NoCompanySelected description="Choisissez une société pour voir les écritures de ses comptes." />
  }

  // First load: nothing to show yet
  if (!data) {
    if (loadError) {
      return (
        <Alert variant="destructive">
          <AlertDescription>
            <p>{loadError}</p>
            <Button size="sm" variant="outline" onClick={() => void loadAccountEntries()}>
              Réessayer
            </Button>
          </AlertDescription>
        </Alert>
      )
    }
    return (
      <div className="space-y-6" aria-busy>
        <Skeleton className="h-14 w-full max-w-md" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )
  }

  const { account, entryLines, totals } = data
  const linkedEntriesCount = new Set(entryLines.map((l) => l.accountingEntry.id)).size
  const balances = runningBalances(entryLines)
  const side = balanceSide(totals.balance)
  const selectedFiscalYear = fiscalYears.find((fy) => fy.id === selectedFiscalYearId)

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${account.code} ${account.label}`}
        description="Les lignes d'écriture du compte, de la plus ancienne à la plus récente, avec le solde après chaque ligne."
        docsHref={docsUrl('chartOfAccounts')}
        actions={
          <>
            <Button variant="outline" onClick={() => void openEditDialog()} loading={opening}>
              <Pencil aria-hidden />
              Modifier
            </Button>
            {!account.isPCG ? (
              <Button variant="ghost" className="hover:text-destructive" onClick={() => setDeleteDialogOpen(true)}>
                <Trash2 aria-hidden />
                Supprimer
              </Button>
            ) : null}
          </>
        }
      >
        {!account.isPCG ? (
          <StatusBadge tone="info" title="Compte ajouté au plan de comptes, absent du PCG">
            Personnalisé
          </StatusBadge>
        ) : null}
      </PageHeader>

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <Field label="Exercice" htmlFor="account-fiscal-year" className="w-full sm:w-64">
          <Select value={selectedFiscalYearId ?? ALL} onValueChange={setSelectedFiscalYearId}>
            <SelectTrigger id="account-fiscal-year" className="w-full">
              <SelectValue placeholder="Tous les exercices" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tous les exercices</SelectItem>
              {fiscalYears.map((fy) => (
                <SelectItem key={fy.id} value={fy.id}>
                  {fy.year} {fy.isClosed ? '(clôturé)' : '(ouvert)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <p className="text-muted-foreground text-sm">
          {selectedFiscalYear ? (
            <>
              Du <DateDisplay value={selectedFiscalYear.startDate} /> au <DateDisplay value={selectedFiscalYear.endDate} /> :{' '}
            </>
          ) : null}
          <span className="num">{plural(linkedEntriesCount, 'écriture')}</span>,{' '}
          <span className="num">{plural(entryLines.length, 'ligne')}</span>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3" aria-busy={loading || undefined}>
        <StatCard label="Total débit" value={<Amount value={totals.debit} />} />
        <StatCard label="Total crédit" value={<Amount value={totals.credit} />} />
        <StatCard label="Solde" value={<Amount value={Math.abs(totals.balance)} />} hint={BALANCE_SIDE_LABELS[side]} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Écritures</CardTitle>
          <CardDescription>
            Le solde est le cumul débit moins crédit&nbsp;: positif, il est débiteur&nbsp;; négatif, il est créditeur.
          </CardDescription>
        </CardHeader>
        <CardContent aria-busy={loading || undefined}>
          {loadError ? (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>
                <p>{loadError}</p>
                <Button size="sm" variant="outline" onClick={() => void loadAccountEntries()}>
                  Réessayer
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          <div className={LEDGER.container}>
          <Table stickyHeader containerClassName={cn('max-h-[70vh]', LEDGER.scroll)} className={LEDGER.table}>
            <TableHeader className={LEDGER.header}>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Journal</TableHead>
                <TableHead>N° de pièce</TableHead>
                <TableHead>Libellé</TableHead>
                <TableHead numeric>Débit</TableHead>
                <TableHead numeric>Crédit</TableHead>
                <TableHead numeric>Solde</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableSkeleton columns={8} rows={6} />
              ) : entryLines.length === 0 ? (
                <TableEmpty colSpan={8}>
                  Aucune écriture sur ce compte pour cette période. Choisissez un autre exercice, ou saisissez une écriture qui
                  l&apos;utilise.
                </TableEmpty>
              ) : (
                entryLines.map((line, index) => {
                  const label = line.description || line.accountingEntry.description
                  return (
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
                      <TableCell className={cn('max-w-80 truncate', LEDGER.label)} title={label ?? undefined}>
                        {label || <span className="text-muted-foreground">Sans libellé</span>}
                      </TableCell>
                      <TableCell numeric data-label="Débit" className={LEDGER.amount}>
                        {toCents(line.debit) ? <Amount value={line.debit} /> : null}
                      </TableCell>
                      <TableCell numeric data-label="Crédit" className={LEDGER.amount}>
                        {toCents(line.credit) ? <Amount value={line.credit} /> : null}
                      </TableCell>
                      <TableCell numeric data-label="Solde" className={LEDGER.balance}>
                        <Amount value={balances[index]} />
                      </TableCell>
                      <TableCell className={LEDGER.action}>
                        <Button variant="ghost" size="icon-sm" asChild>
                          <Link
                            href={`/${companyId}/entries/${line.accountingEntry.id}`}
                            aria-label={`Voir l'écriture ${line.accountingEntry.entryNumber}`}
                            title="Voir l'écriture"
                          >
                            <Eye aria-hidden />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
            {!loading && entryLines.length > 0 ? (
              <TableFooter>
                <TableRow className={LEDGER.row}>
                  <TableCell colSpan={4} className={cn('font-medium', LEDGER.totalLabel)}>
                    Total
                  </TableCell>
                  <TableCell numeric data-label="Débit" className={cn('font-medium', LEDGER.amount)}>
                    <Amount value={totals.debit} />
                  </TableCell>
                  <TableCell numeric data-label="Crédit" className={cn('font-medium', LEDGER.amount)}>
                    <Amount value={totals.credit} />
                  </TableCell>
                  <TableCell numeric data-label="Solde" className={cn('font-medium', LEDGER.balance)}>
                    <Amount value={totals.balance} />
                  </TableCell>
                  <TableCell className={LEDGER.hidden} />
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={`Supprimer le compte ${account.code} ?`}
        description={
          <>
            Le compte {account.code} {account.label} et ses sous-comptes sont retirés du plan de comptes. Un compte qui
            contient des écritures ne peut pas être supprimé.
          </>
        }
        confirmLabel="Supprimer"
        loadingLabel="Suppression..."
        loading={deleting}
        onConfirm={deleteAccount}
      />

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier le compte {account.code}</DialogTitle>
            <DialogDescription>Numéro, libellé et compte parent dans le plan de comptes de l&apos;exercice.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {editError && (
              <Alert variant="destructive">
                <AlertDescription>{editError}</AlertDescription>
              </Alert>
            )}
            <Field label="Exercice" required htmlFor="edit-fiscal-year">
              <Select value={editFiscalYearId} onValueChange={(value) => void changeEditFiscalYear(value)}>
                <SelectTrigger id="edit-fiscal-year" className="w-full">
                  <SelectValue placeholder="Choisir un exercice" />
                </SelectTrigger>
                <SelectContent>
                  {fiscalYears.map((fy) => (
                    <SelectItem key={fy.id} value={fy.id}>
                      {fy.year} {fy.isClosed ? '(clôturé)' : '(ouvert)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Numéro" required hint="De 2 à 8 chiffres, comme dans le PCG.">
              <Input
                value={editCode}
                onChange={(e) => setEditCode(e.target.value)}
                placeholder="ex. 411"
                inputMode="numeric"
                maxLength={8}
                className="font-mono"
              />
            </Field>
            <Field label="Libellé" required>
              <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} placeholder="ex. Clients" />
            </Field>
            <Field label="Compte parent" required htmlFor="edit-parentId">
              <AccountCombobox
                id="edit-parentId"
                accounts={editDialogAccounts ?? allAccounts}
                value={editParentId || ''}
                onValueChange={(value) => setEditParentId(value)}
                placeholder="Rechercher un compte (ex. 41)"
                excludeAccountIds={[editingAccountId]}
                showNoneOption={false}
                className="w-full"
              />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)} disabled={editing}>
              Annuler
            </Button>
            <Button onClick={() => void saveAccount()} loading={editing}>
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
