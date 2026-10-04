'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/shared'

/** Same minimum as the server (emailAndPassword.minPasswordLength in lib/auth.ts). */
const MIN_PASSWORD_LENGTH = 10

const schema = z
  .object({
    email: z.string().trim().email('Adresse email invalide'),
    password: z.string().min(MIN_PASSWORD_LENGTH, `Au moins ${MIN_PASSWORD_LENGTH} caractères`),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Les mots de passe ne correspondent pas',
  })

type Values = z.infer<typeof schema>

/** Instance administrators create accounts for their team (no public sign-up). */
export function CreateUserForm() {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', confirmPassword: '' },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async ({ email, password }) => {
    const response = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).catch(() => null)
    if (!response?.ok) {
      const data = (await response?.json().catch(() => ({}))) as { error?: string } | undefined
      toast.error(data?.error ?? "Le compte n'a pas pu être créé. Vérifiez votre connexion et réessayez.")
      return
    }
    form.reset()
    toast.success(`Compte ${email} créé`, {
      description: 'Ajoutez-le maintenant à une société depuis sa page Membres.',
    })
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nouveau compte</CardTitle>
        <CardDescription>
          Créez un compte pour un membre de votre équipe, puis ajoutez-le à une société depuis la page Membres de
          cette société.
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="space-y-4">
          <Field label="Email" error={errors.email?.message} required>
            <Input type="email" autoComplete="off" placeholder="ex. collegue@societe.fr" {...form.register('email')} />
          </Field>
          <Field
            label="Mot de passe"
            hint={`Au moins ${MIN_PASSWORD_LENGTH} caractères. Communiquez-le à la personne, qui pourra le changer.`}
            error={errors.password?.message}
            required
          >
            <Input type="password" autoComplete="new-password" {...form.register('password')} />
          </Field>
          <Field label="Confirmer le mot de passe" error={errors.confirmPassword?.message} required>
            <Input type="password" autoComplete="new-password" {...form.register('confirmPassword')} />
          </Field>
        </CardContent>
        <CardFooter className="pt-5">
          <Button type="submit" loading={isSubmitting}>
            Créer le compte
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
