'use client'

import { useCallback, useId, useMemo, useState } from 'react'
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type RowSelectionState,
} from '@tanstack/react-table'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, Copy, Eye, MoreHorizontal, Pencil, Trash2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'

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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Amount, ConfirmDeleteDialog, DateDisplay, EmptyState, LoadMore, StatusBadge, formatDisplayDate } from '@/components/shared'
import { OnboardingEmptyState } from '@/components/features/onboarding/onboarding-empty-state'
import { docsUrl } from '@/lib/docs-links'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import { parseCents, sumCents } from '@/lib/utils/money'

/**
 * Narrow containers (phones, tablets with the sidebar open): each row becomes
 * a stacked card on the same markup, so the data, the selection and the
 * actions stay the same. The date, journal and number on the first line with
 * the actions, the description on the second, the status and the amount on
 * the third, the actions in the top corner. Entries are balanced, so the debit total is the amount and the
 * credit column is left out.
 */
const STACK = {
  table: '@max-[56rem]/entries:block @max-[56rem]/entries:*:block',
  headRow: '@max-[56rem]/entries:flex @max-[56rem]/entries:items-center',
  bodyRow:
    '@max-[56rem]/entries:relative @max-[56rem]/entries:flex @max-[56rem]/entries:flex-wrap @max-[56rem]/entries:items-center @max-[56rem]/entries:gap-x-2 @max-[56rem]/entries:gap-y-1 @max-[56rem]/entries:py-2.5 @max-[56rem]/entries:pr-12 @max-[56rem]/entries:pl-11',
  cell: '@max-[56rem]/entries:p-0',
  footRow: '@max-[56rem]/entries:flex @max-[56rem]/entries:items-center @max-[56rem]/entries:justify-between @max-[56rem]/entries:px-3 @max-[56rem]/entries:py-2.5',
  hidden: '@max-[56rem]/entries:hidden',
} as const

interface ColumnLayout {
  numeric?: boolean
  /** Extra classes of the header cell. */
  head?: string
  /** Extra classes of the body cells. */
  cell?: string
}

const layoutOf = (meta: unknown) => (meta ?? {}) as ColumnLayout

/** Exact total of a side, in cents. */
function totalCents(lines: Array<{ debit: unknown; credit: unknown }>, side: 'debit' | 'credit'): number {
  return Number(sumCents(lines.map((line) => parseCents(String(line[side] ?? 0)) ?? 0)))
}

interface EntryLine {
  id: string
  debit: number | string
  credit: number | string
  description?: string | null
  account: {
    code: string
    label: string
  }
}

export interface EntryListItem {
  id: string
  entryNumber: string
  date: Date | string
  description?: string | null
  reference?: string | null
  status: string
  journal: {
    code: string
    label: string
  }
  lines: EntryLine[]
}

