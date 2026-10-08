'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { ChangePasswordSchema, MIN_PASSWORD_LENGTH } from '@/lib/account/schemas'
import type { ActionState } from '@/lib/account/account-overview'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/shared'
import { accountApi } from './account-api'
import { ActionNotice } from './action-notice'

const schema = ChangePasswordSchema.extend({ confirmPassword: z.string() }).refine(
  (v) => v.newPassword === v.confirmPassword,
  { path: ['confirmPassword'], message: 'Les mots de passe ne correspondent pas' },
)

type Values = z.infer<typeof schema>

/** Changes the signed-in user's password (the current one is required). */
export function PasswordCard({ state, onOtherSessionsRevoked }: { state: ActionState; onOtherSessionsRevoked?: () => void }) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '', revokeOtherSessions: true },
  })
  const { errors, isSubmitting } = form.formState
  const disabled = !state.allowed

  const onSubmit = form.handleSubmit(async ({ currentPassword, newPassword, revokeOtherSessions }) => {
    try {
      await accountApi('/api/account/password', {
        method: 'POST',
        body: { currentPassword, newPassword, revokeOtherSessions },
      })
      form.reset()
      toast.success(revokeOtherSessions ? 'Mot de passe modifié, autres sessions déconnectées' : 'Mot de passe modifié')
      if (revokeOtherSessions) onOtherSessionsRevoked?.()
    } catch (error) {
      toast.error((error as Error).message)
    }
  })

  return (
    <Card id="mot-de-passe" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>Mot de passe</CardTitle>
        <CardDescription>
          Saisissez votre mot de passe actuel, puis le nouveau. Il servira dès votre prochaine connexion. Vos clés
          API sont supprimées et vos assistants IA déconnectés&nbsp;: recréez ou reconnectez ceux que vous utilisez.
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="space-y-4">
          {!state.allowed ? <ActionNotice>{state.message}</ActionNotice> : null}
          <Field label="Mot de passe actuel" error={errors.currentPassword?.message} required>
            <Input
              type="password"
              autoComplete="current-password"
              disabled={disabled}
              {...form.register('currentPassword')}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Nouveau mot de passe"
              hint={`Au moins ${MIN_PASSWORD_LENGTH} caractères.`}
              error={errors.newPassword?.message}
              required
            >
              <Input type="password" autoComplete="new-password" disabled={disabled} {...form.register('newPassword')} />
            </Field>
            <Field label="Confirmer le nouveau mot de passe" error={errors.confirmPassword?.message} required>
              <Input
                type="password"
                autoComplete="new-password"
                disabled={disabled}
                {...form.register('confirmPassword')}
              />
            </Field>
          </div>
          <div className="flex items-start gap-2">
            <Controller
              control={form.control}
              name="revokeOtherSessions"
              render={({ field }) => (
                <Checkbox
                  id="revoke-other-sessions"
                  className="mt-0.5"
                  checked={field.value === true}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  disabled={disabled}
                />
              )}
            />
            <Label htmlFor="revoke-other-sessions" className="text-sm leading-snug font-normal">
              Déconnecter mes autres sessions (les autres navigateurs et appareils devront se reconnecter)
            </Label>
          </div>
        </CardContent>
        <CardFooter className="pt-5">
          <Button type="submit" loading={isSubmitting} disabled={disabled}>
            Changer le mot de passe
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
