'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AmountInput } from '@/components/ui/amount-input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DateInput } from '@/components/ui/date-input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Amount } from '@/components/shared'
import { responseError } from '@/hooks/use-cursor-list'
import { DISPOSAL_KIND_LABELS, DISPOSAL_KINDS, type DisposalKind, type DisposalPreview } from '@/lib/fixed-assets/disposal'
import { fromCents, toCents } from '@/lib/utils/money'

export interface DisposalAsset {
  id: string
  label: string
  disposalDate?: string | null
  disposalKind?: string | null
  disposalPrice?: number | string | null
  disposalEntryId?: string | null
}

const isKind = (value: unknown): value is DisposalKind => typeof value === 'string' && (DISPOSAL_KINDS as readonly string[]).includes(value)
const euros = (cents: number) => fromCents(cents)

/**
 * "Sortie de l'immobilisation": the day, the kind of exit and the price,
 * the computed gain or loss and its tax character, then the exit entry
 * prepared as a draft (POST /api/fixed-assets/[id]/disposal). A recorded
 * exit can be changed (the draft is replaced) or cancelled.
 */
export function DisposalDialog({
  open,
  onOpenChange,
  asset,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset: DisposalAsset | null
  onChanged: () => void
}) {
  const recorded = isKind(asset?.disposalKind)
  const [disposalDate, setDisposalDate] = React.useState('')
  const [kind, setKind] = React.useState<DisposalKind>('sale')
  const [priceCents, setPriceCents] = React.useState<number | null>(null)
  const [priceRecorded, setPriceRecorded] = React.useState(false)
  const [preview, setPreview] = React.useState<DisposalPreview | null>(null)
  const [busy, setBusy] = React.useState<'preview' | 'record' | 'cancel' | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open || !asset) return
    setDisposalDate(asset.disposalDate ? asset.disposalDate.slice(0, 10) : '')
    setKind(isKind(asset.disposalKind) ? asset.disposalKind : 'sale')
    setPriceCents(asset.disposalPrice != null ? toCents(asset.disposalPrice) : null)
    setPriceRecorded(false)
    setPreview(null)
    setError(null)
  }, [open, asset])

  // A changed field makes the computed result stale
  const change = <T,>(set: (v: T) => void) => (value: T) => {
    set(value)
    setPreview(null)
  }

  const send = async (dryRun: boolean): Promise<DisposalPreview | null> => {
    if (!asset) return null
    const response = await fetch(`/api/fixed-assets/${asset.id}/disposal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disposalDate, kind, price: priceCents === null ? null : fromCents(priceCents), priceRecorded, dryRun }),
    })
    if (!response.ok) throw new Error(await responseError(response, 'La sortie n’a pas pu être calculée. Réessayez.'))
    return (await response.json()) as DisposalPreview
  }

  const compute = async () => {
    setBusy('preview')
    setError(null)
    try {
      setPreview(await send(true))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const record = async () => {
    setBusy('record')
    setError(null)
    try {
      const result = await send(false)
      toast.success(`Écriture de sortie n° ${result?.entry?.entryNumber ?? ''} préparée en brouillon`, {
        description: 'Vérifiez-la puis validez-la depuis la saisie des écritures.',
      })
      onOpenChange(false)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const cancel = async () => {
    if (!asset) return
    setBusy('cancel')
    setError(null)
    try {
      const response = await fetch(`/api/fixed-assets/${asset.id}/disposal`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await responseError(response, 'La sortie n’a pas pu être annulée. Réessayez.'))
      toast.success('Sortie annulée : l’immobilisation est de nouveau à l’actif.')
      onOpenChange(false)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const result = preview?.result
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Sortie de l&apos;immobilisation{asset ? ` « ${asset.label} »` : ''}</DialogTitle>
          <DialogDescription>
            Vente, mise au rebut ou destruction. Kledg calcule la plus ou moins-value et prépare l&apos;écriture de sortie en brouillon, à vérifier puis valider.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="disposal-date">Date de sortie</Label>
            <DateInput id="disposal-date" value={disposalDate} onValueChange={change(setDisposalDate)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="disposal-kind">Nature</Label>
            <Select value={kind} onValueChange={(v) => change(setKind)(v as DisposalKind)}>
              <SelectTrigger id="disposal-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DISPOSAL_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {DISPOSAL_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="disposal-price">{kind === 'sale' ? 'Prix de cession HT' : 'Indemnité reçue HT (facultatif)'}</Label>
            <AmountInput id="disposal-price" value={priceCents} onValueChange={change(setPriceCents)} />
          </div>
          <div className="flex items-end gap-2 pb-2">
            <Checkbox id="disposal-price-recorded" checked={priceRecorded} onCheckedChange={(v) => change(setPriceRecorded)(v === true)} />
            <Label htmlFor="disposal-price-recorded" className="font-normal">
              Prix déjà comptabilisé par une facture de vente
            </Label>
          </div>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {preview && result ? (
          <div className="space-y-3 text-sm" data-slot="disposal-preview">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
              <dt className="text-muted-foreground">Valeur d&apos;origine</dt>
              <dd className="num text-right sm:text-left"><Amount value={euros(preview.grossCents)} /></dd>
              <dt className="text-muted-foreground">Amortissements</dt>
              <dd className="num text-right sm:text-left"><Amount value={euros(preview.depreciationCents)} /></dd>
              <dt className="text-muted-foreground">Valeur nette comptable</dt>
              <dd className="num text-right sm:text-left"><Amount value={euros(result.netBookValueCents)} /></dd>
              <dt className="text-muted-foreground">{result.gainCents >= 0 ? 'Plus-value' : 'Moins-value'}</dt>
              <dd className="num text-right font-medium sm:text-left"><Amount value={euros(Math.abs(result.gainCents))} /></dd>
              {result.shortTermCents !== null ? (
                <>
                  <dt className="text-muted-foreground">Court terme</dt>
                  <dd className="num text-right sm:text-left"><Amount value={euros(result.shortTermCents)} /></dd>
                  <dt className="text-muted-foreground">Long terme</dt>
                  <dd className="num text-right sm:text-left"><Amount value={euros(result.longTermCents ?? 0)} /></dd>
                </>
              ) : null}
            </dl>
            <p className="text-muted-foreground">{result.explanation}</p>
            <div className="overflow-x-auto rounded-md border">
              <Table aria-label="Écriture de sortie">
                <TableHeader>
                  <TableRow>
                    <TableHead>Compte</TableHead>
                    <TableHead numeric>Débit</TableHead>
                    <TableHead numeric>Crédit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.lines.map((line) => (
                    <TableRow key={`${line.code}-${line.debitCents}-${line.creditCents}`}>
                      <TableCell>
                        <span className="font-mono">{line.code}</span> {line.label}
                      </TableCell>
                      <TableCell numeric>{line.debitCents ? <Amount value={euros(line.debitCents)} /> : null}</TableCell>
                      <TableCell numeric>{line.creditCents ? <Amount value={euros(line.creditCents)} /> : null}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {preview.warnings.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5" data-slot="disposal-warnings">
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-between">
          {recorded ? (
            <Button variant="outline" onClick={cancel} loading={busy === 'cancel'} disabled={busy !== null}>
              Annuler la sortie
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={compute} loading={busy === 'preview'} disabled={busy !== null || !disposalDate}>
              Calculer
            </Button>
            <Button onClick={record} loading={busy === 'record'} disabled={busy !== null || !preview}>
              Préparer l&apos;écriture de sortie
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
