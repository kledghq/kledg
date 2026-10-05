'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Download, FileDown, FileUp, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { FileInput } from '@/components/ui/file-input'
import { Label } from '@/components/ui/label'
import { Amount, Field, formatDisplayDate, StatusBadge, type StatusTone } from '@/components/shared'
import { toCents } from '@/lib/utils/money'
import { bankAccountName, ibanTail, plural } from './format'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { BANK_PRESETS } from '@/lib/banking/import/presets'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import {
  droppedFile,
  externalFile,
  type ExternalFile,
  IMPORT_DIALOG_STATE_EVENT,
  IMPORT_FILE_EVENT,
  IMPORT_FILE_PARAM,
  type ImportDialogState,
  type ImportFileRequest,
  isImportableDrag,
} from './statement-drop'
import type { ColumnMapping, ColumnRole, DateFormat, DecimalSeparator, RowError, TabularDetection, TabularOptions } from '@/lib/banking/import/types'
import { STATEMENT_FILE_ACCEPT } from '@/components/features/import/file-accept'

export interface ImportableAccount {
  id: string
  name: string
  displayName: string | null
  iban: string | null
}

interface ExistingMatch {
  id: string
  date: string
  valueDate: string | null
  label: string | null
  amount: string
  source: 'file' | 'sync'
  format: string | null
}

interface PreviewRow {
  /** Position in the import plan and stable key: sent back to keep a probable duplicate. */
  index: number
  key: string
  line: number
  bookingDate: string
  valueDate: string | null
  label: string
  reference: string | null
  counterparty: string | null
  amount: string
  duplicate: false | 'import' | 'sync' | 'file' | 'probable'
  match: ExistingMatch | null
}

interface PreviewResponse {
  format: 'csv' | 'xlsx' | 'ofx' | 'camt053'
  encoding: string | null
  tabular: TabularDetection | null
  summary: {
    total: number
    new: number
    duplicates: number
    probable: number
    probableKept: number
    from: string | null
    to: string | null
    debitsCents: number
    creditsCents: number
  }
  /** Every probable duplicate of the file (the preview rows are capped). */
  probable: PreviewRow[]
  warnings: string[]
  errors: RowError[]
  errorCount: number
  rows: PreviewRow[]
}

const FORMAT_LABELS: Record<PreviewResponse['format'], string> = {
  csv: 'CSV',
  xlsx: 'Excel (.xlsx)',
  ofx: 'OFX / QFX',
  camt053: 'ISO 20022 camt.053',
}

const ROLE_LABELS: Array<[ColumnRole, string]> = [
  ['date', "Date d'opération"],
  ['valueDate', 'Date de valeur'],
  ['label', 'Libellé'],
  ['label2', 'Libellé complémentaire'],
  ['reference', 'Référence'],
  ['transactionId', 'Identifiant bancaire'],
  ['amount', 'Montant (signé)'],
  ['debit', 'Débit'],
  ['credit', 'Crédit'],
  ['currency', 'Devise'],
  ['counterparty', 'Tiers'],
  ['status', 'Statut'],
]

const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  'dd/mm/yyyy': 'JJ/MM/AAAA',
  'dd/mm/yy': 'JJ/MM/AA',
  'yyyy-mm-dd': 'AAAA-MM-JJ',
  'mm/dd/yyyy': 'MM/JJ/AAAA (américain)',
  yyyymmdd: 'AAAAMMJJ',
}

const DELIMITER_LABELS: Record<string, string> = { ';': 'point-virgule', ',': 'virgule', '\t': 'tabulation', '|': 'barre verticale' }

const DUPLICATE_LABELS: Record<Exclude<PreviewRow['duplicate'], false>, string> = {
  import: 'Déjà importée',
  sync: 'Déjà synchronisée',
  file: 'Doublon dans le fichier',
  probable: 'Doublon probable',
}

