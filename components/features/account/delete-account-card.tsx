'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { DeleteAccountSchema, type DeleteAccountInput } from '@/lib/account/schemas'
import type { AccountOverview } from '@/lib/account/account-overview'
import { ROLE_LABELS } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field } from '@/components/shared'
import { accountApi } from './account-api'
import { ActionNotice } from './action-notice'

/** Danger zone: deletion of the user's own account, confirmed by typing its email and the password. */
export function DeleteAccountCard({ email, deletion }: { email: string; deletion: AccountOverview['deletion'] }) {
  const [open, setOpen] = useState(false)
  const blocked = deletion.blockers.length > 0
  const disabled = !deletion.allowed || blocked

  return (
    <Card id="supprimer" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>Supprimer mon compte</CardTitle>
        <CardDescription>
          Votre compte, vos sessions, vos clés API et vos connexions IA sont supprimés définitivement. Vos sociétés et
          leur comptabilité sont conservées&nbsp;: leurs autres membres y gardent accès.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!deletion.allowed ? <ActionNotice>{deletion.message}</ActionNotice> : null}
        {deletion.allowed && blocked ? (
          <ActionNotice kind="blocked">{deletion.blockers.join(' ')}</ActionNotice>
        ) : null}
        {deletion.companies.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm">
              Vous perdrez l&apos;accès {deletion.companies.length > 1 ? 'à ces sociétés' : 'à cette société'} :
            </p>
            <ul className="divide-y rounded-md border text-sm">
              {deletion.companies.map((company) => (
                <li key={company.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="truncate">{company.name}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {company.roles.map((role) => ROLE_LABELS[role] ?? role).join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Vous n&apos;êtes membre d&apos;aucune société.</p>
        )}
      </CardContent>
      <CardFooter className="pt-5">
        <Button variant="outline" className="text-destructive" disabled={disabled} onClick={() => setOpen(true)}>
          Supprimer mon compte
        </Button>
      </CardFooter>
      <DeleteAccountDialog open={open} onOpenChange={setOpen} email={email} />
    </Card>
  )
}

function DeleteAccountDialog({
  open,
  onOpenChange,
  email,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  email: string
}) {
  const router = useRouter()
  const form = useForm<DeleteAccountInput>({
    resolver: zodResolver(DeleteAccountSchema),
    defaultValues: { email: '', password: '' },
  })
  const { errors, isSubmitting } = form.formState
  const typed = useWatch({ control: form.control, name: 'email' })
  const matches = typed.trim().toLowerCase() === email.toLowerCase()

  const setOpen = (next: boolean) => {
    if (isSubmitting) return
    if (!next) form.reset()
    onOpenChange(next)
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await accountApi('/api/account', { method: 'DELETE', body: values })
      toast.success('Compte supprimé')
      // The session cookie is gone: leave the application.
      router.replace('/login')
      router.refresh()
    } catch (error) {
      toast.error((error as Error).message)
    }
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supprimer votre compte&nbsp;?</DialogTitle>
          <DialogDescription>
            Cette action est définitive. Vous serez déconnecté et ne pourrez plus vous connecter avec {email}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <Field label="Saisissez votre adresse email pour confirmer" error={errors.email?.message} required>
            <Input type="email" autoComplete="off" placeholder={email} {...form.register('email')} />
          </Field>
          <Field label="Mot de passe" error={errors.password?.message} required>
            <Input type="password" autoComplete="current-password" {...form.register('password')} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" variant="destructive" loading={isSubmitting} disabled={!matches}>
              Supprimer mon compte
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
