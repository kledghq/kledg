'use client'

import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DateDisplay, EmptyState, Field, StatusBadge, type StatusTone } from '@/components/shared'

interface AiAction {
  id: string
  tool: string
  companyName: string
  callerName: string | null
  args: unknown
  preview: unknown
  status: string
  expiresAt: string
  createdAt: string
}

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending: { label: 'À approuver', tone: 'warning' },
  approved: { label: 'Approuvée', tone: 'info' },
  executing: { label: 'En cours', tone: 'info' },
  executed: { label: 'Exécutée', tone: 'success' },
  failed: { label: 'Échouée', tone: 'danger' },
  rejected: { label: 'Refusée', tone: 'neutral' },
  expired: { label: 'Expirée', tone: 'neutral' },
}

const TOOL_LABELS: Record<string, string> = {
  validate_entries: 'Valider des écritures',
  reverse_entry: 'Contre-passer une écriture',
  delete_draft_entry: 'Supprimer un brouillon',
  unreconcile_transaction: 'Annuler un rapprochement',
  run_rules: "Appliquer les règles d'affectation",
  delete_rule: "Supprimer une règle d'affectation",
  import_statement: 'Importer un relevé bancaire',
  generate_depreciation: 'Passer les dotations aux amortissements',
  close_fiscal_year: "Clôturer l'exercice",
  allocate_result: 'Affecter le résultat',
  letter_entry_lines: 'Lettrer des lignes',
  unletter_entry_lines: 'Délettrer des lignes',
  create_draft_invoice: 'Enregistrer une facture',
  create_company: 'Créer une société',
  archive_company: 'Archiver une société',
  restore_company: 'Restaurer une société',
  upload_receipt: 'Envoyer un justificatif à Qonto',
  bulk_reconcile: 'Rapprocher des transactions',
  sync_bank_data: "Actualiser et appliquer les règles d'affectation",
  create_rule: "Créer une règle d'affectation automatique",
  update_rule: "Modifier une règle d'affectation automatique",
  add_rule_from_template: 'Ajouter une règle de la bibliothèque',
  copy_rules_from_company: "Copier des règles d'une autre société",
}

/**
 * The name of the assistant that asked, shown as data between « »: an OAuth
 * client chooses its own name at registration (it could call itself
 * "Kledg"), so it never reads as part of the sentence. Invisible and
 * control characters are dropped and the name is cut short.
 */
export function requesterName(callerName: string | null): string {
  const name = (callerName ?? '').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim()
  if (!name) return 'un assistant'
  return `l'assistant «\u00a0${name.length > 60 ? `${name.slice(0, 59)}\u2026` : name}\u00a0»`
}

/** Arguments shown without the file content of an import (base64). */
function displayedArgs(args: unknown): unknown {
  if (!args || typeof args !== 'object') return args
  const copy = { ...(args as Record<string, unknown>) }
  if (typeof copy.contentBase64 === 'string') copy.contentBase64 = `(${copy.contentBase64.length} caractères)`
  return copy
}

/**
 * The user's actions prepared by assistants. Approving or refusing asks for
 * the account password again; the request is a same-origin JSON POST with
 * the session cookie, which no assistant holds.
 */
export function AiActionsList({ highlight }: { highlight: string | null }) {
  const [actions, setActions] = useState<AiAction[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [deciding, setDeciding] = useState<{ action: AiAction; decision: 'approve' | 'reject' } | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const response = await fetch('/api/ai-actions', { cache: 'no-store' })
      if (!response.ok) throw new Error()
      setActions(((await response.json()) as { actions: AiAction[] }).actions)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function decide() {
    if (!deciding) return
    setSending(true)
    setError(null)
    const response = await fetch(`/api/ai-actions/${encodeURIComponent(deciding.action.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: deciding.decision, password }),
    }).catch(() => null)
    setSending(false)
    if (!response?.ok) {
      const data = (await response?.json().catch(() => ({}))) as { error?: string } | undefined
      setError(data?.error ?? "La décision n'a pas pu être enregistrée. Vérifiez votre connexion et réessayez.")
      return
    }
    toast.success(
      deciding.decision === 'approve'
        ? "Action approuvée : l'assistant peut maintenant l'exécuter."
        : "Action refusée : elle ne sera pas exécutée.",
    )
    setDeciding(null)
    setPassword('')
    load()
  }

  if (failed) {
    return (
      <EmptyState
        bordered
        title="Les actions n'ont pas pu être chargées"
        description="Vérifiez votre connexion, puis réessayez."
        action={
          <Button size="sm" variant="outline" onClick={load}>
            Réessayer
          </Button>
        }
      />
    )
  }
  if (!actions) return <div aria-busy="true" className="bg-muted h-32 animate-pulse rounded-lg" />
  if (actions.length === 0) {
    return (
      <EmptyState
        bordered
        icon={ShieldCheck}
        title="Aucune action en attente"
        description="Quand un assistant en contrôle total prépare une action à fort impact, elle apparaît ici avec son aperçu."
      />
    )
  }

  const ordered = [...actions].sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'))

  return (
    <div className="space-y-4">
      {ordered.map((action) => {
        const status = STATUS[action.status] ?? { label: action.status, tone: 'neutral' as StatusTone }
        return (
          <Card key={action.id} className={action.id === highlight ? 'ring-primary ring-2' : undefined}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>{TOOL_LABELS[action.tool] ?? action.tool}</CardTitle>
                <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              </div>
              <CardDescription>
                {action.companyName} · demandée par {requesterName(action.callerName)} le{' '}
                <DateDisplay value={action.createdAt} />
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="mb-1 text-xs font-medium">Aperçu de ce qui sera fait</p>
                <pre className="bg-muted max-h-80 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap break-all">
                  {JSON.stringify(action.preview, null, 2)}
                </pre>
              </div>
              <details>
                <summary className="text-muted-foreground cursor-pointer text-xs pointer-coarse:py-3">Paramètres exacts</summary>
                <pre className="bg-muted mt-1 max-h-60 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap break-all">
                  {JSON.stringify(displayedArgs(action.args), null, 2)}
                </pre>
              </details>
            </CardContent>
            {action.status === 'pending' ? (
              <CardFooter className="flex gap-2">
                <Button variant="outline" onClick={() => setDeciding({ action, decision: 'reject' })}>
                  Refuser
                </Button>
                <Button onClick={() => setDeciding({ action, decision: 'approve' })}>Approuver</Button>
              </CardFooter>
            ) : null}
          </Card>
        )
      })}

      <Dialog
        open={deciding !== null}
        onOpenChange={(open) => {
          if (!open && !sending) {
            setDeciding(null)
            setPassword('')
            setError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deciding?.decision === 'approve' ? 'Approuver cette action ?' : 'Refuser cette action ?'}
            </DialogTitle>
            <DialogDescription>
              {deciding?.decision === 'approve'
                ? "L'assistant pourra l'exécuter une fois, avec exactement ces paramètres, dans les 30 minutes. Saisissez votre mot de passe pour confirmer."
                : "L'action ne sera pas exécutée. Saisissez votre mot de passe pour confirmer."}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              decide()
            }}
          >
            <Field label="Mot de passe" error={error ?? undefined} required>
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={sending}
              />
            </Field>
            <DialogFooter className="pt-4">
              <Button type="submit" loading={sending} disabled={!password}>
                {deciding?.decision === 'approve' ? 'Approuver' : 'Refuser'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
