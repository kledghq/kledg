'use client'

import { useRouter } from 'next/navigation'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { authClient } from '@/lib/auth-client'
import { UpdateProfileSchema, type UpdateProfileInput } from '@/lib/account/schemas'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/shared'
import { displayName, initials } from '@/components/layout/initials'
import { accountApi } from './account-api'

/** The user's name, with the initials avatar it produces. */
export function ProfileNameCard({ name, email }: { name: string; email: string }) {
  const router = useRouter()
  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(UpdateProfileSchema),
    defaultValues: { name },
  })
  const { errors, isSubmitting, isDirty } = form.formState
  const preview = displayName({ name: useWatch({ control: form.control, name: 'name' }), email })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await accountApi<{ name: string }>('/api/account/profile', { method: 'PATCH', body: values })
      form.reset({ name: saved.name })
      // The account menu reads the session: refresh it with the new name.
      authClient.$store.notify('$sessionSignal')
      router.refresh()
      toast.success('Nom enregistré')
    } catch (error) {
      toast.error((error as Error).message)
    }
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Identité</CardTitle>
        <CardDescription>
          Votre nom apparaît dans le menu du compte et dans la liste des membres de vos sociétés.
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar className="size-10 rounded-md">
              <AvatarFallback className="rounded-md text-sm font-medium">{initials(preview)}</AvatarFallback>
            </Avatar>
            <p className="text-muted-foreground text-xs">Votre avatar est formé des initiales de votre nom.</p>
          </div>
          <Field label="Nom" error={errors.name?.message} required>
            <Input autoComplete="name" placeholder="ex. Marie Dupont" {...form.register('name')} />
          </Field>
        </CardContent>
        <CardFooter className="pt-5">
          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
            Enregistrer le nom
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
