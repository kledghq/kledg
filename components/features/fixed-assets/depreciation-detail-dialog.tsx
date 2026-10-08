'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { Amount, StatusBadge, formatAmount, formatDisplayDate, useConfirm } from '@/components/shared'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  ChevronDown,
  ChevronRight,
  Calculator,
  Trash2,
  Loader2,
  Pencil,
  Link2,
  Unlink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { plural, pluralWord } from '@/lib/utils/plural'

interface LinkedAccountingEntry {
  id: string
  entryNumber: string
  date: string
}

interface PostedEntry {
  id: string
  entryNumber: string
  date: string
  amount: number
  description: string
  accountingEntry: LinkedAccountingEntry | null
}

interface MonthPosted {
  id: string
  amount: number
  note: string | null
  accountingEntry: LinkedAccountingEntry | null
}

interface MonthDetail {
  monthIndex: number
  calendarYear: number
  monthStart: string
  monthEnd: string
  suggestedAmount: number
  posted: MonthPosted | null
}

interface FiscalYearDetail {
  fiscalYearId: string
  virtual?: boolean
  year: number
  startDate: string
  endDate: string
  isClosed: boolean
  entriesCount: number
  postedAmount: number
  suggestedAmount: number
  done: boolean
  entries: PostedEntry[]
  months: MonthDetail[]
  yearlyRecord: {
    id: string
    amount: number
    note: string | null
    accountingEntry: LinkedAccountingEntry | null
  } | null
}

interface DepreciationStatusResponse {
  baseAmount: number
  totalPosted: number
  remainingCapacity: number
  depreciationMethod: string
  depreciationStartDate: string
  fiscalYears: FiscalYearDetail[]
}

interface DepreciationDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  assetId: string | null
  companyId: string
  assetLabel?: string
  onChanged?: () => void
}

const formatCurrency = (amount: number) => formatAmount(amount)