/** Status of a preview row: new lines are imported, exact duplicates are skipped, probable ones need a look. */
function rowStatus(row: PreviewRow, kept: boolean): { tone: StatusTone; label: string } {
  if (row.duplicate === 'probable') return kept ? { tone: 'success', label: 'Doublon probable, importé' } : { tone: 'warning', label: DUPLICATE_LABELS.probable }
  if (row.duplicate) return { tone: 'neutral', label: DUPLICATE_LABELS[row.duplicate] }
  return { tone: 'success', label: 'Nouvelle' }
}

const SOURCE_LABELS: Record<string, string> = { csv: 'CSV', xlsx: 'Excel', ofx: 'OFX', camt053: 'camt.053' }

function sourceLabel(match: ExistingMatch): string {
  if (match.source === 'sync') return 'Synchronisation bancaire'
  return match.format ? `Import ${SOURCE_LABELS[match.format] ?? match.format}` : 'Import de fichier'
}

const cents = (amount: string) => toCents(amount) ?? 0

const EXAMPLES = [
  { href: '/examples/exemple-releve.csv', label: 'CSV' },
  { href: '/examples/exemple-releve.ofx', label: 'OFX' },
  { href: '/examples/exemple-releve-camt053.xml', label: 'camt.053' },
]

const NONE = '__none'
const AUTO = '__auto'

/** Days of the import API are ISO calendar days ("2026-03-02"): 02/03/2026. */
const day = (iso: string | null) => formatDisplayDate(iso)

/** Import summary for the toast: "12 opérations importées, 2 doublons ignorés". */
export function importSummary(body: { created: number; duplicates: number; probableSkipped: number }): string {
  const parts = [`${plural(body.created, 'opération importée', 'opérations importées')}`]
  if (body.duplicates > 0) parts.push(plural(body.duplicates, 'doublon ignoré', 'doublons ignorés'))
  if (body.probableSkipped > 0) parts.push(plural(body.probableSkipped, 'doublon probable ignoré', 'doublons probables ignorés'))
  return parts.join(', ')
}

