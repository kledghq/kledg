'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/shared'
import { BANK_TRADEMARKS_NOTICE, QONTO_API_KEY_HELP_URL } from '@/lib/banking/links'
import { BankProviderLogo } from './bank-provider-logo'
import { responseError } from './types'

const connectSchema = z.object({
  login: z.string().trim().min(1, "Collez l'identifiant de l'organisation Qonto."),
  secretKey: z.string().trim().min(1, 'Collez la clé secrète.'),
})
/** Editing: an empty secret keeps the stored one. */
const updateSchema = connectSchema.extend({ secretKey: z.string().trim() })
type FormValues = z.infer<typeof connectSchema>

interface QontoConnectDialogProps {
  companyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected: () => void
  /** Integration of an existing Qonto connection: the dialog updates its API key instead of connecting. */
  integrationId?: string
}

/**
 * Qonto direct connection: the organization's API key (login and secret
 * key), checked, stored encrypted, then a first sync. With `integrationId`,
 * replaces the key of the existing connection (checked by the server
 * before it is stored), then syncs again.
 */
export function QontoConnectDialog({ companyId, open, onOpenChange, onConnected, integrationId }: QontoConnectDialogProps) {
  const editing = Boolean(integrationId)
  const form = useForm<FormValues>({
    resolver: zodResolver(editing ? updateSchema : connectSchema),
    defaultValues: { login: '', secretKey: '' },
  })
  const { errors, isSubmitting } = form.formState
  const [secretHint, setSecretHint] = useState<string | null>(null)

  // Editing: the current login and a masked hint of the secret, never the secret itself
  useEffect(() => {
    if (!open || !integrationId) return
    let cancelled = false
    void (async () => {
      const response = await fetch(`/api/integrations/${integrationId}/credentials`).catch(() => null)
      if (!response?.ok || cancelled) return
      const { credentials } = (await response.json()) as { credentials: { login: string | null; secretKeyMasked: string | null } }
      form.reset({ login: credentials.login ?? '', secretKey: '' })
      setSecretHint(credentials.secretKeyMasked)
    })()
    return () => {
      cancelled = true
    }
  }, [open, integrationId, form])

  const syncAfter = async (id: string, success: string, failure: string) => {
    const sync = await fetch(`/api/integrations/${id}/sync`, { method: 'POST' })
    if (sync.ok) toast.success(success)
    else toast.warning(failure)
  }

  const update = async (values: FormValues) => {
    const response = await fetch(`/api/integrations/${integrationId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentials: { login: values.login, secretKey: values.secretKey } }),
    })
    if (!response.ok) {
      const message = await responseError(response, "La clé API n'a pas pu être enregistrée. Réessayez.")
      if (response.status === 400) form.setError('secretKey', { message })
      else toast.error(message)
      return
    }
    await syncAfter(integrationId!, 'Clé API Qonto mise à jour\u00a0: la synchronisation reprend.', 'Clé API Qonto mise à jour. La synchronisation a échoué\u00a0: relancez-la depuis la page des comptes.')
    form.reset({ login: values.login, secretKey: '' })
    onConnected()
  }

  const connect = async (values: FormValues) => {
    const credentials = { login: values.login, secretKey: values.secretKey }
    const verify = await fetch('/api/integrations/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId, provider: 'QONTO', credentials }),
    })
    if (!verify.ok) {
      form.setError('secretKey', { message: "Qonto refuse ces identifiants\u00a0: vérifiez l'identifiant et la clé secrète." })
      return
    }
    const created = await fetch('/api/integrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId,
        provider: 'QONTO',
        type: 'BANKING',
        name: 'Qonto',
        credentials,
        features: ['BANKING_ACCOUNTS', 'BANKING_TRANSACTIONS'],
      }),
    })
    if (!created.ok) {
      toast.error(await responseError(created, "La connexion n'a pas pu être enregistrée. Réessayez."))
      return
    }
    const { integration } = (await created.json()) as { integration: { id: string } }
    await syncAfter(integration.id, 'Qonto connecté\u00a0: vos comptes et opérations arrivent.', 'Qonto connecté. La première synchronisation a échoué\u00a0: relancez-la depuis la page des comptes.')
    form.reset()
    onConnected()
  }

  const submit = form.handleSubmit(editing ? update : connect)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {editing ? 'Mettre à jour la clé API' : 'Connecter'} <BankProviderLogo provider="QONTO" />
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "Collez la nouvelle clé API de votre organisation Qonto, par exemple après l'avoir régénérée. Kledg la vérifie auprès de Qonto avant de l'enregistrer."
              : 'Connexion directe et gratuite avec la clé API de votre organisation Qonto (Paramètres, Intégrations et partenaires, Clé API).'}{' '}
            <a href={QONTO_API_KEY_HELP_URL} target="_blank" rel="noreferrer" className="text-link inline-flex items-center gap-1 underline-offset-4 hover:underline">
              Où la trouver
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          </DialogDescription>
        </DialogHeader>
        <form id="qonto-connect-form" onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Identifiant" required error={errors.login?.message}>
            <Input autoComplete="off" placeholder="ex. mon-entreprise-1234" {...form.register('login')} />
          </Field>
          <Field
            label="Clé secrète"
            required={!editing}
            error={errors.secretKey?.message}
            hint={
              editing && secretHint
                ? `Laissez vide pour garder la clé actuelle (${secretHint}). Chiffrée sur votre instance, elle n'est jamais réaffichée.`
                : "Chiffrée sur votre instance, elle n'est jamais réaffichée."
            }
          >
            <Input type="password" autoComplete="off" {...form.register('secretKey')} />
          </Field>
        </form>
        <p className="text-muted-foreground text-xs">{BANK_TRADEMARKS_NOTICE}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Annuler
          </Button>
          <Button type="submit" form="qonto-connect-form" loading={isSubmitting}>
            {editing ? 'Enregistrer la clé' : 'Connecter Qonto'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
