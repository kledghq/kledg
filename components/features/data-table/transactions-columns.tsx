/**
 * Columns of the bank transactions table. The list comes from the server in
 * its order (date, then id) page by page, so columns do not sort: sorting the
 * loaded rows only would hide the rows of the next pages.
 */

import { type ColumnDef } from "@tanstack/react-table"
import { FileText, MoreHorizontal, Paperclip } from "lucide-react"

import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Amount, DateDisplay, StatusBadge } from "@/components/shared"
import { operationTypeLabel } from "@/lib/banking/operation-type-label"
import { bankAccountName } from "@/components/features/banking/format"
import type { BankTransaction } from "./transactions-types"

/** Column metadata: the French name shown in the "Colonnes" menu and the numeric alignment. */
export interface TransactionColumnMeta {
  label?: string
  numeric?: boolean
}

export interface TransactionColumnHandlers {
  /** Balance after each transaction, in cents (running balance column). */
  balanceAfter?: (transaction: BankTransaction) => number | undefined
  showCompanyColumn?: boolean
  onViewAttachment: (transaction: BankTransaction) => void
  canViewAttachment: (transaction: BankTransaction) => boolean
  onViewEntry: (entryId: string) => void
  onViewDetails: (transaction: BankTransaction) => void
  onReconcile: (transaction: BankTransaction) => void
  onUnreconcile: (transaction: BankTransaction) => void
  onCopyId: (transaction: BankTransaction) => void
  /** Id of the transaction whose reconciliation is changing. */
  busyId: string | null
}

/** Signed amount of a transaction in euros: debits are outflows. */
export function signedAmount(transaction: BankTransaction): number {
  const amount = Math.abs(Number(transaction.amount))
  return transaction.side === "debit" ? -amount : amount
}

const counterpartyOf = (t: BankTransaction) => t.counterpartyName || t.label || ""

