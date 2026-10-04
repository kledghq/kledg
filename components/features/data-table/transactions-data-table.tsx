"use client"

import * as React from "react"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type RowSelectionState,
  type VisibilityState,
} from "@tanstack/react-table"
import { AlertCircle, CheckCircle2, Trash2, XCircle } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
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
} from "@/components/ui/table"
import { Amount, ConfirmDeleteDialog, EmptyState, LoadMore, formatAmount, formatDisplayDate } from "@/components/shared"
import { JustificatifPreviewDialog } from "@/components/features/justificatifs/justificatif-preview-dialog"
import { EntryPreviewDialog } from "@/components/features/accounting/entry-preview-dialog"
import { toCents } from "@/lib/utils/money"
import { cn } from "@/lib/utils"
import { useCompactLayout } from "@/hooks/ui/use-media-query"
import { DataTableViewOptions } from "./data-table-view-options"
import { signedAmount, transactionColumns, type TransactionColumnMeta } from "./transactions-columns"
import { handleCopyTransactionId, handleReconcileTransaction, handleUnreconcileTransaction } from "./transactions-actions"
import { TransactionDetailsDialog } from "./transaction-details-dialog"
import type { BankTransaction } from "./transactions-types"

export type { BankTransaction }

interface TransactionsDataTableProps {
  data: BankTransaction[]
  /** First page loading. */
  loading?: boolean
  /** The first page failed: message and retry. */
  error?: string | null
  onRetry?: () => void
  /** Cursor paging: more rows on the server. */
  hasMore?: boolean
  loadingMore?: boolean
  loadMoreError?: string | null
  onLoadMore?: () => void
  companyId?: string
  /** Reloads the list after a change made from the table. */
  onRefresh?: () => void
  /** When true, shows a "Société" column (group view). */
  showCompanyColumn?: boolean
  /** Balance before the first listed transaction (euros), start of the running balance. */
  balanceBefore?: number
  /** Shown when the list is empty (no transaction or none matching the filters). */
  empty?: React.ReactNode
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`

/** Signed cents of a transaction: credits add to the balance, debits subtract. */
const signedCents = (t: BankTransaction) => toCents(signedAmount(t)) ?? 0

export function TransactionsDataTable({
  data,
  loading = false,
  error = null,
  onRetry,
  hasMore = false,
  loadingMore = false,
  loadMoreError = null,
  onLoadMore,
  companyId,
  onRefresh,
  showCompanyColumn = false,
  balanceBefore,
  empty,
}: TransactionsDataTableProps) {
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})
  const [detailsTransaction, setDetailsTransaction] = React.useState<BankTransaction | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [bulkAction, setBulkAction] = React.useState<"reconcile" | "unreconcile" | "delete" | null>(null)
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = React.useState(false)
  const [justificatifPreview, setJustificatifPreview] = React.useState<{
    attachmentId: string
    transactionUuid: string
    companyId: string
    fileName: string
    fileContentType?: string | null
  } | null>(null)
  const [entryPreviewEntryId, setEntryPreviewEntryId] = React.useState<string | null>(null)
  // Phones and small tablets: one stacked block per transaction instead of a wide table.
  const compact = useCompactLayout()

  // Running balance in cents, in the order of the list (date, then id): the
  // pages are contiguous, so it stays right as more pages are appended.
  const balanceAfter = React.useMemo(() => {
    let running = toCents(balanceBefore ?? 0) ?? 0
    const map = new Map<string, number>()
    for (const t of data) {
      running += signedCents(t)
      map.set(t.id, running)
    }
    return map
  }, [data, balanceBefore])

  const companyOf = React.useCallback((t: BankTransaction) => companyId ?? t.companyId, [companyId])

  const columns = React.useMemo(
    () =>
      transactionColumns({
        balanceAfter: (t) => balanceAfter.get(t.id),
        showCompanyColumn,
        busyId,
        canViewAttachment: (t) => Boolean(t.attachment?.id && t.transactionUuid && companyOf(t)),
        onViewAttachment: (t) => {
          const cid = companyOf(t)
          if (!t.attachment?.id || !t.transactionUuid || !cid) return
          setJustificatifPreview({
            attachmentId: t.attachment.id,
            transactionUuid: t.transactionUuid,
            companyId: cid,
            fileName: t.attachment.fileName,
            fileContentType: t.attachment.fileContentType,
          })
        },
        onViewEntry: setEntryPreviewEntryId,
        onViewDetails: setDetailsTransaction,
        onCopyId: (t) => void handleCopyTransactionId(t.id),
        onReconcile: async (t) => {
          const cid = companyOf(t)
          if (!cid) return
          setBusyId(t.id)
          try {
            await handleReconcileTransaction(t, cid, onRefresh)
          } finally {
            setBusyId(null)
          }
        },
        onUnreconcile: async (t) => {
          const cid = companyOf(t)
          if (!cid) return
          setBusyId(t.id)
          try {
            await handleUnreconcileTransaction(t, cid, onRefresh)
          } finally {
            setBusyId(null)
          }
        },
      }),
    [balanceAfter, showCompanyColumn, busyId, companyOf, onRefresh],
  )

  const table = useReactTable({
    data,
    columns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    state: { columnVisibility, rowSelection },
    enableColumnResizing: false,
  })

  const selected = table.getSelectedRowModel().rows.map((row) => row.original)
  const selectedUnreconciled = selected.filter((t) => !t.reconciled)
  const selectedReconciled = selected.filter((t) => t.reconciled)
  const visibleColumns = table.getVisibleLeafColumns()

  const runBulk = async (
    action: "reconcile" | "unreconcile" | "delete",
    transactions: BankTransaction[],
  ) => {
    const endpoint = {
      reconcile: "/api/transactions/bulk-reconcile",
      unreconcile: "/api/transactions/bulk-unreconcile",
      delete: "/api/transactions/bulk-delete",
    }[action]
    setBulkAction(action)
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionIds: transactions.map((t) => t.id) }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(result.error || "L'opération a échoué. Réessayez dans un instant.")
        return
      }
      const done = Number(result.reconciled ?? result.unreconciled ?? result.deleted ?? 0)
      const verb = { reconcile: "rapprochée", unreconcile: "dont le rapprochement est annulé", delete: "supprimée" }[action]
      toast.success(
        action === "unreconcile"
          ? `Rapprochement annulé pour ${plural(done, "transaction")}`
          : `${plural(done, "transaction")} ${verb}${done > 1 ? "s" : ""}`,
      )
      if (result.failed > 0) toast.warning(`${plural(result.failed, "transaction")} non traitée${result.failed > 1 ? "s" : ""}`)
      setRowSelection({})
      setShowBulkDeleteDialog(false)
      onRefresh?.()
    } catch {
      toast.error("Le serveur n'a pas répondu. Vérifiez votre connexion puis réessayez.")
    } finally {
      setBulkAction(null)
    }
  }

  const totalCents = data.reduce((sum, t) => sum + signedCents(t), 0)
  const busy = bulkAction !== null

  const selectionSummary =
    selected.length > 0
      ? `${plural(selected.length, "transaction")} sélectionnée${selected.length > 1 ? "s" : ""}`
      : "Cochez des transactions pour les rapprocher ou les supprimer en une fois."

  const bulkActions = (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || selectedUnreconciled.length === 0}
                loading={bulkAction === "reconcile"}
                onClick={() => runBulk("reconcile", selectedUnreconciled)}
              >
                <CheckCircle2 aria-hidden />
                Rapprocher ({selectedUnreconciled.length})
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || selectedReconciled.length === 0}
                loading={bulkAction === "unreconcile"}
                onClick={() => runBulk("unreconcile", selectedReconciled)}
              >
                <XCircle aria-hidden />
                Annuler le rapprochement ({selectedReconciled.length})
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="hover:text-destructive"
                disabled={busy}
                onClick={() => setShowBulkDeleteDialog(true)}
              >
                <Trash2 aria-hidden />
                Supprimer ({selected.length})
              </Button>
            </>
  )

  const rows = table.getRowModel().rows
  const cellOf = (row: (typeof rows)[number], columnId: string) => {
    const cell = row.getVisibleCells().find((c) => c.column.id === columnId)
    return cell ? flexRender(cell.column.columnDef.cell, cell.getContext()) : null
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {selectionSummary}
        </p>
        {compact ? null : (
          <div className="flex flex-wrap items-center gap-2">
            {selected.length > 0 ? bulkActions : null}
            <DataTableViewOptions table={table} />
          </div>
        )}
      </div>

      {error ? (
        <EmptyState
          bordered
          icon={AlertCircle}
          title="Impossible de charger les transactions"
          description={error}
          action={
            onRetry ? (
              <Button size="sm" variant="outline" onClick={onRetry}>
                Réessayer
              </Button>
            ) : null
          }
        />
      ) : compact ? (
        <div className="rounded-lg border" aria-busy={loading || undefined}>
          {loading ? (
            <ul className="divide-y" aria-hidden>
              {Array.from({ length: 6 }, (_, i) => (
                <li key={i} className="flex gap-3 p-3">
                  <Skeleton className="size-4" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                  <Skeleton className="h-4 w-20" />
                </li>
              ))}
            </ul>
          ) : data.length === 0 ? (
            <p className="text-muted-foreground px-3 py-10 text-center text-sm">{empty ?? "Aucune transaction."}</p>
          ) : (
            <>
              <div className="bg-muted/40 flex items-center gap-3 border-b px-3 py-2">
                <Checkbox
                  id="transactions-select-all"
                  checked={table.getIsAllRowsSelected() || (table.getIsSomeRowsSelected() && "indeterminate")}
                  onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
                  aria-label="Sélectionner toutes les transactions affichées"
                />
                <label htmlFor="transactions-select-all" className="text-muted-foreground flex-1 text-xs">
                  Tout sélectionner
                </label>
                <span className="text-muted-foreground text-xs">Total</span>
                <Amount value={totalCents / 100} sign="always" className="text-sm font-semibold" />
              </div>
              <ul className="divide-y" aria-label="Transactions">
                {rows.map((row) => {
                  const t = row.original
                  const balance = balanceAfter.get(t.id)
                  return (
                    <li
                      key={row.id}
                      data-state={row.getIsSelected() ? "selected" : undefined}
                      className="data-[state=selected]:bg-muted flex gap-3 px-3 py-3"
                    >
                      <div className="pt-0.5">{cellOf(row, "select")}</div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">{cellOf(row, "counterpartyName")}</div>
                          <div className="num shrink-0 text-right font-medium">
                            <Amount value={signedAmount(t)} sign="always" />
                          </div>
                        </div>
                        <div className="text-muted-foreground flex items-start justify-between gap-3 text-xs">
                          <div className="min-w-0">
                            <span className="num">{formatDisplayDate(t.date)}</span>
                            {t.label && t.label !== t.counterpartyName ? (
                              <span className="block truncate" title={t.label}>
                                {t.label}
                              </span>
                            ) : null}
                          </div>
                          {balance !== undefined ? (
                            <span className="shrink-0 text-right">
                              Solde <Amount value={balance / 100} />
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          {cellOf(row, "reconciled")}
                          <div className="-my-1 flex items-center gap-1">
                            {t.attachmentsCount ? cellOf(row, "attachments") : null}
                            {t.reconciledWith ? cellOf(row, "entry") : null}
                            {cellOf(row, "actions")}
                          </div>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      ) : (
        <div className="rounded-lg border" aria-busy={loading || undefined}>
          <Table className="table-fixed" style={{ minWidth: table.getTotalSize() }}>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      numeric={(header.column.columnDef.meta as TransactionColumnMeta | undefined)?.numeric}
                      style={{ width: header.getSize() }}
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
              ) : data.length === 0 ? (
                <TableEmpty colSpan={visibleColumns.length}>{empty ?? "Aucune transaction."}</TableEmpty>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} data-state={row.getIsSelected() ? "selected" : undefined}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        numeric={(cell.column.columnDef.meta as TransactionColumnMeta | undefined)?.numeric}
                        className="overflow-hidden"
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
            {!loading && data.length > 0 ? (
              <TableFooter>
                <TableRow>
                  {visibleColumns.map((column, index) => {
                    if (column.id === "amount") {
                      return (
                        <TableCell key={column.id} numeric className="font-semibold">
                          <Amount value={totalCents / 100} sign="always" />
                        </TableCell>
                      )
                    }
                    const firstTextColumn = visibleColumns.findIndex((c) => c.id !== "select")
                    return index === firstTextColumn ? (
                      <TableCell key={column.id} className="font-semibold">
                        Total
                      </TableCell>
                    ) : (
                      <TableCell key={column.id} />
                    )
                  })}
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
          summary={
            data.length > 0
              ? `${plural(data.length, "transaction")} affichée${data.length > 1 ? "s" : ""}${hasMore ? ", la suite se charge en descendant" : ""}. Le total porte sur les transactions affichées.`
              : null
          }
        />
      ) : null}

      {compact && selected.length > 0 ? (
        <div
          role="region"
          aria-label="Actions sur la sélection"
          className={cn(
            "bg-background sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-t px-4 pt-3 shadow-[0_-1px_3px_rgb(0_0_0/0.06)]",
            "pb-[calc(env(safe-area-inset-bottom)+0.75rem)]",
          )}
        >
          <span className="text-muted-foreground w-full text-xs">{selectionSummary}</span>
          {bulkActions}
        </div>
      ) : null}

      <TransactionDetailsDialog
        transaction={detailsTransaction}
        open={detailsTransaction !== null}
        onOpenChange={(open) => !open && setDetailsTransaction(null)}
      />
      {justificatifPreview && (
        <JustificatifPreviewDialog
          open={!!justificatifPreview}
          onOpenChange={(open) => !open && setJustificatifPreview(null)}
          attachmentId={justificatifPreview.attachmentId}
          transactionUuid={justificatifPreview.transactionUuid}
          companyId={justificatifPreview.companyId}
          fileName={justificatifPreview.fileName}
          fileContentType={justificatifPreview.fileContentType}
        />
      )}

      <EntryPreviewDialog
        open={entryPreviewEntryId !== null}
        onOpenChange={(open) => !open && setEntryPreviewEntryId(null)}
        entryId={entryPreviewEntryId}
      />

      <ConfirmDeleteDialog
        open={showBulkDeleteDialog}
        onOpenChange={setShowBulkDeleteDialog}
        title={`Supprimer ${plural(selected.length, "transaction")} ?`}
        description="Les transactions sélectionnées sont supprimées de Kledg, sans retour en arrière. Les écritures déjà passées restent en place."
        loading={bulkAction === "delete"}
        onConfirm={() => runBulk("delete", selected)}
      >
        <ul className="text-muted-foreground mt-3 max-h-48 space-y-1 overflow-y-auto text-sm">
          {selected.slice(0, 10).map((t) => (
            <li key={t.id}>
              {formatDisplayDate(t.date)}, {t.counterpartyName || t.label || "sans libellé"},{" "}
              <span className="num whitespace-nowrap">{formatAmount(signedAmount(t), { sign: "always" })}</span>
            </li>
          ))}
          {selected.length > 10 ? <li>et {selected.length - 10} autre{selected.length - 10 > 1 ? "s" : ""}</li> : null}
        </ul>
      </ConfirmDeleteDialog>
    </div>
  )
}