interface EntriesListProps {
  entries: EntryListItem[]
  /** First page loading. */
  loading?: boolean
  /** The first page failed: message and retry. */
  error?: string | null
  onRetry?: () => void
  /** Cursor paging: more entries on the server. */
  hasMore?: boolean
  loadingMore?: boolean
  loadMoreError?: string | null
  onLoadMore?: () => void
  /** Filters are active: an empty list means "nothing matches", not "no entry yet". */
  filtered?: boolean
  onEntryUpdated?: () => void
  onEntryDeleted?: () => void
  companyId?: string
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`

export function EntriesList({
  entries,
  loading = false,
  error = null,
  onRetry,
  hasMore = false,
  loadingMore = false,
  loadMoreError = null,
  onLoadMore,
  filtered = false,
  onEntryUpdated,
  onEntryDeleted,
  companyId,
}: EntriesListProps) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deletingEntry, setDeletingEntry] = useState<EntryListItem | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [bulkAction, setBulkAction] = useState<'validate' | 'delete' | null>(null)
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false)
  const selectAllId = useId()

  const refresh = useCallback(
    (deleted = false) => {
      const callback = deleted ? (onEntryDeleted ?? onEntryUpdated) : onEntryUpdated
      if (callback) callback()
      else router.refresh()
    },
    [onEntryDeleted, onEntryUpdated, router],
  )

  const handleValidate = useCallback(
    async (entryId: string) => {
      setBusyId(entryId)
      try {
        const response = await fetch(`/api/entries/${entryId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'validated' }),
        })
        const data = await response.json().catch(() => ({}))
        if (response.ok) {
          toast.success(`Écriture validée sous le n° ${data.entryNumber}`)
          refresh()
        } else {
          toast.error(data.error || "La validation a échoué. Réessayez dans un instant.")
        }
      } catch (error) {
        logger.error('Error validating entry:', error)
        toast.error("Le serveur n'a pas répondu. Vérifiez votre connexion puis réessayez.")
      } finally {
        setBusyId(null)
      }
    },
    [refresh],
  )

  const handleDuplicate = useCallback(
    async (entryId: string) => {
      if (!companyId) return
      setBusyId(entryId)
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
        setBusyId(null)
      }
    },
    [companyId, router],
  )

  const handleDelete = async (entry: EntryListItem) => {
    setIsDeleting(true)
    try {
      const response = await fetch(`/api/entries/${entry.id}`, { method: 'DELETE' })
      if (response.ok) {
        toast.success('Brouillon supprimé')
        setDeletingEntry(null)
        refresh(true)
      } else {
        const data = await response.json().catch(() => ({}))
        toast.error(data.error || 'La suppression a échoué. Réessayez dans un instant.')
      }
    } catch (error) {
      logger.error('Error deleting entry:', error)
      toast.error("Le serveur n'a pas répondu. Vérifiez votre connexion puis réessayez.")
    } finally {
      setIsDeleting(false)
    }
  }

  const columns = useMemo<ColumnDef<EntryListItem>[]>(
    () => [
      {
        id: 'select',
        meta: {
          head: '@max-[56rem]/entries:flex @max-[56rem]/entries:h-11 @max-[56rem]/entries:items-center @max-[56rem]/entries:gap-3 @max-[56rem]/entries:pl-3.5',
          cell: '@max-[56rem]/entries:absolute @max-[56rem]/entries:top-4 @max-[56rem]/entries:left-3.5',
        } satisfies ColumnLayout,
        header: ({ table }) => (
          <>
            <Checkbox
              id={selectAllId}
              checked={table.getIsAllRowsSelected() || (table.getIsSomeRowsSelected() && 'indeterminate')}
              onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
              aria-label="Sélectionner toutes les écritures affichées"
            />
            {/* Stacked rows have no header line: the select-all box gets a visible label */}
            <label htmlFor={selectAllId} aria-hidden className="hidden text-xs @max-[56rem]/entries:inline">
              Tout sélectionner
            </label>
          </>
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label={`Sélectionner l'écriture du ${formatDisplayDate(row.original.date)}`}
          />
        ),
      },
      {
        id: 'date',
        header: 'Date',
        meta: { head: STACK.hidden, cell: '@max-[56rem]/entries:order-1 @max-[56rem]/entries:font-medium' } satisfies ColumnLayout,
        cell: ({ row }) => <DateDisplay value={row.original.date} />,
      },
      {
        id: 'journal',
        header: 'Journal',
        meta: { head: STACK.hidden, cell: '@max-[56rem]/entries:order-2' } satisfies ColumnLayout,
        cell: ({ row }) => (
          <span title={row.original.journal.label}>
            <span className="font-mono text-xs">{row.original.journal.code}</span>
            <span className="sr-only"> {row.original.journal.label}</span>
          </span>
        ),
      },
      {
        id: 'entryNumber',
        header: 'N°',
        meta: { head: STACK.hidden, cell: '@max-[56rem]/entries:order-3 @max-[56rem]/entries:text-muted-foreground' } satisfies ColumnLayout,
        // Numbers are assigned at validation: a draft has none yet
        cell: ({ row }) =>
          row.original.status === 'validated' ? (
            <span className="num">{row.original.entryNumber}</span>
          ) : (
            <span className="text-muted-foreground" title="Numéro attribué à la validation">
              À la validation
            </span>
          ),
      },
      {
        id: 'description',
        header: 'Description',
        meta: { head: STACK.hidden, cell: '@max-[56rem]/entries:order-5 @max-[56rem]/entries:w-full' } satisfies ColumnLayout,
        cell: ({ row }) => (
          <div className="max-w-80 truncate @max-[56rem]/entries:max-w-none" title={row.original.description ?? undefined}>
            {row.original.description || <span className="text-muted-foreground">Sans description</span>}
          </div>
        ),
      },
      {
        id: 'debit',
        header: 'Débit',
        meta: {
          numeric: true,
          head: STACK.hidden,
          cell: '@max-[56rem]/entries:order-7 @max-[56rem]/entries:ml-auto @max-[56rem]/entries:font-medium',
        } satisfies ColumnLayout,
        cell: ({ row }) => <Amount value={totalCents(row.original.lines, 'debit') / 100} />,
      },
      {
        id: 'credit',
        header: 'Crédit',
        meta: { numeric: true, head: STACK.hidden, cell: STACK.hidden } satisfies ColumnLayout,
        cell: ({ row }) => <Amount value={totalCents(row.original.lines, 'credit') / 100} />,
      },
      {
        id: 'status',
        header: 'Statut',
        meta: { head: STACK.hidden, cell: '@max-[56rem]/entries:order-6' } satisfies ColumnLayout,
        cell: ({ row }) =>
          row.original.status === 'validated' ? (
            <StatusBadge tone="success">Validée</StatusBadge>
          ) : (
            <StatusBadge tone="warning">Brouillon</StatusBadge>
          ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { head: STACK.hidden, cell: '@max-[56rem]/entries:absolute @max-[56rem]/entries:top-1 @max-[56rem]/entries:right-1' } satisfies ColumnLayout,
        cell: ({ row }) => {
          const entry = row.original
          const name = entry.status === 'validated' ? `l'écriture n° ${entry.entryNumber}` : `le brouillon du ${formatDisplayDate(entry.date)}`
          return (
            <div className="flex items-center justify-end gap-1">
              {companyId ? (
                <Button variant="ghost" size="icon-sm" className={STACK.hidden} asChild>
                  <Link href={`/${companyId}/entries/${entry.id}`} aria-label={`Consulter ${name}`} title="Consulter">
                    <Eye aria-hidden />
                  </Link>
                </Button>
              ) : null}
              {companyId && entry.status === 'draft' ? (
                <Button variant="ghost" size="icon-sm" className={STACK.hidden} asChild>
                  <Link href={`/${companyId}/entries/${entry.id}/edit`} aria-label={`Modifier ${name}`} title="Modifier">
                    <Pencil aria-hidden />
                  </Link>
                </Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`Autres actions sur ${name}`} disabled={busyId === entry.id}>
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {/* Also in the row on wide screens; the way in on stacked rows */}
                  {companyId ? (
                    <DropdownMenuItem asChild>
                      <Link href={`/${companyId}/entries/${entry.id}`}>
                        <Eye aria-hidden />
                        Consulter
                      </Link>
                    </DropdownMenuItem>
                  ) : null}
                  {companyId && entry.status === 'draft' ? (
                    <DropdownMenuItem asChild>
                      <Link href={`/${companyId}/entries/${entry.id}/edit`}>
                        <Pencil aria-hidden />
                        Modifier
                      </Link>
                    </DropdownMenuItem>
                  ) : null}
                  {companyId ? (
                    <DropdownMenuItem onClick={() => handleDuplicate(entry.id)}>
                      <Copy aria-hidden />
                      Dupliquer
                    </DropdownMenuItem>
                  ) : null}
                  {entry.status === 'draft' ? (
                    <>
                      <DropdownMenuItem onClick={() => handleValidate(entry.id)}>
                        <CheckCircle2 aria-hidden />
                        Valider
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => setDeletingEntry(entry)}>
                        <Trash2 aria-hidden />
                        Supprimer
                      </DropdownMenuItem>
                    </>
                  ) : companyId ? (
                    // A validated entry is definitive: it is corrected by a reversing entry
                    <DropdownMenuItem asChild>
                      <Link href={`/${companyId}/entries/${entry.id}?contrepasser=1`}>
                        <Undo2 aria-hidden />
                        Contre-passer
                      </Link>
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        },
      },
    ],
    [companyId, busyId, handleDuplicate, handleValidate, selectAllId],
  )

  const table = useReactTable({
    data: entries,
    columns,
    getRowId: (entry) => entry.id,
    getCoreRowModel: getCoreRowModel(),
    onRowSelectionChange: setRowSelection,
    state: { rowSelection },
  })

  const selected = table.getSelectedRowModel().rows.map((row) => row.original)
  const selectedDrafts = selected.filter((entry) => entry.status === 'draft')
  const selectedValidated = selected.filter((entry) => entry.status === 'validated')

  const totals = useMemo(() => {
    const lines = entries.flatMap((entry) => entry.lines)
    return { debit: totalCents(lines, 'debit'), credit: totalCents(lines, 'credit') }
  }, [entries])

  const runBulk = async (action: 'validate' | 'delete') => {
    if (selectedDrafts.length === 0) return
    setBulkAction(action)
    try {
      const response = await fetch(action === 'validate' ? '/api/entries/bulk-validate' : '/api/entries/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          entryIds: selectedDrafts.map((entry) => entry.id),
          ...(action === 'validate' && { status: 'validated' }),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(data.error || "L'opération a échoué. Réessayez dans un instant.")
        return
      }
      if (action === 'validate') {
        const n = Number(data.validated ?? 0)
        toast.success(`${plural(n, 'écriture')} validée${n > 1 ? 's' : ''}`)
      } else {
        const n = Number(data.deleted ?? 0)
        toast.success(`${plural(n, 'brouillon')} supprimé${n > 1 ? 's' : ''}`)
        if (data.failed > 0) toast.warning(`${plural(data.failed, 'brouillon')} non supprimé${data.failed > 1 ? 's' : ''}`)
      }
      setRowSelection({})
      setShowBulkDeleteDialog(false)
      refresh(action === 'delete')
    } catch (error) {
      logger.error(`Error in bulk ${action}:`, error)
      toast.error("Le serveur n'a pas répondu. Vérifiez votre connexion puis réessayez.")
    } finally {
      setBulkAction(null)
    }
  }

  if (!loading && !error && entries.length === 0) {
    if (!filtered && companyId) {
      return (
        <OnboardingEmptyState
          companyId={companyId}
          title="Aucune écriture pour l'instant"
          description="Les écritures viennent surtout de la banque&nbsp;: chaque opération rapprochée en crée une."
          steps={['bank', 'history', 'rule']}
          fallback={{ label: 'Nouvelle écriture', href: `/${companyId}/entries/new` }}
          docsHref={docsUrl('doubleEntry')}
          docsLabel="La partie double"
        />
      )
    }
    return (
      <Card>
        <CardContent>
          <EmptyState title="Aucune écriture ne correspond aux filtres" description="Élargissez la période ou retirez un filtre." />
        </CardContent>
      </Card>
    )
  }

  const busy = bulkAction !== null
  const visibleColumns = table.getVisibleLeafColumns()

  return (
    <Card className="gap-4">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Écritures</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {selected.length > 0 ? (
            <span className="text-muted-foreground text-sm" aria-live="polite">
              {selected.length} sélectionnée{selected.length > 1 ? 's' : ''}
              {selectedValidated.length > 0 ? `, dont ${selectedValidated.length} validée${selectedValidated.length > 1 ? 's' : ''}` : ''}
            </span>
          ) : null}
          {selectedDrafts.length > 0 ? (
            <>
              <Button size="sm" variant="outline" disabled={busy} loading={bulkAction === 'validate'} onClick={() => runBulk('validate')}>
                <CheckCircle2 aria-hidden />
                Valider ({selectedDrafts.length})
              </Button>
              <Button size="sm" variant="ghost" className="hover:text-destructive" disabled={busy} onClick={() => setShowBulkDeleteDialog(true)}>
                <Trash2 aria-hidden />
                Supprimer ({selectedDrafts.length})
              </Button>
            </>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <EmptyState
            bordered
            icon={AlertCircle}
            title="Impossible de charger les écritures"
            description={error}
            action={
              onRetry ? (
                <Button size="sm" variant="outline" onClick={onRetry}>
                  Réessayer
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="@container/entries rounded-lg border" aria-busy={loading || undefined}>
            <Table className={STACK.table}>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className={STACK.headRow}>
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        numeric={layoutOf(header.column.columnDef.meta).numeric}
                        className={layoutOf(header.column.columnDef.meta).head}
                      >
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeleton columns={visibleColumns.length} rows={8} />
                ) : entries.length === 0 ? (
                  <TableEmpty colSpan={visibleColumns.length}>Aucune écriture.</TableEmpty>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id} data-state={row.getIsSelected() ? 'selected' : undefined} className={STACK.bodyRow}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          numeric={layoutOf(cell.column.columnDef.meta).numeric}
                          className={cn(STACK.cell, layoutOf(cell.column.columnDef.meta).cell)}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
              {!loading && entries.length > 0 ? (
                <TableFooter>
                  <TableRow className={STACK.footRow}>
                    <TableCell colSpan={5} className={cn(STACK.cell, 'font-medium')}>
                      Total
                    </TableCell>
                    <TableCell numeric className={cn(STACK.cell, 'font-medium')}>
                      <Amount value={totals.debit / 100} />
                    </TableCell>
                    <TableCell numeric className={cn(STACK.hidden, 'font-medium')}>
                      <Amount value={totals.credit / 100} />
                    </TableCell>
                    <TableCell colSpan={2} className={STACK.hidden} />
                  </TableRow>
                </TableFooter>
              ) : null}
            </Table>
          </div>
        )}

        {!loading && !error && onLoadMore ? (
          <LoadMore
            hasMore={hasMore}
            loading={loadingMore}
            error={loadMoreError}
            onLoadMore={onLoadMore}
            summary={`${plural(entries.length, 'écriture')} affichée${entries.length > 1 ? 's' : ''}${hasMore ? ', la suite se charge en descendant' : ''}. Le total porte sur les écritures affichées.`}
          />
        ) : null}
      </CardContent>

      <ConfirmDeleteDialog
        open={deletingEntry !== null}
        onOpenChange={(open) => !open && setDeletingEntry(null)}
        title={deletingEntry ? `Supprimer le brouillon ${deletingEntry.journal.code} du ${formatDisplayDate(deletingEntry.date)} ?` : 'Supprimer le brouillon ?'}
        description="Le brouillon et ses lignes sont supprimés, sans retour en arrière."
        loading={isDeleting}
        onConfirm={() => deletingEntry && handleDelete(deletingEntry)}
      />

      <ConfirmDeleteDialog
        open={showBulkDeleteDialog}
        onOpenChange={setShowBulkDeleteDialog}
        title={`Supprimer ${plural(selectedDrafts.length, 'brouillon')} ?`}
        description={`Les brouillons et leurs lignes sont supprimés, sans retour en arrière.${
          selectedValidated.length > 0 ? ' Les écritures validées sélectionnées restent\u00a0: elles se corrigent par contre-passation.' : ''
        }`}
        loading={bulkAction === 'delete'}
        onConfirm={() => runBulk('delete')}
      >
        <ul className="text-muted-foreground mt-3 max-h-48 space-y-1 overflow-y-auto text-sm">
          {selectedDrafts.slice(0, 10).map((entry) => (
            <li key={entry.id}>
              {entry.journal.code} du {formatDisplayDate(entry.date)}
              {entry.description ? `, ${entry.description}` : ''}
            </li>
          ))}
          {selectedDrafts.length > 10 ? <li>et {selectedDrafts.length - 10} autre{selectedDrafts.length - 10 > 1 ? 's' : ''}</li> : null}
        </ul>
      </ConfirmDeleteDialog>
    </Card>
  )
}
