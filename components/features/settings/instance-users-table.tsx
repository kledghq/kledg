'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Ban, Mail, MoreHorizontal, ShieldCheck, ShieldOff, Trash2, UserCheck } from 'lucide-react'
import { toast } from 'sonner'
import type { InstanceUser } from '@/lib/users/instance-users.service'
import { ChangeUserEmailSchema, INSTANCE_ROLE_LABELS, type ChangeUserEmailInput } from '@/lib/users/schemas'
import { accountApi } from '@/components/features/account/account-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DateDisplay, Field, StatusBadge, useConfirm } from '@/components/shared'

interface Props {
  users: InstanceUser[]
  currentUserId: string
  /** False when the instance policy refuses "manage-users": actions stay visible, disabled. */
  canManage: boolean
}

/** Accounts of the instance with their role and status, and the actions of an administrator on each. */
export function InstanceUsersTable({ users, currentUserId, canManage }: Props) {
  const router = useRouter()
  const { confirm, dialog } = useConfirm()
  const [busy, setBusy] = useState<string | null>(null)
  const [emailFor, setEmailFor] = useState<InstanceUser | null>(null)

  const run = async (user: InstanceUser, call: () => Promise<unknown>, success: string) => {
    setBusy(user.id)
    try {
      await call()
      toast.success(success)
      router.refresh()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const patch = (user: InstanceUser, body: Record<string, unknown>) =>
    accountApi(`/api/users/${encodeURIComponent(user.id)}`, { method: 'PATCH', body })

  const toggleAdmin = async (user: InstanceUser) => {
    const promote = user.role !== 'admin'
    const ok = await confirm({
      title: promote ? `Nommer ${user.email} administrateur de l'instance ?` : `Retirer le rôle administrateur à ${user.email} ?`,
      description: promote
        ? "Il pourra créer et gérer les comptes, toutes les sociétés et les mises à jour de l'instance."
        : "Il gardera l'accès aux sociétés dont il est membre, avec ses rôles dans chacune.",
      confirmLabel: promote ? 'Nommer administrateur' : 'Retirer le rôle',
      tone: promote ? 'default' : 'destructive',
    })
    if (!ok) return
    await run(
      user,
      () => patch(user, { action: 'set-role', role: promote ? 'admin' : 'user' }),
      promote ? `${user.email} est administrateur de l'instance` : `${user.email} n'est plus administrateur`,
    )
  }

  const toggleBan = async (user: InstanceUser) => {
    if (user.banned) {
      await run(user, () => patch(user, { action: 'unban' }), `${user.email} est débloqué`)
      return
    }
    const ok = await confirm({
      title: `Bloquer ${user.email} ?`,
      description:
        "Ses sessions sont fermées\u00a0: il ne peut plus se connecter et ses clés API sont refusées jusqu'à ce que vous le débloquiez. Ses données sont conservées.",
      confirmLabel: 'Bloquer',
    })
    if (!ok) return
    await run(user, () => patch(user, { action: 'ban' }), `${user.email} est bloqué`)
  }

  const remove = async (user: InstanceUser) => {
    const ok = await confirm({
      title: `Supprimer le compte ${user.email} ?`,
      description:
        'Le compte, ses sessions et ses clés API sont supprimés définitivement. Les sociétés et leur comptabilité sont conservées\u00a0: il perd seulement leur accès.',
      confirmLabel: 'Supprimer',
    })
    if (!ok) return
    await run(
      user,
      () => accountApi(`/api/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' }),
      `Compte ${user.email} supprimé`,
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comptes</CardTitle>
        <CardDescription>
          Les personnes qui peuvent se connecter à cette instance. Leurs accès aux sociétés se gèrent depuis la page
          Membres de chaque société.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Compte</TableHead>
              <TableHead>Rôle</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Créé le</TableHead>
              <TableHead>Dernière session</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableEmpty colSpan={6}>Aucun compte ne correspond à cette recherche.</TableEmpty>
            ) : (
              users.map((user) => {
                const self = user.id === currentUserId
                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="font-medium">
                        {user.email}
                        {self ? <span className="text-muted-foreground font-normal"> (vous)</span> : null}
                      </div>
                      {user.name ? <div className="text-muted-foreground text-xs">{user.name}</div> : null}
                    </TableCell>
                    <TableCell>{INSTANCE_ROLE_LABELS[user.role]}</TableCell>
                    <TableCell>
                      {user.banned ? (
                        <StatusBadge tone="danger">Bloqué</StatusBadge>
                      ) : (
                        <StatusBadge tone="success">Actif</StatusBadge>
                      )}
                    </TableCell>
                    <TableCell>
                      <DateDisplay value={user.createdAt} />
                    </TableCell>
                    <TableCell>
                      <DateDisplay value={user.lastSessionAt} format="datetime" empty="Aucune" />
                    </TableCell>
                    <TableCell className="text-right">
                      {self ? null : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Actions pour ${user.email}`}
                              title="Actions"
                              disabled={!canManage || busy !== null}
                              loading={busy === user.id}
                            >
                              <MoreHorizontal aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => void toggleAdmin(user)}>
                              {user.role === 'admin' ? <ShieldOff aria-hidden /> : <ShieldCheck aria-hidden />}
                              {user.role === 'admin' ? 'Retirer le rôle administrateur' : 'Nommer administrateur'}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setEmailFor(user)}>
                              <Mail aria-hidden />
                              Changer l&apos;adresse email
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void toggleBan(user)}>
                              {user.banned ? <UserCheck aria-hidden /> : <Ban aria-hidden />}
                              {user.banned ? 'Débloquer' : 'Bloquer'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => void remove(user)}>
                              <Trash2 aria-hidden />
                              Supprimer le compte
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
      <ChangeEmailDialog
        user={emailFor}
        onClose={() => setEmailFor(null)}
        onChanged={() => {
          setEmailFor(null)
          router.refresh()
        }}
      />
      {dialog}
    </Card>
  )
}

/** New sign-in address of another account, confirmed by the administrator's own password. */
function ChangeEmailDialog({
  user,
  onClose,
  onChanged,
}: {
  user: InstanceUser | null
  onClose: () => void
  onChanged: () => void
}) {
  const form = useForm<ChangeUserEmailInput>({
    resolver: zodResolver(ChangeUserEmailSchema),
    defaultValues: { email: '', password: '' },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    if (!user) return
    try {
      await accountApi(`/api/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        body: { action: 'change-email', ...values },
      })
      toast.success(`Adresse de connexion changée en ${values.email}`)
      form.reset()
      onChanged()
    } catch (error) {
      toast.error((error as Error).message)
    }
  })

  return (
    <Dialog
      open={user !== null}
      onOpenChange={(open) => {
        if (!open && !isSubmitting) {
          form.reset()
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Changer l&apos;adresse de {user?.email}</DialogTitle>
          <DialogDescription>
            La personne se connectera avec la nouvelle adresse. Aucun lien de confirmation n&apos;est envoyé&nbsp;: vérifiez-la
            bien.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <Field label="Nouvelle adresse email" error={errors.email?.message} required>
            <Input type="email" autoComplete="off" placeholder="ex. collegue@societe.fr" {...form.register('email')} />
          </Field>
          <Field label="Votre mot de passe" hint="Pour confirmer que c'est bien vous." error={errors.password?.message} required>
            <Input type="password" autoComplete="current-password" {...form.register('password')} />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => {
                form.reset()
                onClose()
              }}
            >
              Annuler
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Changer l&apos;adresse
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