function monthLabel(monthIndex: number, calendarYear: number): string {
  return new Date(Date.UTC(calendarYear, monthIndex, 1)).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

interface EntryCandidate {
  id: string
  entryNumber: string
  date: string
  description: string | null
  status: string
  total: number
  looksLikeAmortization: boolean
  alreadyLinkedCount: number
}

function LinkEntryPopover({
  assetId,
  companyId,
  recordId,
  onLinked,
}: {
  assetId: string
  companyId: string
  recordId: string
  onLinked: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [candidates, setCandidates] = useState<EntryCandidate[] | null>(null)
  const [linking, setLinking] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/fixed-assets/${assetId}/depreciation/${recordId}/candidates?companyId=${companyId}`
      )
      if (res.ok) {
        const data = await res.json()
        setCandidates(data.candidates ?? [])
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || 'Erreur lors du chargement')
      }
    } catch (e) {
      logger.error('Error loading link candidates', e)
      toast.error('Erreur lors du chargement')
    } finally {
      setLoading(false)
    }
  }, [assetId, companyId, recordId])

  useEffect(() => {
    if (open && !candidates) void load()
  }, [open, candidates, load])

  const linkTo = async (accountingEntryId: string) => {
    setLinking(accountingEntryId)
    try {
      const res = await fetch(
        `/api/fixed-assets/${assetId}/depreciation/${recordId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId, accountingEntryId }),
        }
      )
      if (res.ok) {
        toast.success('Écriture liée')
        setOpen(false)
        onLinked()
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || 'Erreur lors du lien')
      }
    } catch (e) {
      logger.error('Error linking entry', e)
      toast.error('Erreur lors du lien')
    } finally {
      setLinking(null)
    }
  }

  const filtered = (candidates ?? []).filter((c) => {
    if (!filter.trim()) return true
    const q = filter.toLowerCase()
    return (
      c.entryNumber.toLowerCase().includes(q) ||
      (c.description ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="xs"
          variant="outline"
          title="Lier une écriture comptable existante"
        >
          <Link2 aria-hidden />
          Lier
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-2" align="end">
        <div className="space-y-2">
          <Input
            placeholder="Filtrer par numéro ou libellé"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8"
          />
          <div className="max-h-72 overflow-y-auto border rounded">
            {loading && (
              <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                <Loader2 aria-hidden className="mr-2 size-4 animate-spin" />
                Chargement...
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="py-4 text-center text-sm text-muted-foreground">
                Aucune écriture candidate dans cet exercice.
              </div>
            )}
            {!loading &&
              filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => linkTo(c.id)}
                  disabled={linking === c.id}
                  className="w-full text-left p-2 hover:bg-muted border-b last:border-b-0 disabled:opacity-50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-medium">
                      {c.entryNumber}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDisplayDate(c.date)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {c.description || 'Sans libellé'}
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-xs font-mono">
                      {formatCurrency(c.total)}
                    </span>
                    <div className="flex items-center gap-1">
                      {c.alreadyLinkedCount > 0 && (
                        <Badge
                          variant="muted"
                          title={`Déjà liée à ${plural(c.alreadyLinkedCount, 'autre amortissement', 'autres amortissements')}`}
                        >
                          {c.alreadyLinkedCount} lien{c.alreadyLinkedCount > 1 ? 's' : ''}
                        </Badge>
                      )}
                      {c.looksLikeAmortization && (
                        <Badge variant="info" title="Ressemble à une écriture d'amortissement (compte 681)">
                          Amortissement
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
              ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Plan table under 40rem of container width (phones): each year or month
 * becomes two lines, the period with its suggested amount, then the amount
 * field and the actions. Full class strings so that Tailwind generates them.
 */
const PLAN = {
  table: '@max-[40rem]/plan:block @max-[40rem]/plan:[&>tbody]:block',
  hidden: '@max-[40rem]/plan:hidden',
  row: '@max-[40rem]/plan:flex @max-[40rem]/plan:flex-wrap @max-[40rem]/plan:items-center @max-[40rem]/plan:gap-x-3 @max-[40rem]/plan:gap-y-2 @max-[40rem]/plan:px-3 @max-[40rem]/plan:py-2.5',
  toggle: '@max-[40rem]/plan:p-0',
  label: '@max-[40rem]/plan:min-w-0 @max-[40rem]/plan:flex-1 @max-[40rem]/plan:p-0 @max-[40rem]/plan:whitespace-normal',
  suggested:
    '@max-[40rem]/plan:p-0 @max-[40rem]/plan:before:mr-1.5 @max-[40rem]/plan:before:text-xs @max-[40rem]/plan:before:font-normal @max-[40rem]/plan:before:text-muted-foreground @max-[40rem]/plan:before:content-[attr(data-label)]',
  amount: '@max-[40rem]/plan:min-w-40 @max-[40rem]/plan:flex-1 @max-[40rem]/plan:p-0',
  actions: '@max-[40rem]/plan:ml-auto @max-[40rem]/plan:p-0',
} as const

export function DepreciationDetailDialog({
  open,
  onOpenChange,
  assetId,
  companyId,
  assetLabel,
  onChanged,
}: DepreciationDetailDialogProps) {
  const [status, setStatus] = useState<DepreciationStatusResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set())
  // { "fiscalYearId:month:idx": "123.45" }, montants édités par l'utilisateur
  // (remplacent le suggéré à l'envoi si présents).
  const [edits, setEdits] = useState<Record<string, string>>({})
  // Clé de la ligne en cours de traitement (post/delete).
  const [pending, setPending] = useState<string | null>(null)
  // Lignes mises en mode édition (valeurs déjà postées qu'on veut modifier).
  const [editingKeys, setEditingKeys] = useState<Set<string>>(new Set())
  const { confirm, dialog: confirmDialog } = useConfirm()

  const fetchStatus = useCallback(async () => {
    if (!assetId) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/fixed-assets/${assetId}/depreciation-status?companyId=${companyId}`
      )
      if (res.ok) {
        const data = (await res.json()) as DepreciationStatusResponse
        setStatus(data)
        // À l'ouverture, déplier par défaut l'exercice contenant aujourd'hui.
        const now = new Date()
        const current = data.fiscalYears.find(
          (fy) =>
            new Date(fy.startDate) <= now && now <= new Date(fy.endDate)
        )
        setExpandedYears(new Set(current ? [current.fiscalYearId] : []))
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || "Erreur lors du chargement du plan d'amortissement")
      }
    } catch (e) {
      logger.error('Error fetching depreciation status', e)
      toast.error("Erreur lors du chargement")
    } finally {
      setLoading(false)
    }
  }, [assetId, companyId])

  useEffect(() => {
    if (open && assetId) {
      setEdits({})
      setEditingKeys(new Set())
      void fetchStatus()
    }
    if (!open) {
      setStatus(null)
      setEdits({})
      setEditingKeys(new Set())
      setExpandedYears(new Set())
    }
  }, [open, assetId, fetchStatus])

  const toggleYear = (id: string) => {
    setExpandedYears((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const rowKey = (fyId: string, kind: 'year' | 'month', monthIndex?: number) =>
    kind === 'year' ? `${fyId}:year` : `${fyId}:month:${monthIndex}`

  const parseAmount = (raw: string | undefined, fallback: number): number => {
    if (raw === undefined || raw === '') return fallback
    const n = parseFloat(raw.replace(',', '.'))
    return Number.isFinite(n) ? n : fallback
  }

  /**
   * "Amortir" (par ligne) : sauvegarde la valeur ET crée l'écriture comptable.
   * Si un record existe déjà, on update la valeur puis on génère l'écriture
   * uniquement si elle n'est pas encore liée.
   */
  const postEntry = async (
    fy: FiscalYearDetail,
    kind: 'year' | 'month',
    monthIndex?: number
  ) => {
    if (!assetId) return
    const key = rowKey(fy.fiscalYearId, kind, monthIndex)
    setPending(key)
    try {
      const m = kind === 'month' ? fy.months.find((x) => x.monthIndex === monthIndex) : null
      const fallback =
        kind === 'year'
          ? (fy.yearlyRecord?.amount ?? fy.suggestedAmount)
          : (m?.posted?.amount ?? m?.suggestedAmount ?? 0)
      const amount = parseAmount(edits[key], fallback)
      if (amount <= 0) {
        toast.error('Montant invalide')
        return
      }

      // 1. Upsert de la valeur.
      const saveRes = await fetch(`/api/fixed-assets/${assetId}/depreciation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          fiscalYearId: fy.fiscalYearId,
          periodType: kind,
          monthIndex: kind === 'month' ? monthIndex : undefined,
          amount,
        }),
      })
      if (!saveRes.ok) {
        const err = await saveRes.json().catch(() => ({}))
        toast.error(err.error || "Erreur lors de l'enregistrement")
        return
      }
      const record = await saveRes.json()

      // 2. Générer l'écriture comptable (sauf si déjà liée).
      if (!record.accountingEntryId) {
        const postRes = await fetch(
          `/api/fixed-assets/${assetId}/depreciation/${record.id}/post`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companyId }),
          }
        )
        if (!postRes.ok) {
          const err = await postRes.json().catch(() => ({}))
          toast.error(
            err.error || "Valeur enregistrée mais écriture non générée"
          )
          await fetchStatus()
          onChanged?.()
          return
        }
      }

      toast.success("Amortissement enregistré + écriture générée")
      setEdits((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      setEditingKeys((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
      await fetchStatus()
      onChanged?.()
    } catch (e) {
      logger.error('Error posting depreciation', e)
      toast.error("Erreur lors de l'enregistrement")
    } finally {
      setPending(null)
    }
  }

  /**
   * "Enregistrer tout" : upsert UNIQUEMENT les lignes où l'utilisateur a
   * saisi quelque chose (clé présente dans `edits` avec une valeur). Pas
   * de fallback sur le montant suggéré, pas d'auto-génération. Pas
   * d'écriture comptable, juste des valeurs en DB.
   *
   * Format de clé : `${fyId}:year` ou `${fyId}:month:${monthIndex}`.
   */
  const saveAll = async () => {
    if (!assetId || !status) return

    const byFy = new Map<string, { virtual?: boolean }>()
    for (const fy of status.fiscalYears) {
      byFy.set(fy.fiscalYearId, { virtual: fy.virtual })
    }

    const pending: Array<{
      fiscalYearId: string
      periodType: 'year' | 'month'
      monthIndex?: number
      amount: number
    }> = []

    for (const [key, raw] of Object.entries(edits)) {
      if (raw === undefined || raw === '') continue
      const parts = key.split(':')
      const fyId = parts[0]
      const kind = parts[1] as 'year' | 'month'
      const monthIndex = parts[2] ? Number(parts[2]) : undefined
      const fy = byFy.get(fyId)
      if (!fy || fy.virtual) continue // on ignore les exercices virtuels
      const amount = parseAmount(raw, NaN)
      if (!Number.isFinite(amount) || amount < 0) continue
      pending.push({
        fiscalYearId: fyId,
        periodType: kind,
        monthIndex: kind === 'month' ? monthIndex : undefined,
        amount,
      })
    }

    if (pending.length === 0) {
      toast.info('Rien à enregistrer')
      return
    }

    setPending('__saveAll__')
    let saved = 0
    let failed = 0
    try {
      for (const p of pending) {
        const res = await fetch(`/api/fixed-assets/${assetId}/depreciation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId, ...p }),
        })
        if (res.ok) saved++
        else failed++
      }
      if (saved > 0) {
        toast.success(
          `${saved} amortissement${saved > 1 ? 's' : ''} enregistré${
            saved > 1 ? 's' : ''
          }${failed > 0 ? ` · ${failed} échec${failed > 1 ? 's' : ''}` : ''}`
        )
      } else {
        toast.error(`${plural(failed, 'amortissement')} ${pluralWord(failed, "n'a pas pu être enregistré", "n'ont pas pu être enregistrés")}`)
      }
      setEdits({})
      setEditingKeys(new Set())
      await fetchStatus()
      onChanged?.()
    } catch (e) {
      logger.error('Error saving all depreciations', e)
      toast.error("Erreur lors de l'enregistrement")
    } finally {
      setPending(null)
    }
  }

  /** Detaches the accounting entry from a depreciation record (the entry itself is kept). */
  const unlinkRecord = async (recordId: string) => {
    if (!assetId) return
    try {
      const res = await fetch(`/api/fixed-assets/${assetId}/depreciation/${recordId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, accountingEntryId: null }),
      })
      if (res.ok) {
        toast.success('Écriture déliée')
        await fetchStatus()
        onChanged?.()
      } else {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(err.error || "L'écriture n'a pas été déliée. Réessayez.")
      }
    } catch (e) {
      logger.error('Error unlinking', e)
      toast.error("L'écriture n'a pas été déliée. Réessayez.")
    }
  }

  const deleteEntry = async (recordId: string, key: string) => {
    if (!assetId) return
    const ok = await confirm({
      title: 'Supprimer cet amortissement\u00a0?',
      description:
        "Le montant enregistré est effacé et son écriture d'amortissement en brouillon est supprimée. Une écriture validée ne peut pas être supprimée\u00a0: passez une contre-passation.",
      confirmLabel: "Supprimer l'amortissement",
    })
    if (!ok) return
    setPending(key)
    try {
      const res = await fetch(
        `/api/fixed-assets/${assetId}/depreciation/${recordId}?companyId=${companyId}`,
        { method: 'DELETE' }
      )
      if (res.ok) {
        toast.success("Amortissement supprimé")
        await fetchStatus()
        onChanged?.()
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || 'Erreur lors de la suppression')
      }
    } catch (e) {
      logger.error('Error deleting depreciation record', e)
      toast.error('Erreur lors de la suppression')
    } finally {
      setPending(null)
    }
  }

  const summary = useMemo(() => {
    if (!status) return null
    return (
      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div>
          <div className="text-muted-foreground text-xs">Base amortissable</div>
          <Amount value={status.baseAmount} className="font-semibold" />
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Cumul amorti</div>
          <Amount value={status.totalPosted} className="font-semibold" />
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Reste à amortir</div>
          <Amount value={status.remainingCapacity} className="font-semibold" />
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Méthode</div>
          <div className="font-medium">
            {status.depreciationMethod === 'linear'
              ? 'Linéaire'
              : status.depreciationMethod === 'declining'
                ? 'Dégressif'
                : 'Non amortissable'}
          </div>
        </div>
      </div>
    )
  }, [status])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col !max-w-[90vw] !w-[90vw] sm:!max-w-[90vw]">
        <DialogHeader>
          <DialogTitle>
            Amortissements, {assetLabel ?? 'immobilisation'}
          </DialogTitle>
          <DialogDescription>
            Cliquez sur une année pour afficher le détail mensuel. Vous pouvez
            modifier le montant suggéré avant d'enregistrer.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {loading && !status && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Chargement...
            </div>
          )}

          {status && summary}

          {status && status.fiscalYears.length === 0 && (
            <Alert>
              <AlertDescription>
                Aucun exercice pour cette société&nbsp;: créez-en un dans Société, Exercices.
              </AlertDescription>
            </Alert>
          )}

          {status && status.fiscalYears.length > 0 && (
            <div className="@container/plan border rounded-lg overflow-hidden">
              <Table className={PLAN.table}>
                <TableHeader className={PLAN.hidden}>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Exercice / Mois</TableHead>
                    <TableHead className="text-right">Suggéré</TableHead>
                    <TableHead className="w-56">Montant</TableHead>
                    <TableHead className="w-48 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {status.fiscalYears.map((fy) => {
                    const isExpanded = expandedYears.has(fy.fiscalYearId)
                    const yKey = rowKey(fy.fiscalYearId, 'year')
                    const hasAnyPosted = fy.entries.length > 0
                    return (
                      <React.Fragment key={fy.fiscalYearId}>
                        <TableRow className={cn('bg-muted/30 font-medium', PLAN.row)}>
                          <TableCell className={PLAN.toggle}>
                            <button
                              type="button"
                              onClick={() => toggleYear(fy.fiscalYearId)}
                              data-touch-target
                              className="p-1 hover:bg-muted rounded"
                              aria-label={`${isExpanded ? 'Replier' : 'Déplier'} l'exercice ${fy.year}`}
                              aria-expanded={isExpanded}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                          </TableCell>
                          <TableCell className={PLAN.label}>
                            Exercice {fy.year}
                            {fy.isClosed && (
                              <StatusBadge className="ml-2">Clôturé</StatusBadge>
                            )}
                            {fy.virtual && (
                              <StatusBadge tone="warning" className="ml-2" title="Cet exercice n'est pas encore créé">
                                À créer
                              </StatusBadge>
                            )}
                          </TableCell>
                          <TableCell numeric data-label="Suggéré" className={PLAN.suggested}>
                            {formatCurrency(fy.suggestedAmount)}
                          </TableCell>
                          <TableCell className={PLAN.amount}>
                            {(() => {
                              const isEditing =
                                editingKeys.has(yKey) || !hasAnyPosted
                              if (!isEditing && fy.yearlyRecord) {
                                return (
                                  <div className="flex items-center gap-2">
                                    <span className="num font-medium">
                                      {formatCurrency(fy.yearlyRecord.amount)}
                                    </span>
                                    {!fy.virtual && (
                                      <Button
                                        size="icon-xs"
                                        variant="ghost"
                                        onClick={() =>
                                          setEditingKeys((prev) => {
                                            const next = new Set(prev)
                                            next.add(yKey)
                                            return next
                                          })
                                        }
                                        aria-label="Modifier le montant"
                                        title="Modifier le montant"
                                      >
                                        <Pencil aria-hidden />
                                      </Button>
                                    )}
                                    {fy.yearlyRecord.accountingEntry && (
                                      <a
                                        href={`/${companyId}/entries/${fy.yearlyRecord.accountingEntry.id}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-xs text-primary underline hover:no-underline"
                                      >
                                        {fy.yearlyRecord.accountingEntry.entryNumber}
                                      </a>
                                    )}
                                  </div>
                                )
                              }
                              return (
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  step="0.01"
                                  min="0"
                                  placeholder={fy.suggestedAmount.toFixed(2)}
                                  className="h-8"
                                  value={
                                    edits[yKey] ??
                                    (fy.yearlyRecord
                                      ? String(fy.yearlyRecord.amount)
                                      : '')
                                  }
                                  onChange={(e) =>
                                    setEdits((prev) => ({
                                      ...prev,
                                      [yKey]: e.target.value,
                                    }))
                                  }
                                  disabled={pending === yKey || !!fy.virtual}
                                  title={
                                    fy.virtual
                                      ? "Créez d'abord l'exercice pour saisir un montant"
                                      : undefined
                                  }
                                  autoFocus={editingKeys.has(yKey)}
                                />
                              )
                            })()}
                          </TableCell>
                          <TableCell className={cn('text-right', PLAN.actions)}>
                            <div className="flex items-center justify-end gap-1">
                              {fy.virtual && (
                                <span className="text-xs text-muted-foreground">
                                  Créez l'exercice
                                </span>
                              )}
                              {/* Amortir = sauve + crée l'écriture. Uniquement si aucun record n'existe encore. */}
                              {!fy.virtual && !fy.yearlyRecord && (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  onClick={() => postEntry(fy, 'year')}
                                  loading={pending === yKey}
                                >
                                  <Calculator aria-hidden />
                                  Amortir
                                </Button>
                              )}
                              {/* Lier une écriture existante : record présent sans écriture. */}
                              {!fy.virtual &&
                                fy.yearlyRecord &&
                                !fy.yearlyRecord.accountingEntry &&
                                assetId && (
                                  <LinkEntryPopover
                                    assetId={assetId}
                                    companyId={companyId}
                                    recordId={fy.yearlyRecord.id}
                                    onLinked={() => {
                                      void fetchStatus()
                                      onChanged?.()
                                    }}
                                  />
                                )}
                              {/* Délier une écriture liée. */}
                              {!fy.virtual &&
                                fy.yearlyRecord?.accountingEntry &&
                                assetId && (
                                  <Button
                                    size="icon-xs"
                                    variant="ghost"
                                    onClick={() => void unlinkRecord(fy.yearlyRecord!.id)}
                                    aria-label="Délier l'écriture"
                                    title="Délier l'écriture"
                                  >
                                    <Unlink aria-hidden />
                                  </Button>
                                )}
                              {!fy.virtual && fy.yearlyRecord && (
                                <Button
                                  size="icon-xs"
                                  variant="ghost"
                                  className="hover:text-destructive"
                                  onClick={() => void deleteEntry(fy.yearlyRecord!.id, yKey)}
                                  loading={pending === yKey}
                                  aria-label="Supprimer l'amortissement"
                                  title="Supprimer l'amortissement et son écriture en brouillon"
                                >
                                  <Trash2 aria-hidden />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>

                        {isExpanded &&
                          fy.months.map((m) => {
                            const key = rowKey(
                              fy.fiscalYearId,
                              'month',
                              m.monthIndex
                            )
                            return (
                              <TableRow key={key} className={PLAN.row}>
                                <TableCell className={PLAN.hidden}></TableCell>
                                <TableCell className={cn('pl-8 text-sm', PLAN.label, '@max-[40rem]/plan:pl-0')}>
                                  {monthLabel(m.monthIndex, m.calendarYear)}
                                </TableCell>
                                <TableCell numeric data-label="Suggéré" className={cn('text-sm', PLAN.suggested)}>
                                  {m.suggestedAmount > 0
                                    ? formatCurrency(m.suggestedAmount)
                                    : null}
                                </TableCell>
                                <TableCell className={PLAN.amount}>
                                  {(() => {
                                    const isEditing =
                                      editingKeys.has(key) || !m.posted
                                    if (!isEditing && m.posted) {
                                      return (
                                        <div className="flex items-center gap-2">
                                          <span className="num font-medium text-sm">
                                            {formatCurrency(m.posted.amount)}
                                          </span>
                                          {!fy.virtual && (
                                            <Button
                                              size="icon-xs"
                                              variant="ghost"
                                              onClick={() =>
                                                setEditingKeys((prev) => {
                                                  const next = new Set(prev)
                                                  next.add(key)
                                                  return next
                                                })
                                              }
                                              aria-label="Modifier le montant"
                                              title="Modifier le montant"
                                            >
                                              <Pencil aria-hidden />
                                            </Button>
                                          )}
                                          {m.posted.accountingEntry && (
                                            <a
                                              href={`/${companyId}/entries/${m.posted.accountingEntry.id}`}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="text-xs text-primary underline hover:no-underline"
                                            >
                                              {m.posted.accountingEntry.entryNumber}
                                            </a>
                                          )}
                                        </div>
                                      )
                                    }
                                    return (
                                      <Input
                                        type="number"
                                        inputMode="decimal"
                                        step="0.01"
                                        min="0"
                                        placeholder={m.suggestedAmount.toFixed(2)}
                                        className="h-8"
                                        value={
                                          edits[key] ??
                                          (m.posted ? String(m.posted.amount) : '')
                                        }
                                        onChange={(e) =>
                                          setEdits((prev) => ({
                                            ...prev,
                                            [key]: e.target.value,
                                          }))
                                        }
                                        disabled={
                                          pending === key ||
                                          !!fy.virtual ||
                                          (!m.posted && m.suggestedAmount <= 0)
                                        }
                                        autoFocus={editingKeys.has(key)}
                                      />
                                    )
                                  })()}
                                </TableCell>
                                <TableCell className={cn('text-right', PLAN.actions)}>
                                  <div className="flex items-center justify-end gap-1">
                                    {!fy.virtual &&
                                      !m.posted &&
                                      m.suggestedAmount > 0 && (
                                        <Button
                                          size="xs"
                                          variant="outline"
                                          onClick={() =>
                                            postEntry(fy, 'month', m.monthIndex)
                                          }
                                          loading={pending === key}
                                          title="Enregistre le montant et crée l'écriture d'amortissement"
                                        >
                                          <Calculator aria-hidden />
                                          Amortir
                                        </Button>
                                      )}
                                    {/* Lier une écriture si record sans lien. */}
                                    {!fy.virtual &&
                                      m.posted &&
                                      !m.posted.accountingEntry &&
                                      assetId && (
                                        <LinkEntryPopover
                                          assetId={assetId}
                                          companyId={companyId}
                                          recordId={m.posted.id}
                                          onLinked={() => {
                                            void fetchStatus()
                                            onChanged?.()
                                          }}
                                        />
                                      )}
                                    {/* Délier si lien présent. */}
                                    {!fy.virtual &&
                                      m.posted?.accountingEntry &&
                                      assetId && (
                                        <Button
                                          size="icon-xs"
                                          variant="ghost"
                                          onClick={() => void unlinkRecord(m.posted!.id)}
                                          aria-label="Délier l'écriture"
                                          title="Délier l'écriture"
                                        >
                                          <Unlink aria-hidden />
                                        </Button>
                                      )}
                                    {m.posted && (
                                      <Button
                                        size="icon-xs"
                                        variant="ghost"
                                        className="hover:text-destructive"
                                        onClick={() => void deleteEntry(m.posted!.id, key)}
                                        loading={pending === key}
                                        aria-label="Supprimer l'amortissement"
                                        title="Supprimer l'amortissement et son écriture en brouillon"
                                      >
                                        <Trash2 aria-hidden />
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                      </React.Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
          <Button
            onClick={saveAll}
            loading={pending === '__saveAll__'}
            disabled={!status || status.fiscalYears.length === 0}
          >
            Enregistrer
          </Button>
        </DialogFooter>
        {confirmDialog}
      </DialogContent>
    </Dialog>
  )
}
