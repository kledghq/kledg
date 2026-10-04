'use client'

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Amount, formatDisplayDate } from '@/components/shared'
import { toCents } from '@/lib/utils/money'
import { logger } from '@/lib/logger'

interface EntryLine {
  id: string
  debit: number
  credit: number
  description?: string | null
  account: {
    code: string
    label: string
  }
}

interface Entry {
  id: string
  entryNumber: string
  date: string
  description?: string | null
  reference?: string | null
  status: string
  journal: {
    code: string
    label: string
  }
  lines: EntryLine[]
}

export interface EntryPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entryId: string | null
}

/**
 * Dialog affichant une écriture comptable (lecture seule).
 * Utilisé depuis la table des transactions pour voir l'écriture rapprochée.
 */
export function EntryPreviewDialog({
  open,
  onOpenChange,
  entryId,
}: EntryPreviewDialogProps) {
  const [entry, setEntry] = React.useState<Entry | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open || !entryId) {
      setEntry(null)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/entries/${entryId}`)
      .then((res) => {
        if (!res.ok) {
          if (res.status === 404) return null
          throw new Error(res.statusText)
        }
        return res.json()
      })
      .then((data: Entry | null) => {
        if (!cancelled) {
          setEntry(data ?? null)
          if (!data) setError('Écriture introuvable')
        }
      })
      .catch((err) => {
        if (!cancelled) {
          logger.error('Error loading entry for preview:', err)
          setError(err instanceof Error ? err.message : 'Erreur lors du chargement')
          setEntry(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, entryId])

  // Summed in cents, shown in euros
  const totalDebit = entry ? entry.lines.reduce((sum, line) => sum + (toCents(line.debit) ?? 0), 0) / 100 : 0
  const totalCredit = entry ? entry.lines.reduce((sum, line) => sum + (toCents(line.credit) ?? 0), 0) / 100 : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>
            {loading ? (
              <Skeleton className="h-7 w-48" />
            ) : entry ? (
              `Écriture ${entry.entryNumber}`
            ) : (
              'Écriture'
            )}
          </DialogTitle>
          <DialogDescription>
            {loading
              ? 'Chargement…'
              : entry
                ? 'Détail de l\'écriture comptable rapprochée'
                : error ?? 'Aucune écriture'}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="space-y-4 mt-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}

        {!loading && error && !entry && (
          <p className="text-sm text-muted-foreground mt-4">{error}</p>
        )}

        {!loading && entry && (
          <div className="grid gap-4 mt-4">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-base">Informations générales</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-muted-foreground">Date</p>
                    <p>{formatDisplayDate(entry.date)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Journal</p>
                    <p>
                      {entry.journal.code} - {entry.journal.label}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Numéro</p>
                    <p>{entry.entryNumber}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Statut</p>
                    <Badge
                      variant={entry.status === 'validated' ? 'default' : 'secondary'}
                    >
                      {entry.status === 'validated' ? 'Validée' : 'Brouillon'}
                    </Badge>
                  </div>
                  {entry.reference && (
                    <div className="col-span-2">
                      <p className="text-muted-foreground">Référence</p>
                      <p>{entry.reference}</p>
                    </div>
                  )}
                  {entry.description && (
                    <div className="col-span-2">
                      <p className="text-muted-foreground">Description</p>
                      <p>{entry.description}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-base">Lignes d'écriture</CardTitle>
                <CardDescription>Comptes débités et crédités</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Compte</TableHead>
                      <TableHead>Libellé</TableHead>
                      <TableHead className="text-right">Débit</TableHead>
                      <TableHead className="text-right">Crédit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entry.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>
                          {line.account.code} - {line.account.label}
                        </TableCell>
                        <TableCell>{line.description || '-'}</TableCell>
                        <TableCell numeric>
                          {Number(line.debit) > 0 ? <Amount value={line.debit} /> : null}
                        </TableCell>
                        <TableCell numeric>
                          {Number(line.credit) > 0 ? <Amount value={line.credit} /> : null}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold">
                      <TableCell colSpan={2} className="text-right">
                        Total
                      </TableCell>
                      <TableCell numeric>
                        <Amount value={totalDebit} />
                      </TableCell>
                      <TableCell numeric>
                        <Amount value={totalCredit} />
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
