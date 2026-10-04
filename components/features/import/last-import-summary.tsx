'use client'

import { pluralWord } from '@/lib/utils/plural'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AlertCircle, CheckCircle2, X, XCircle } from 'lucide-react'
import type { ImportResult } from '@/components/features/import/import-dialog'

interface LastImportSummaryProps {
  result: ImportResult
  onDismiss: () => void
}

export function LastImportSummary({ result, onDismiss }: LastImportSummaryProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)

  const errors = result.errors ?? []
  const errorsCount = errors.length
  const createdCount = result.entriesCreated ?? 0
  const hasErrors = errorsCount > 0
  const isFullSuccess = !hasErrors && createdCount > 0
  const isTotalFailure = createdCount === 0

  // Fully successful imports don't need a persistent banner, the user already
  // saw the success modal. Only surface the summary when there's something
  // actionable (errors or total failure).
  if (isFullSuccess) return null

  const Icon = isFullSuccess ? CheckCircle2 : isTotalFailure ? XCircle : AlertCircle
  const iconColor = isFullSuccess ? 'text-success' : isTotalFailure ? 'text-destructive' : 'text-warning'
  const title = isFullSuccess
    ? 'Dernier import réussi'
    : isTotalFailure
      ? 'Dernier import échoué'
      : 'Dernier import\u00a0: terminé avec des écritures ignorées'

  return (
    <>
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${iconColor}`} />
            <div className="flex-1 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">{title}</div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={onDismiss}
                  aria-label="Masquer le récapitulatif"
                  title="Masquer le récapitulatif"
                >
                  <X aria-hidden />
                </Button>
              </div>
              <div className="text-sm text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                <span>
                  <span className="font-medium text-foreground">{createdCount}</span>{' '}
                  {pluralWord(createdCount, 'écriture importée', 'écritures importées')}
                </span>
                <span>
                  <span
                    className={`font-medium ${hasErrors ? 'text-warning' : 'text-foreground'}`}
                  >
                    {errorsCount}
                  </span>{' '}
                  {pluralWord(errorsCount, 'ignorée')}
                </span>
                {(result.accountsCreated || 0) > 0 && (
                  <span>
                    <span className="font-medium text-foreground">{result.accountsCreated}</span>{' '}
                    {pluralWord(result.accountsCreated ?? 0, 'compte créé', 'comptes créés')}
                  </span>
                )}
                {(result.journalsCreated || 0) > 0 && (
                  <span>
                    <span className="font-medium text-foreground">{result.journalsCreated}</span>{' '}
                    {result.journalsCreated !== 1 ? 'journaux' : 'journal'} créé
                    {result.journalsCreated !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {hasErrors && (
                <div>
                  <Button variant="outline" size="sm" onClick={() => setDetailsOpen(true)}>
                    Voir les détails ({errorsCount})
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Écritures ignorées ({errorsCount})</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto rounded-md border p-3 space-y-1.5 text-xs">
            {errors.map((err, i) => (
              <div key={i} className="font-mono text-muted-foreground break-words">
                {err}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => setDetailsOpen(false)}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
