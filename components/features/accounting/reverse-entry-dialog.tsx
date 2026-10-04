'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { DateInput } from '@/components/ui/date-input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toIsoDateUtc } from '@/lib/utils/date'

export interface ReversibleEntry {
  id: string
  entryNumber: string
  /** Stored date (ISO timestamp at midnight UTC) or ISO day. */
  date: string
  description?: string | null
}

export interface ReversalResult {
  id: string
  entryNumber: string
  date: string
}

interface ReverseEntryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: ReversibleEntry
  onReversed?: (reversal: ReversalResult) => void
}

/**
 * Contre-passation of a validated entry: POST /api/entries/[id]/reverse.
 * Reusable wherever a validated entry must be cancelled (entry page, entry
 * list, and later the reconciliation dialog when undoing is refused).
 */
export function ReverseEntryDialog({ open, onOpenChange, entry, onReversed }: ReverseEntryDialogProps) {
  const [date, setDate] = useState(() => toIsoDateUtc(entry.date))
  const [dateError, setDateError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!date) {
      setError('Indiquez la date de la contre-passation.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(`/api/entries/${entry.id}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error || 'La contre-passation a échoué.')
        return
      }
      toast.success(`Écriture n° ${entry.entryNumber} contre-passée par l'écriture n° ${data.entryNumber}`)
      onOpenChange(false)
      onReversed?.(data)
    } catch {
      setError('La contre-passation a échoué. Réessayez.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Contre-passer l&apos;écriture n° {entry.entryNumber}</DialogTitle>
          <DialogDescription>
            Une écriture validée ne peut être ni modifiée ni supprimée. La contre-passation crée une nouvelle écriture
            validée qui inverse les débits et les crédits, liée à celle-ci.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reverse-date">Date de la contre-passation</Label>
          <DateInput id="reverse-date" value={date} onValueChange={setDate} onErrorChange={setDateError} />
          <p className="text-sm text-muted-foreground">
            Par défaut, la date de l&apos;écriture d&apos;origine. Choisissez une date d&apos;un exercice ouvert si son exercice
            est clôturé.
          </p>
          {dateError && <p className="text-sm text-destructive">{dateError}</p>}
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={submitting || !date || !!dateError}>
            {submitting ? 'Contre-passation...' : 'Contre-passer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
