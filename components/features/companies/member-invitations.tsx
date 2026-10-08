'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Copy, Mail, RotateCw, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDisplayDate, HelpTip, useConfirm } from '@/components/shared'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/permissions'
import { grantedPermissions, type PermissionRequest } from '@/lib/rbac/granted-permissions'

export type InvitableRole = 'companyAdmin' | 'accountant' | 'viewer'
const ROLES: readonly InvitableRole[] = ['companyAdmin', 'accountant', 'viewer']

export type Invitation = {
  id: string
  email: string
  role: string
  expiresAt: string
  expired: boolean
  lastSentAt: string
  sendCount: number
  invitedBy: { name: string | null; email: string } | null
}

/**
 * The company roles the user may give: those granting nothing their own
 * role lacks (the API checks the same, lib/rbac/company-invitations.service.ts).
 */
export function grantableRoles(can: (request: PermissionRequest) => boolean): InvitableRole[] {
  return ROLES.filter((role) => can(grantedPermissions([role], false)))
}

async function errorOf(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: string } | null
  return data?.error || fallback
}

/** The invitation link, shown once when no email could carry it. */
function LinkDialog({ link, onClose }: { link: { email: string; url: string } | null; onClose: () => void }) {
  return (
    <Dialog open={link !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lien d&apos;invitation</DialogTitle>
          <DialogDescription>
            L&apos;envoi d&apos;emails n&apos;est pas configuré sur cette instance. Transmettez ce lien à {link?.email}
            &nbsp;: il est valable 7 jours, ne sert qu&apos;une fois et ne sera plus affiché.
          </DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="flex items-center gap-2">
            <div className="bg-muted flex-1 rounded-md p-2 font-mono text-xs break-all">{link.url}</div>
            <Button
              size="icon"
              variant="outline"
              aria-label="Copier le lien"
              onClick={() => {
                void navigator.clipboard.writeText(link.url)
                toast.success('Lien copié')
              }}
            >
              <Copy aria-hidden />
            </Button>
          </div>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** "Inviter un membre": an email and a role, sent to POST /api/companies/[id]/invitations. */
export function InviteMemberDialog({
  companyId,
  open,
  onOpenChange,
  roles,
  onInvited,
}: {
  companyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  roles: InvitableRole[]
  onInvited: () => void
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InvitableRole>(roles.includes('accountant') ? 'accountant' : (roles[roles.length - 1] ?? 'viewer'))
  const [submitting, setSubmitting] = useState(false)
  const [link, setLink] = useState<{ email: string; url: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setSubmitting(true)
    try {
      const response = await fetch(`/api/companies/${companyId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role }),
      })
      if (!response.ok) {
        toast.error(await errorOf(response, "L'invitation n'a pas pu être envoyée."))
        return
      }
      const data = (await response.json()) as { emailSent: boolean; link?: string }
      if (data.link) setLink({ email: email.trim(), url: data.link })
      else toast.success(`Invitation envoyée à ${email.trim()}`)
      setEmail('')
      onOpenChange(false)
      onInvited()
    } catch {
      toast.error("L'invitation n'a pas pu être envoyée.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Inviter un membre</DialogTitle>
            <DialogDescription>
              La personne reçoit un email avec un lien valable 7 jours. Elle rejoint la société avec le rôle choisi en
              acceptant, avec son compte ou en créant le sien.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="invitation-email">Email</Label>
              <Input
                id="invitation-email"
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="prenom.nom@exemple.fr"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invitation-role" className="gap-1.5">
                Rôle
                <HelpTip term="Rôles">
                  {roles.map((r) => (
                    <span key={r} className="block">
                      {ROLE_LABELS[r]}&nbsp;: {ROLE_DESCRIPTIONS[r]}
                    </span>
                  ))}
                </HelpTip>
              </Label>
              <Select value={role} onValueChange={(v) => setRole(v as InvitableRole)}>
                <SelectTrigger id="invitation-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">Vous ne pouvez pas donner plus de droits que les vôtres.</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Annuler
              </Button>
              <Button type="submit" loading={submitting} disabled={!email.trim()}>
                <Mail aria-hidden />
                Envoyer l&apos;invitation
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <LinkDialog link={link} onClose={() => setLink(null)} />
    </>
  )
}

/** Pending invitations of the company, with "Renvoyer" and "Annuler". */
export function InvitationsCard({ companyId, refreshKey }: { companyId: string; refreshKey: number }) {
  const [invitations, setInvitations] = useState<Invitation[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [link, setLink] = useState<{ email: string; url: string } | null>(null)
  const { confirm, dialog: confirmDialog } = useConfirm()

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/companies/${companyId}/invitations`)
      if (!response.ok) throw new Error(await errorOf(response, "Les invitations n'ont pas pu être chargées."))
      setInvitations(((await response.json()) as { invitations: Invitation[] }).invitations)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Les invitations n'ont pas pu être chargées.")
      setInvitations([])
    }
  }, [companyId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  async function resend(invitation: Invitation) {
    setBusy(invitation.id)
    try {
      const response = await fetch(`/api/companies/${companyId}/invitations/${invitation.id}/resend`, { method: 'POST' })
      if (!response.ok) {
        toast.error(await errorOf(response, "L'invitation n'a pas pu être renvoyée."))
        return
      }
      const data = (await response.json()) as { link?: string }
      if (data.link) setLink({ email: invitation.email, url: data.link })
      else toast.success(`Invitation renvoyée à ${invitation.email}`)
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function revoke(invitation: Invitation) {
    const ok = await confirm({
      title: `Annuler l'invitation de ${invitation.email} ?`,
      description: "Le lien envoyé ne fonctionnera plus. Vous pourrez inviter cette personne de nouveau.",
      confirmLabel: "Annuler l'invitation",
    })
    if (!ok) return
    setBusy(invitation.id)
    try {
      const response = await fetch(`/api/companies/${companyId}/invitations/${invitation.id}`, { method: 'DELETE' })
      if (!response.ok) {
        toast.error(await errorOf(response, "L'invitation n'a pas pu être annulée."))
        return
      }
      toast.success('Invitation annulée')
      await load()
    } finally {
      setBusy(null)
    }
  }

  if (!invitations || invitations.length === 0) return confirmDialog

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Invitations en attente <span className="text-muted-foreground num font-normal">{invitations.length}</span>
        </CardTitle>
        <CardDescription>
          Une invitation est valable 7 jours. La renvoyer envoie un nouveau lien&nbsp;; l&apos;ancien ne fonctionne plus.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Email</TableHead>
              <TableHead>Rôle</TableHead>
              <TableHead>Validité</TableHead>
              <TableHead className="pr-5">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.map((invitation) => (
              <TableRow key={invitation.id}>
                <TableCell className="pl-5">
                  <div className="font-medium break-all">{invitation.email}</div>
                  {invitation.invitedBy ? (
                    <div className="text-muted-foreground text-xs">
                      Invité·e par {invitation.invitedBy.name ?? invitation.invitedBy.email}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{ROLE_LABELS[invitation.role] ?? invitation.role}</Badge>
                </TableCell>
                <TableCell className="text-sm">
                  {invitation.expired ? (
                    <Badge variant="outline">Expirée</Badge>
                  ) : (
                    <>Jusqu&apos;au {formatDisplayDate(invitation.expiresAt)}</>
                  )}
                </TableCell>
                <TableCell className="pr-5 text-right whitespace-nowrap">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => resend(invitation)}
                    disabled={busy === invitation.id}
                    aria-label={`Renvoyer l'invitation de ${invitation.email}`}
                    title="Renvoyer avec un nouveau lien"
                  >
                    <RotateCw aria-hidden />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => revoke(invitation)}
                    disabled={busy === invitation.id}
                    aria-label={`Annuler l'invitation de ${invitation.email}`}
                    title="Annuler l'invitation"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X aria-hidden />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <LinkDialog link={link} onClose={() => setLink(null)} />
      {confirmDialog}
    </Card>
  )
}
