'use client'

import * as React from 'react'
import { Inbox } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmDialog, Field } from '@/components/shared'
import { responseError } from '@/components/features/banking/types'
import type { MailboxReading, MailboxView } from '@/lib/receipts/mailbox/mailbox.service'

interface ReceiptMailboxCardProps {
  companyId: string
  /** settings:update: connects, changes or removes the mailbox. */
  canManage: boolean
  /** Called once a reading staged receipts: the list of dropped receipts changed. */
  onRead?: () => void
}

const DEFAULT_MOVE_TO = 'Kledg/Traités'

async function send<T>(url: string, method: string, body: unknown, fallback: string): Promise<T> {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(await responseError(response, fallback))
  return (await response.json()) as T
}

const dateTime = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

/**
 * The company's receipt mailbox (docs/justificatifs-email.md#boîte-e-mail):
 * an IMAP mailbox Kledg reads every night, and on demand, for the receipts
 * attached to its messages.
 */
export function ReceiptMailboxCard({ companyId, canManage, onRead }: ReceiptMailboxCardProps) {
  const [mailbox, setMailbox] = React.useState<MailboxView | null>(null)
  const [editing, setEditing] = React.useState(false)
  const [removing, setRemoving] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    fetch(`/api/receipts/mailbox?companyId=${encodeURIComponent(companyId)}`)
      .then((response) => (response.ok ? (response.json() as Promise<MailboxView>) : null))
      .then((view) => {
        if (!cancelled) setMailbox(view)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [companyId])

  if (!mailbox) return null

  async function readNow() {
    setBusy(true)
    try {
      const reading = await send<MailboxReading>('/api/receipts/mailbox/read', 'POST', { companyId }, 'La boîte e-mail n’a pas pu être relevée. Réessayez.')
      toast.success(
        reading.staged === 0
          ? 'Boîte relevée : aucun nouveau justificatif.'
          : `${reading.staged} justificatif${reading.staged > 1 ? 's' : ''} reçu${reading.staged > 1 ? 's' : ''}${reading.more ? ' ; la suite à la prochaine relève' : ''}.`,
      )
      setMailbox((m) => (m ? { ...m, lastReadAt: new Date().toISOString(), lastError: null } : m))
      if (reading.staged > 0) onRead?.()
    } catch (error) {
      toast.error((error as Error).message)
      setMailbox((m) => (m ? { ...m, lastError: (error as Error).message } : m))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await send(`/api/receipts/mailbox?companyId=${encodeURIComponent(companyId)}`, 'DELETE', { companyId }, 'La boîte n’a pas pu être déconnectée. Réessayez.')
      setMailbox({ configured: false, host: null, username: null, folder: null, mode: null, moveTo: null, lastReadAt: null, lastError: null })
      toast.success('Boîte déconnectée : Kledg a oublié son mot de passe.')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
      setRemoving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Inbox className="size-4" aria-hidden />
          Relever une boîte e-mail
        </CardTitle>
        <CardDescription>
          Kledg lit chaque nuit les pièces jointes des messages d’un dossier de votre boîte e-mail (IMAP) et cherche leur transaction. Utilisez une boîte ou un dossier réservé aux factures&nbsp;: Kledg lit chaque message qui y arrive.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {mailbox.configured ? (
          <>
            <dl className="grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
              <dt className="text-muted-foreground">Boîte</dt>
              <dd className="break-all">
                {mailbox.username} sur {mailbox.host}
              </dd>
              <dt className="text-muted-foreground">Dossier lu</dt>
              <dd>{mailbox.folder}</dd>
              <dt className="text-muted-foreground">Messages lus</dt>
              <dd>{mailbox.mode === 'move' ? `déplacés vers ${mailbox.moveTo}` : 'laissés tels quels'}</dd>
              <dt className="text-muted-foreground">Dernière relève</dt>
              <dd>{mailbox.lastReadAt ? dateTime(mailbox.lastReadAt) : 'pas encore'}</dd>
            </dl>
            {mailbox.lastError ? (
              <p className="text-destructive text-sm" role="alert">
                {mailbox.lastError}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void readNow()} loading={busy}>
                Relever maintenant
              </Button>
              {canManage ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={busy}>
                    Modifier
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(true)} disabled={busy}>
                    Déconnecter
                  </Button>
                </>
              ) : null}
            </div>
          </>
        ) : canManage ? (
          <Button size="sm" onClick={() => setEditing(true)}>
            Connecter une boîte e-mail
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">Un administrateur de la société peut connecter une boîte e-mail.</p>
        )}
      </CardContent>
      {editing ? <MailboxDialog companyId={companyId} current={mailbox} onClose={() => setEditing(false)} onSaved={setMailbox} /> : null}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Déconnecter la boîte e-mail ?"
        description="Kledg cessera de la relever et oubliera son mot de passe. Les justificatifs déjà reçus restent sur la page."
        confirmLabel="Déconnecter"
        loading={busy}
        onConfirm={remove}
      />
    </Card>
  )
}

function MailboxDialog({ companyId, current, onClose, onSaved }: { companyId: string; current: MailboxView; onClose: () => void; onSaved: (view: MailboxView) => void }) {
  const id = React.useId()
  const [host, setHost] = React.useState(current.host ?? '')
  const [username, setUsername] = React.useState(current.username ?? '')
  const [password, setPassword] = React.useState('')
  const [folders, setFolders] = React.useState<string[] | null>(current.folder ? [current.folder] : null)
  const [folder, setFolder] = React.useState(current.folder ?? 'INBOX')
  const [mode, setMode] = React.useState<'read' | 'move'>(current.mode ?? 'read')
  const [moveTo, setMoveTo] = React.useState(current.moveTo ?? DEFAULT_MOVE_TO)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function listFolders() {
    setBusy(true)
    setError(null)
    try {
      const result = await send<{ folders: string[] }>('/api/receipts/mailbox/folders', 'POST', { companyId, host, username, password }, 'La connexion à la boîte a échoué. Réessayez.')
      setFolders(result.folders)
      if (!result.folders.includes(folder)) setFolder(result.folders[0] ?? 'INBOX')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const view = await send<MailboxView>(
        '/api/receipts/mailbox',
        'PUT',
        { companyId, host, username, password, folder, mode, ...(mode === 'move' ? { moveTo } : {}) },
        'La boîte n’a pas pu être enregistrée. Réessayez.',
      )
      onSaved(view)
      toast.success('Boîte e-mail connectée : Kledg la relèvera chaque nuit.')
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{current.configured ? 'Modifier la boîte e-mail' : 'Connecter une boîte e-mail'}</DialogTitle>
          <DialogDescription>
            Kledg se connecte en IMAP chiffré (port 993). Avec Gmail ou iCloud, créez un mot de passe d’application dans les réglages de sécurité de votre compte.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Serveur IMAP" htmlFor={`${id}-host`} required hint="Par exemple imap.gmail.com, ssl0.ovh.net, mail.infomaniak.com.">
            <Input id={`${id}-host`} value={host} autoComplete="off" onChange={(e) => setHost(e.target.value)} />
          </Field>
          <Field label="Identifiant" htmlFor={`${id}-user`} required hint="Souvent l’adresse e-mail.">
            <Input id={`${id}-user`} value={username} autoComplete="off" onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field
            label="Mot de passe"
            htmlFor={`${id}-password`}
            required={!current.configured}
            hint={current.configured ? 'Laissez vide pour garder le mot de passe enregistré. Chiffré sur votre instance, jamais réaffiché.' : 'Chiffré sur votre instance, jamais réaffiché.'}
          >
            <Input id={`${id}-password`} type="password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div className="flex items-end gap-2">
            <Field label="Dossier lu" htmlFor={`${id}-folder`} className="flex-1">
              <Select value={folder} onValueChange={setFolder} disabled={!folders}>
                <SelectTrigger id={`${id}-folder`}>
                  <SelectValue placeholder="Affichez les dossiers" />
                </SelectTrigger>
                <SelectContent>
                  {(folders ?? []).map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Button variant="outline" onClick={() => void listFolders()} disabled={busy || !host || !username}>
              Afficher les dossiers
            </Button>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Messages lus</legend>
            <RadioGroup value={mode} onValueChange={(value) => setMode(value as 'read' | 'move')} className="gap-2">
              <div className="flex items-start gap-2">
                <RadioGroupItem value="read" id={`${id}-read`} className="mt-0.5" />
                <Label htmlFor={`${id}-read`} className="flex-col items-start gap-0.5 font-normal leading-snug">
                  <span>Les laisser tels quels (recommandé)</span>
                  <span className="text-muted-foreground text-xs">Kledg ne modifie rien dans la boîte&nbsp;: il retient le dernier message lu. La première relève prend les 30 derniers jours.</span>
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="move" id={`${id}-move`} className="mt-0.5" />
                <Label htmlFor={`${id}-move`} className="flex-col items-start gap-0.5 font-normal leading-snug">
                  <span>Les déplacer dans un dossier</span>
                  <span className="text-muted-foreground text-xs">Chaque message lu est rangé dans le dossier ci-dessous, créé au besoin&nbsp;: le dossier lu ne garde que ce qui reste à lire.</span>
                </Label>
              </div>
            </RadioGroup>
            {mode === 'move' ? (
              <Field label="Dossier des messages lus" htmlFor={`${id}-move-to`}>
                <Input id={`${id}-move-to`} value={moveTo} onChange={(e) => setMoveTo(e.target.value)} />
              </Field>
            ) : null}
          </fieldset>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!host || !username || !folder}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
