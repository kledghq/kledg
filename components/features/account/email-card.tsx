'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { MailCheck } from 'lucide-react'
import { toast } from 'sonner'
import { authClient } from '@/lib/auth-client'
import { ChangeEmailSchema, type ChangeEmailInput } from '@/lib/account/schemas'
import type { EmailChangeMode } from '@/lib/account/change-email.service'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/shared'
import { accountApi } from './account-api'
import { ActionNotice } from './action-notice'

const DESCRIPTIONS: Record<EmailChangeMode['kind'], string> = {
  verify:
    "Vous vous connectez avec cette adresse. Pour la changer, nous envoyons un lien à la nouvelle adresse\u00a0: elle ne remplace l'actuelle qu'une fois ce lien ouvert.",
  direct:
    "L'envoi d'emails n'est pas configuré sur cette instance. En tant qu'administrateur, vous pouvez changer votre adresse directement\u00a0: vérifiez-la bien, aucun lien de confirmation ne sera envoyé.",
  unavailable: 'Vous vous connectez avec cette adresse.',
  refused: 'Vous vous connectez avec cette adresse.',
}

/** The sign-in address and its change (confirmed by a link sent to the new address). */
export function EmailCard({ email, mode }: { email: string; mode: EmailChangeMode }) {
  const router = useRouter()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const disabled = mode.kind === 'refused' || mode.kind === 'unavailable'
  const form = useForm<ChangeEmailInput>({
    resolver: zodResolver(ChangeEmailSchema),
    defaultValues: { newEmail: '', password: '' },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const result = await accountApi<{ status: 'verification-sent' | 'updated' }>('/api/account/email', {
        method: 'POST',
        body: values,
      })
      form.reset()
      if (result.status === 'updated') {
        authClient.$store.notify('$sessionSignal')
        router.refresh()
        toast.success('Adresse email modifiée')
      } else {
        setSentTo(values.newEmail)
      }
    } catch (error) {
      toast.error((error as Error).message)
    }
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Adresse email</CardTitle>
        <CardDescription>{DESCRIPTIONS[mode.kind]}</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="space-y-4">
          <Field label="Adresse actuelle">
            <Input value={email} readOnly disabled />
          </Field>
          {mode.kind === 'refused' || mode.kind === 'unavailable' ? (
            <ActionNotice kind={mode.kind === 'refused' ? 'refused' : 'blocked'}>{mode.message}</ActionNotice>
          ) : null}
          {sentTo ? (
            <Alert>
              <MailCheck aria-hidden />
              <AlertTitle>Lien envoyé à {sentTo}</AlertTitle>
              <AlertDescription>
                Ouvrez-le pour confirmer la nouvelle adresse (il est valable une heure). Un avis a aussi été envoyé à
                votre adresse actuelle.
              </AlertDescription>
            </Alert>
          ) : null}
          <Field label="Nouvelle adresse" error={errors.newEmail?.message} required>
            <Input
              type="email"
              autoComplete="email"
              placeholder="ex. marie@societe.fr"
              disabled={disabled}
              {...form.register('newEmail')}
            />
          </Field>
          <Field
            label="Mot de passe"
            hint="Pour confirmer que c'est bien vous."
            error={errors.password?.message}
            required
          >
            <Input type="password" autoComplete="current-password" disabled={disabled} {...form.register('password')} />
          </Field>
        </CardContent>
        <CardFooter className="pt-5">
          <Button type="submit" loading={isSubmitting} disabled={disabled}>
            {mode.kind === 'direct' ? "Changer l'adresse" : 'Envoyer le lien de confirmation'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