export function transactionColumns(handlers: TransactionColumnHandlers): ColumnDef<BankTransaction>[] {
  const columns: ColumnDef<BankTransaction>[] = [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllRowsSelected() || (table.getIsSomeRowsSelected() && "indeterminate")}
          onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
          aria-label="Sélectionner toutes les transactions affichées"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label={`Sélectionner la transaction ${counterpartyOf(row.original)}`.trim()}
        />
      ),
      enableHiding: false,
      size: 40,
    },
    {
      accessorKey: "date",
      header: "Date",
      meta: { label: "Date" },
      cell: ({ row }) => <DateDisplay value={row.original.date} />,
      size: 104,
    },
    {
      id: "counterpartyName",
      accessorFn: counterpartyOf,
      header: "Contrepartie",
      meta: { label: "Contrepartie" },
      cell: ({ row }) => {
        const transaction = row.original
        return (
          <div className="flex min-w-0 items-center gap-2">
            {transaction.logoUrl ? (
              // Provider logos are small remote images: no Next image optimisation
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={transaction.logoUrl}
                alt=""
                className="size-6 shrink-0 rounded object-contain"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = "none"
                }}
              />
            ) : null}
            <span className="truncate font-medium" title={counterpartyOf(transaction)}>
              {counterpartyOf(transaction) || <span className="text-muted-foreground">Non renseignée</span>}
            </span>
          </div>
        )
      },
      size: 200,
    },
    {
      accessorKey: "label",
      header: "Libellé",
      meta: { label: "Libellé" },
      cell: ({ row }) => (
        <div className="truncate" title={row.original.label ?? undefined}>
          {row.original.label || <span className="text-muted-foreground">Non renseigné</span>}
        </div>
      ),
      size: 220,
    },
    {
      id: "category",
      accessorFn: (t) => t.cashflowCategory ?? t.operationType ?? "",
      header: "Catégorie",
      meta: { label: "Catégorie" },
      cell: ({ row }) => {
        const t = row.original
        const main = t.cashflowCategory || operationTypeLabel(t.operationType)
        if (!main) return <span className="text-muted-foreground">Aucune</span>
        return (
          <div className="flex min-w-0 flex-col items-start gap-1">
            <Badge variant="outline" className="max-w-full truncate">
              {main}
            </Badge>
            {t.cashflowSubcategory ? (
              <span className="text-muted-foreground max-w-full truncate text-xs">{t.cashflowSubcategory}</span>
            ) : null}
          </div>
        )
      },
      size: 150,
    },
    {
      accessorKey: "amount",
      header: "Montant",
      meta: { label: "Montant", numeric: true },
      cell: ({ row }) => <Amount value={signedAmount(row.original)} sign="always" />,
      size: 128,
    },
  ]

  if (handlers.balanceAfter) {
    const balanceAfter = handlers.balanceAfter
    columns.push({
      id: "balance",
      header: "Solde",
      meta: { label: "Solde", numeric: true },
      cell: ({ row }) => {
        const cents = balanceAfter(row.original)
        return cents === undefined ? (
          <span className="text-muted-foreground">Non calculé</span>
        ) : (
          <Amount value={cents / 100} />
        )
      },
      size: 136,
    })
  }

  if (handlers.showCompanyColumn) {
    columns.splice(2, 0, {
      accessorKey: "companyName",
      header: "Société",
      meta: { label: "Société" },
      cell: ({ row }) => <div className="truncate font-medium">{row.original.companyName}</div>,
      size: 160,
    })
  }

  columns.push(
    {
      id: "attachments",
      header: "Pièces",
      meta: { label: "Pièces justificatives" },
      cell: ({ row }) => {
        const t = row.original
        const count = t.attachmentsCount ?? 0
        if (count === 0) return <span className="text-muted-foreground">Aucune</span>
        const label = `${count} pièce${count > 1 ? "s" : ""}`
        return handlers.canViewAttachment(t) ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => handlers.onViewAttachment(t)}
            aria-label={`Voir le justificatif (${label})`}
            title="Voir le justificatif"
          >
            <Paperclip aria-hidden />
            <span className="num">{count}</span>
          </Button>
        ) : (
          <span className="text-muted-foreground inline-flex items-center gap-1" title={label}>
            <Paperclip aria-hidden className="size-3.5" />
            <span className="num">{count}</span>
          </span>
        )
      },
      size: 84,
    },
    {
      id: "entry",
      header: "Écriture",
      meta: { label: "Écriture rapprochée" },
      cell: ({ row }) => {
        const entryId = row.original.reconciledWith
        if (!entryId) return <span className="text-muted-foreground">Aucune</span>
        return (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => handlers.onViewEntry(entryId)}
            aria-label="Voir l'écriture rapprochée"
            title="Voir l'écriture rapprochée"
          >
            <FileText aria-hidden />
          </Button>
        )
      },
      size: 84,
    },
    {
      id: "bankAccount",
      accessorFn: (t) => bankAccountName(t.bankAccount),
      header: "Compte",
      meta: { label: "Compte bancaire" },
      cell: ({ row }) => {
        const name = bankAccountName(row.original.bankAccount)
        return (
          <div className="truncate" title={name}>
            {name}
          </div>
        )
      },
      size: 150,
    },
    {
      accessorKey: "reconciled",
      header: "Statut",
      meta: { label: "Statut" },
      cell: ({ row }) =>
        row.original.reconciled ? (
          <StatusBadge tone="success">Rapprochée</StatusBadge>
        ) : (
          <StatusBadge tone="warning">Non rapprochée</StatusBadge>
        ),
      size: 136,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      enableHiding: false,
      cell: ({ row }) => {
        const t = row.original
        const busy = handlers.busyId === t.id
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions sur la transaction ${counterpartyOf(t)}`.trim()}>
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handlers.onViewDetails(t)}>Voir les détails</DropdownMenuItem>
              {t.reconciled ? (
                <DropdownMenuItem onClick={() => handlers.onUnreconcile(t)} disabled={busy}>
                  Annuler le rapprochement
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => handlers.onReconcile(t)} disabled={busy}>
                  Rapprocher
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handlers.onCopyId(t)}>Copier l&apos;identifiant</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
      size: 48,
    },
  )
  return columns
}