export function StatementImportDialog({
  companyId,
  accounts,
  defaultAccountId,
  onImported,
  open: controlledOpen,
  onOpenChange,
}: {
  companyId: string
  accounts: ImportableAccount[]
  defaultAccountId?: string
  onImported?: () => void
  /** Controlled open state, for pages that open the dialog from elsewhere (an empty state). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [innerOpen, setInnerOpen] = useState(false)
  const { can, denied } = useCompanyAccess()
  const mayImport = can({ banking: ['reconcile'] })
  const open = controlledOpen ?? innerOpen
  const onOpenChangeRef = useRef(onOpenChange)
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  })
  const setOpen = useCallback((next: boolean) => {
    setInnerOpen(next)
    onOpenChangeRef.current?.(next)
  }, [])
  const [chosenAccountId, setBankAccountId] = useState(defaultAccountId ?? '')
  // A single account needs no choice
  const bankAccountId = chosenAccountId || (accounts.length === 1 ? accounts[0].id : '')
  const [file, setFile] = useState<File | null>(null)
  const [options, setOptions] = useState<TabularOptions>({})
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [allowErrors, setAllowErrors] = useState(false)
  // Stays open once shown, so editing a column does not fold it away
  const [mappingOpen, setMappingOpen] = useState(false)
  // Keys of the probable duplicates the user chose to import (all skipped by default)
  const [keptKeys, setKeptKeys] = useState<Set<string>>(new Set())

  const reset = () => {
    setFile(null)
    setOptions({})
    setPreview(null)
    setError(null)
    setAllowErrors(false)
    setMappingOpen(false)
    setKeptKeys(new Set())
  }

  const send = async (mode: 'preview' | 'import', nextOptions: TabularOptions, override: { file?: File; accountId?: string } = {}) => {
    const sentFile = override.file ?? file
    const sentAccount = override.accountId ?? bankAccountId
    if (!sentFile || !sentAccount) return null
    const form = new FormData()
    form.append('companyId', companyId)
    form.append('bankAccountId', sentAccount)
    form.append('file', sentFile)
    form.append('mode', mode)
    if (Object.keys(nextOptions).length > 0) form.append('options', JSON.stringify(nextOptions))
    if (allowErrors) form.append('allowErrors', 'true')
    if (mode === 'import' && preview && keptKeys.size > 0) {
      const keep = preview.probable.filter((r) => keptKeys.has(r.key)).map((r) => ({ index: r.index, key: r.key }))
      form.append('keep', JSON.stringify(keep))
    }
    const response = await fetch('/api/banking/import-statement', { method: 'POST', body: form })
    const body = await response.json().catch(() => ({ error: 'Réponse du serveur illisible.' }))
    if (!response.ok) throw new Error(body.error || "Erreur lors de l'import du fichier.")
    return body
  }

  const analyze = async (nextOptions: TabularOptions = options, override: { file?: File; accountId?: string } = {}) => {
    setLoading(true)
    setError(null)
    try {
      const body = (await send('preview', nextOptions, override)) as PreviewResponse | null
      setOptions(nextOptions)
      setPreview(body)
      setKeptKeys(new Set())
      if (body?.tabular && (body.tabular.confidence === 'low' || body.errors.some((e) => e.line === 0))) setMappingOpen(true)
    } catch (e) {
      setPreview(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const confirm = async () => {
    setImporting(true)
    setError(null)
    try {
      const body = (await send('import', options)) as { created: number; duplicates: number; probableSkipped: number }
      toast.success(importSummary(body))
      setOpen(false)
      reset()
      onImported?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  /**
   * Opens the dialog on a file (dropped from the desktop or handed over by an
   * external file source, see ./statement-drop.ts), selects the bank account
   * the file belongs to, and analyses it at once.
   */
  const loadFile = async (next: File, accountId?: string) => {
    const account = accountId && accounts.some((a) => a.id === accountId) ? accountId : bankAccountId
    setOpen(true)
    setFile(next)
    setOptions({})
    setPreview(null)
    setAllowErrors(false)
    setMappingOpen(false)
    setKeptKeys(new Set())
    if (account) setBankAccountId(account)
    if (!account) {
      setError('Choisissez le compte bancaire, puis analysez le fichier.')
      return
    }
    await analyze({}, { file: next, accountId: account })
  }
  const loadFileRef = useRef(loadFile)
  useEffect(() => {
    loadFileRef.current = loadFile
  })

  const loadExternal = useCallback(async (source: ExternalFile) => {
    try {
      await loadFileRef.current(await source.load(), source.bankAccountId)
    } catch (e) {
      setOpen(true)
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [setOpen])

  const handleDrop = async (dataTransfer: DataTransfer) => {
    try {
      const dropped = await droppedFile(dataTransfer)
      if (dropped) await loadFileRef.current(dropped.file, dropped.bankAccountId)
    } catch (e) {
      setOpen(true)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // Page-wide drop target while the dialog is closed: a file (real or from an
  // external file source) dropped anywhere on the page opens the dialog with it.
  const [pageDrag, setPageDrag] = useState(false)
  const [zoneDrag, setZoneDrag] = useState(false)
  const handleDropRef = useRef(handleDrop)
  useEffect(() => {
    handleDropRef.current = handleDrop
  })
  useEffect(() => {
    // A role that cannot import gets no drop target
    if (open || !mayImport) return
    let depth = 0
    const enter = (e: DragEvent) => {
      if (!isImportableDrag(e.dataTransfer)) return
      depth++
      setPageDrag(true)
    }
    const over = (e: DragEvent) => {
      if (!isImportableDrag(e.dataTransfer)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const leave = (e: DragEvent) => {
      if (!isImportableDrag(e.dataTransfer)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setPageDrag(false)
    }
    const drop = (e: DragEvent) => {
      if (!isImportableDrag(e.dataTransfer) || !e.dataTransfer) return
      e.preventDefault()
      depth = 0
      setPageDrag(false)
      void handleDropRef.current(e.dataTransfer)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
      setPageDrag(false)
    }
  }, [open, mayImport])

  // Lets external file sources (a floating panel) fold away while a preview needs the room
  const hasPreview = preview !== null
  useEffect(() => {
    const detail: ImportDialogState = { open, hasPreview }
    window.dispatchEvent(new CustomEvent(IMPORT_DIALOG_STATE_EVENT, { detail }))
  }, [open, hasPreview])
  useEffect(
    () => () => {
      window.dispatchEvent(new CustomEvent(IMPORT_DIALOG_STATE_EVENT, { detail: { open: false, hasPreview: false } }))
    },
    [],
  )

  // An external file source asks to import one of its files: handled here
  // when the page has the dialog
  useEffect(() => {
    const onImportFile = (e: Event) => {
      const source = externalFile((e as CustomEvent<ImportFileRequest>).detail?.token)
      if (!source) return
      e.preventDefault()
      void loadExternal(source)
    }
    window.addEventListener(IMPORT_FILE_EVENT, onImportFile)
    return () => window.removeEventListener(IMPORT_FILE_EVENT, onImportFile)
  }, [loadExternal])

  // ...or after a navigation from another page (?importFile=<token>)
  const externalHandled = useRef(false)
  useEffect(() => {
    if (externalHandled.current || accounts.length === 0) return
    const params = new URLSearchParams(window.location.search)
    const token = params.get(IMPORT_FILE_PARAM)
    if (!token) return
    externalHandled.current = true
    params.delete(IMPORT_FILE_PARAM)
    const query = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
    const source = externalFile(token)
    if (!source) return
    // Next tick: the dialog state changes outside the effect body
    setTimeout(() => void loadExternal(source), 0)
  }, [accounts, loadExternal])

  /** Changes one column role and re-runs the preview with the full mapping. */
  const setRole = (role: ColumnRole, value: string) => {
    if (!preview?.tabular) return
    const mapping: ColumnMapping = { ...preview.tabular.mapping }
    for (const [r, index] of Object.entries(mapping)) if (String(index) === value) delete mapping[r as ColumnRole]
    if (value === NONE) delete mapping[role]
    else mapping[role] = Number(value)
    // Amount and Débit/Crédit are alternatives
    if (role === 'amount' && value !== NONE) {
      delete mapping.debit
      delete mapping.credit
    }
    if ((role === 'debit' || role === 'credit') && value !== NONE) delete mapping.amount
    void analyze({ ...options, mapping, headerRow: preview.tabular.headerRow })
  }

  const tabular = preview?.tabular
  const blocking = preview?.errors.some((e) => e.line === 0) ?? false
  // What will be imported: new lines plus the probable duplicates the user keeps
  const kept = preview?.probable.filter((r) => keptKeys.has(r.key)) ?? []
  const toImport = (preview?.summary.new ?? 0) + kept.length
  const keptDates = kept.map((r) => r.bookingDate)
  const period = [preview?.summary.from, preview?.summary.to, ...keptDates].filter((d): d is string => !!d).sort()
  const debitsCents = (preview?.summary.debitsCents ?? 0) + kept.reduce((s, r) => s + Math.max(0, -cents(r.amount)), 0)
  const creditsCents = (preview?.summary.creditsCents ?? 0) + kept.reduce((s, r) => s + Math.max(0, cents(r.amount)), 0)
  const allIgnored = keptKeys.size === 0
  const toggleKept = (key: string, keep: boolean) =>
    setKeptKeys((current) => {
      const next = new Set(current)
      if (keep) next.add(key)
      else next.delete(key)
      return next
    })
  const canImport = !!preview && !blocking && toImport > 0 && (preview.errorCount === 0 || allowErrors) && !loading && !importing

  return (
    <>
    {pageDrag && !open && (
      <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-primary bg-background px-10 py-8 text-center shadow-lg">
          <FileDown aria-hidden className="size-8 text-primary" />
          <p className="text-base font-medium">Déposez le relevé pour l’importer</p>
          <p className="text-sm text-muted-foreground">CSV, Excel, OFX/QFX ou camt.053</p>
        </div>
      </div>
    )}
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!mayImport} title={mayImport ? undefined : denied('importer un relevé')}>
          <Upload aria-hidden />
          Importer un relevé
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-4xl"
        // Instance overlays (an external file source panel) stay usable above
        // the dialog: dragging a file from them must not close it
        onInteractOutside={(e) => {
          if ((e.target as Element | null)?.closest?.('[data-instance-overlay]')) e.preventDefault()
        }}
        onDragOver={(e) => {
          if (!isImportableDrag(e.dataTransfer)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setZoneDrag(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setZoneDrag(false)
        }}
        onDrop={(e) => {
          if (!isImportableDrag(e.dataTransfer)) return
          e.preventDefault()
          setZoneDrag(false)
          void handleDrop(e.dataTransfer)
        }}
      >
        <DialogHeader>
          <DialogTitle>Importer un relevé bancaire</DialogTitle>
          <DialogDescription>
            Pour toute banque sans synchronisation automatique&nbsp;: exportez vos opérations depuis votre espace bancaire en CSV, Excel,
            OFX/QFX ou camt.053, puis déposez le fichier ici. Le format, l’encodage et les colonnes sont détectés automatiquement ;
            vous vérifiez l’aperçu avant d’importer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Compte bancaire"
              htmlFor="statement-account"
              className="min-w-0"
              hint={
                accounts.length === 0
                  ? 'Aucun compte bancaire pour l’instant\u00a0: ajoutez d’abord le compte avec «\u00a0Ajouter un compte bancaire\u00a0», puis importez son relevé.'
                  : undefined
              }
            >
              <Select
                value={bankAccountId}
                onValueChange={(value) => {
                  setBankAccountId(value)
                  setPreview(null)
                }}
                disabled={loading || importing || accounts.length === 0}
              >
                <SelectTrigger id="statement-account" className="w-full min-w-0 overflow-hidden">
                  <SelectValue placeholder="Choisir un compte" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => {
                    const name = bankAccountName(account)
                    return (
                      <SelectItem key={account.id} value={account.id}>
                        {name}
                        {account.iban && !name.endsWith(ibanTail(account.iban)) ? (
                          <span className="text-muted-foreground font-mono text-xs">{ibanTail(account.iban)}</span>
                        ) : null}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </Field>
            <div
              data-testid="statement-drop-zone"
              className={`min-w-0 space-y-2 rounded-md border-2 border-dashed p-2 transition-colors ${
                zoneDrag ? 'border-primary bg-primary/5' : 'border-transparent'
              }`}
            >
              <Label htmlFor="statement-file">
                {zoneDrag ? (
                  'Déposez le fichier ici'
                ) : (
                  <>
                    Fichier du relevé<span className="pointer-coarse:hidden"> (ou glissez-le ici)</span>
                  </>
                )}
              </Label>
              <FileInput
                id="statement-file"
                accept={STATEMENT_FILE_ACCEPT}
                fileName={file?.name ?? null}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null)
                  setOptions({})
                  setPreview(null)
                  setError(null)
                  setAllowErrors(false)
                }}
                disabled={loading || importing}
              />
            </div>
          </div>

          <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground space-y-2">
            {/* Folded: on a phone the full text pushed the import button far down. */}
            <details>
              <summary className="text-foreground cursor-pointer font-medium pointer-coarse:py-3">Formats acceptés et doublons</summary>
              <div className="mt-2 space-y-1">
                <p>
                  Formats acceptés&nbsp;: CSV (séparateur point-virgule, virgule ou tabulation, UTF-8 ou Windows-1252), Excel .xlsx, OFX/QFX et
                  ISO 20022 camt.053. Les modèles d’export de BNP Paribas, Société Générale, Crédit Agricole, Banque Populaire, Caisse
                  d’Epargne, Crédit Mutuel, CIC, La Banque Postale, BoursoBank, Shine, Qonto et Revolut Business sont reconnus ; pour les
                  autres banques, les colonnes Date, Libellé, Montant ou Débit/Crédit sont repérées par leur nom.
                </p>
                <p>
                  Réimporter un fichier ou une période qui se chevauche ne crée pas de doublon. Une ligne de même date et de même montant
                  qu’une opération déjà présente (autre format, synchronisation) est signalée comme doublon probable. Les opérations en
                  attente sont ignorées.
                </p>
              </div>
            </details>
            <div className="flex flex-wrap items-center gap-2">
              <span>Fichiers d’exemple&nbsp;:</span>
              {EXAMPLES.map((example) => (
                <Button key={example.href} asChild size="xs" variant="outline">
                  <a href={example.href} download aria-label={`Télécharger l'exemple ${example.label}`}>
                    <Download aria-hidden />
                    {example.label}
                  </a>
                </Button>
              ))}
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {preview && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Format détecté&nbsp;:</span>
                <Badge variant="secondary">{FORMAT_LABELS[preview.format]}</Badge>
                {preview.encoding && <Badge variant="outline">{preview.encoding === 'windows-1252' ? 'Windows-1252' : preview.encoding.toUpperCase()}</Badge>}
                {tabular?.delimiter && <Badge variant="outline">séparateur {DELIMITER_LABELS[tabular.delimiter] ?? tabular.delimiter}</Badge>}
                {tabular?.preset && <Badge>Modèle {tabular.preset.name}</Badge>}
                {tabular && tabular.confidence === 'low' && (
                  <Badge variant="warning">Colonnes à vérifier</Badge>
                )}
              </div>

              {tabular && (
                <details
                  open={mappingOpen}
                  onToggle={(e) => setMappingOpen(e.currentTarget.open)}
                  className="rounded-md border p-3"
                >
                  <summary className="cursor-pointer text-sm font-medium">Correspondance des colonnes et formats</summary>
                  <div className="mt-3 space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="Modèle de banque" htmlFor="statement-preset">
                        <Select
                          value={options.preset ?? AUTO}
                          onValueChange={(value) =>
                            void analyze(value === AUTO ? { sheetName: options.sheetName } : { sheetName: options.sheetName, preset: value })
                          }
                          disabled={loading}
                        >
                          <SelectTrigger id="statement-preset" size="sm" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={AUTO}>Détection automatique</SelectItem>
                            {BANK_PRESETS.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Format des dates" htmlFor="statement-date-format">
                        <Select
                          value={tabular.dateFormat}
                          onValueChange={(value) => void analyze({ ...options, dateFormat: value as DateFormat })}
                          disabled={loading}
                        >
                          <SelectTrigger id="statement-date-format" size="sm" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(DATE_FORMAT_LABELS).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Séparateur décimal des montants" htmlFor="statement-decimal">
                        <Select
                          value={tabular.decimalSeparator}
                          onValueChange={(value) => void analyze({ ...options, decimalSeparator: value as DecimalSeparator })}
                          disabled={loading}
                        >
                          <SelectTrigger id="statement-decimal" size="sm" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value=",">Virgule (1 234,56)</SelectItem>
                            <SelectItem value=".">Point (1,234.56)</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>

                    {tabular.sheetNames && tabular.sheetNames.length > 1 && (
                      <Field label="Feuille du classeur" htmlFor="statement-sheet" className="sm:w-1/3">
                        <Select
                          value={options.sheetName ?? tabular.sheetNames[0]}
                          onValueChange={(value) => void analyze({ sheetName: value })}
                          disabled={loading}
                        >
                          <SelectTrigger id="statement-sheet" size="sm" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {tabular.sheetNames.map((name) => (
                              <SelectItem key={name} value={name}>
                                {name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                      {ROLE_LABELS.map(([role, label]) => (
                        <Field key={role} label={label} htmlFor={`statement-role-${role}`}>
                          <Select
                            value={tabular.mapping[role] === undefined ? NONE : String(tabular.mapping[role])}
                            onValueChange={(value) => setRole(role, value)}
                            disabled={loading}
                          >
                            <SelectTrigger id={`statement-role-${role}`} size="sm" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>Aucune</SelectItem>
                              {tabular.headers.map((header, index) => (
                                <SelectItem key={index} value={String(index)}>
                                  {header}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                      ))}
                    </div>

                    {tabular.sampleRows.length > 0 && (
                      <div className="overflow-x-auto">
                        <p className="mb-1 text-xs text-muted-foreground">
                          Premières lignes du fichier{tabular.headerRow > 0 ? ` (en-tête trouvé ligne ${tabular.headerRow + 1})` : ''} :
                        </p>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              {tabular.headers.map((header, index) => (
                                <TableHead key={index} className="whitespace-nowrap text-xs">
                                  {header}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {tabular.sampleRows.map((row, i) => (
                              <TableRow key={i}>
                                {row.map((cell, j) => (
                                  <TableCell key={j} className="max-w-48 truncate text-xs">
                                    {cell}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                </details>
              )}

              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <div className="min-w-0 rounded-md border p-3">
                  <dt className="text-xs text-muted-foreground">À importer</dt>
                  <dd className="num text-xl font-semibold">{toImport}</dd>
                </div>
                <div className="min-w-0 rounded-md border p-3">
                  <dt className="text-xs text-muted-foreground">Doublons exacts ignorés</dt>
                  <dd className="num text-xl font-semibold">{preview.summary.duplicates}</dd>
                </div>
                <div className="min-w-0 rounded-md border p-3">
                  <dt className="text-xs text-muted-foreground">Doublons probables</dt>
                  <dd className="num text-xl font-semibold">{preview.summary.probable}</dd>
                  {kept.length > 0 && (
                    <dd className="text-xs text-muted-foreground">dont {plural(kept.length, 'importé')}</dd>
                  )}
                </div>
                <div className="min-w-0 rounded-md border p-3">
                  <dt className="text-xs text-muted-foreground">Période</dt>
                  <dd className="num text-sm font-medium">
                    {period.length > 0 ? `Du ${day(period[0])} au ${day(period[period.length - 1])}` : 'Aucune opération'}
                  </dd>
                </div>
                <div className="min-w-0 rounded-md border p-3">
                  <dt className="text-xs text-muted-foreground">Débits et crédits</dt>
                  <dd className="text-sm font-medium">
                    <Amount value={-debitsCents / 100} />
                  </dd>
                  <dd className="text-sm font-medium">
                    <Amount value={creditsCents / 100} sign="always" />
                  </dd>
                </div>
              </dl>

              {preview.probable.length > 0 && (
                <section aria-labelledby="probable-title" className="space-y-2 rounded-md border p-3">
                  <h3 id="probable-title" className="flex items-center gap-2 text-sm font-medium">
                    <AlertTriangle aria-hidden className="size-4 text-warning" />
                    {plural(preview.probable.length, 'doublon probable', 'doublons probables')}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Ces lignes ont la même date et le même montant qu’une opération déjà présente sur le compte, avec un autre
                    libellé (autre format d’export ou synchronisation bancaire). Elles sont ignorées par défaut&nbsp;: décochez
                    « Ignorer » pour importer une ligne quand même.
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-24">
                          <label className="flex items-center gap-2">
                            <Checkbox
                              checked={allIgnored ? true : keptKeys.size >= preview.probable.length ? false : 'indeterminate'}
                              onCheckedChange={(v) => setKeptKeys(v === true ? new Set() : new Set(preview.probable.map((r) => r.key)))}
                              aria-label="Ignorer tous les doublons probables"
                            />
                            Ignorer
                          </label>
                        </TableHead>
                        <TableHead>Ligne du fichier</TableHead>
                        <TableHead numeric>Montant</TableHead>
                        <TableHead className="hidden sm:table-cell">Opération déjà présente</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.probable.map((row) => (
                        <TableRow key={row.key}>
                          <TableCell>
                            <Checkbox
                              checked={!keptKeys.has(row.key)}
                              onCheckedChange={(v) => toggleKept(row.key, v !== true)}
                              aria-label={`Ignorer la ligne ${row.line}`}
                            />
                          </TableCell>
                          <TableCell className="max-w-72 whitespace-normal sm:whitespace-nowrap">
                            <div className="num whitespace-nowrap text-xs text-muted-foreground">
                              {day(row.bookingDate)}, ligne {row.line}
                            </div>
                            <div className="line-clamp-2 break-words sm:truncate" title={row.label}>
                              {row.label}
                            </div>
                            {row.match ? (
                              <div className="text-muted-foreground mt-1 text-xs break-words sm:hidden">
                                Déjà présente&nbsp;: {day(row.match.date)}, {row.match.label || 'sans libellé'}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell numeric>
                            <Amount value={row.amount} />
                          </TableCell>
                          <TableCell className="hidden max-w-72 sm:table-cell">
                            {row.match && (
                              <>
                                <div className="num whitespace-nowrap text-xs text-muted-foreground">
                                  {day(row.match.date)}, {sourceLabel(row.match)}
                                </div>
                                <div className="truncate" title={row.match.label ?? ''}>
                                  {row.match.label || <span className="text-muted-foreground">Sans libellé</span>}
                                </div>
                              </>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
              )}

              {preview.warnings.length > 0 && (
                <Alert>
                  <AlertDescription>
                    <ul className="list-disc list-inside text-sm">
                      {preview.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {preview.errorCount > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle aria-hidden />
                  <AlertDescription>
                    <p className="font-medium">
                      {plural(preview.errorCount, 'problème')} dans le fichier
                      {blocking ? '\u00a0: choisissez les colonnes manquantes ci-dessus.' : ''}
                    </p>
                    <ul className="list-disc list-inside text-sm">
                      {preview.errors.slice(0, 8).map((e, i) => (
                        <li key={i}>{e.message}</li>
                      ))}
                      {preview.errorCount > 8 && <li>et {plural(preview.errorCount - 8, 'autre')}</li>}
                    </ul>
                    {!blocking && (
                      <label className="mt-2 flex items-center gap-2 text-sm">
                        <Checkbox checked={allowErrors} onCheckedChange={(v) => setAllowErrors(v === true)} />
                        Importer quand même les lignes valides
                      </label>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {preview.rows.length > 0 && (
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">
                    {preview.summary.total > preview.rows.length
                      ? `Aperçu des ${preview.rows.length} premières opérations sur ${preview.summary.total}\u00a0:`
                      : 'Aperçu :'}
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="hidden sm:table-cell">Date</TableHead>
                        <TableHead>Libellé</TableHead>
                        <TableHead className="hidden md:table-cell">Référence</TableHead>
                        <TableHead numeric>Montant</TableHead>
                        <TableHead className="hidden sm:table-cell">Statut</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.rows.map((row, i) => {
                        const status = rowStatus(row, keptKeys.has(row.key))
                        return (
                          <TableRow key={i} className={row.duplicate && !keptKeys.has(row.key) ? 'text-muted-foreground' : undefined}>
                            <TableCell className="num hidden whitespace-nowrap sm:table-cell">{day(row.bookingDate)}</TableCell>
                            <TableCell className="max-w-80 whitespace-normal sm:truncate sm:whitespace-nowrap" title={row.label}>
                              <span className="num block text-xs text-muted-foreground sm:hidden">{day(row.bookingDate)}</span>
                              <span className="line-clamp-2 break-words sm:inline">{row.label}</span>
                              <StatusBadge tone={status.tone} className="mt-1 sm:hidden">
                                {status.label}
                              </StatusBadge>
                            </TableCell>
                            <TableCell className="hidden max-w-40 truncate text-muted-foreground md:table-cell">{row.reference ?? ''}</TableCell>
                            <TableCell numeric>
                              <Amount value={row.amount} />
                            </TableCell>
                            <TableCell className="hidden sm:table-cell">
                              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={importing}>
            Annuler
          </Button>
          {!preview ? (
            <Button onClick={() => void analyze()} disabled={!file || !bankAccountId} loading={loading}>
              <FileUp aria-hidden />
              Analyser le fichier
            </Button>
          ) : (
            <Button onClick={() => void confirm()} disabled={!canImport && !importing} loading={importing}>
              <Upload aria-hidden />
              {toImport > 0 ? `Importer ${plural(toImport, 'opération')}` : 'Rien à importer'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
