/**
 * Details of a bank transaction, opened from the row menu of the table.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Amount, DateDisplay, StatusBadge } from "@/components/shared"
import { operationTypeLabel } from "@/lib/banking/operation-type-label"
import { bankAccountName } from "@/components/features/banking/format"
import { signedAmount } from "./transactions-columns"
import type { BankTransaction } from "./transactions-types"

interface TransactionDetailsDialogProps {
  transaction: BankTransaction | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function Detail({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-1 text-sm break-words">{children}</dd>
    </div>
  )
}

export function TransactionDetailsDialog({ transaction, open, onOpenChange }: TransactionDetailsDialogProps) {
  if (!transaction) return null
  const operation = operationTypeLabel(transaction.operationType)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Détails de la transaction</DialogTitle>
          <DialogDescription>Ce que la banque a transmis pour cette opération.</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Detail label="Date">
            <DateDisplay value={transaction.date} format="long" />
          </Detail>
          <Detail label="Montant">
            <Amount value={signedAmount(transaction)} sign="always" className="font-medium" />
          </Detail>
          <Detail label="Compte bancaire">{bankAccountName(transaction.bankAccount)}</Detail>
          <Detail label="Statut">
            {transaction.reconciled ? (
              <StatusBadge tone="success">Rapprochée</StatusBadge>
            ) : (
              <StatusBadge tone="warning">Non rapprochée</StatusBadge>
            )}
          </Detail>
          <Detail label="Contrepartie" wide>
            {transaction.counterpartyName || <span className="text-muted-foreground">Non renseignée</span>}
          </Detail>
          <Detail label="Libellé" wide>
            {transaction.label || <span className="text-muted-foreground">Non renseigné</span>}
          </Detail>
          {transaction.reference ? (
            <Detail label="Référence" wide>
              {transaction.reference}
            </Detail>
          ) : null}
          {transaction.cashflowCategory || operation ? (
            <Detail label="Catégorie" wide>
              <span className="flex flex-wrap gap-2">
                {transaction.cashflowCategory ? <Badge variant="outline">{transaction.cashflowCategory}</Badge> : null}
                {transaction.cashflowSubcategory ? <Badge variant="secondary">{transaction.cashflowSubcategory}</Badge> : null}
                {operation ? <Badge variant="outline">{operation}</Badge> : null}
              </span>
            </Detail>
          ) : null}
          <Detail label="Identifiant" wide>
            <span className="font-mono text-xs break-all">{transaction.id}</span>
          </Detail>
        </dl>
      </DialogContent>
    </Dialog>
  )
}
