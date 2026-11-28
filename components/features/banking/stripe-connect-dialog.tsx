'use client'

import { useEffect, useId, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Field } from '@/components/shared'
import { BANK_TRADEMARKS_NOTICE, STRIPE_API_KEYS_URL } from '@/lib/banking/links'
import { docsUrl } from '@/lib/docs-links'
import { BankProviderLogo } from './bank-provider-logo'
import { responseError } from './types'

type BalanceAccount = '517' | '467'

const BALANCE_ACCOUNTS: Array<{ value: BalanceAccount; label: string; description: string }> = [
  {
    value: '517',
    label: '517 Autres organismes financiers (recommandé)',
    description: 'Le solde Stripe est de la trésorerie, comme un compte bancaire. Kledg crée le compte 517100 Stripe.',
  },
  {
    value: '467',
    label: '467 Divers comptes débiteurs',
    description: 'Le solde Stripe est une créance sur Stripe, hors trésorerie. Kledg crée le compte 467100 Stripe.',
  },
]

/** A restricted key: rk_live_ (or rk_test_ for a trial with test data). */
const RESTRICTED_KEY = /^rk_(live|test)_[A-Za-z0-9]{10,}$/

interface StripeConnectDialogProps {
  companyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected: () => void
  /** Integration of an existing Stripe connection: the dialog replaces its key instead of connecting. */
  integrationId?: string
}

interface SetupOutcome {
  ledgerAccountCode: string | null
  rules: { added: string[]; kept: Array<{ template: string; rule: string }> }
}

/**
 * Stripe connection with a restricted API key, read only: the balance is
 * an account of its own (517100 Stripe by default), its lines are the
 * balance transactions, booked by the Stripe rules Kledg adds. With
 * `integrationId`, replaces the key of the existing connection.
 */
export function StripeConnectDialog({ companyId, open, onOpenChange, onConnected, integrationId }: StripeConnectDialogProps) {
  const editing = Boolean(integrationId)
  const id = useId()
  const [secretKey, setSecretKey] = useState('')
  const [balanceAccount, setBalanceAccount] = useState<BalanceAccount>('517')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [secretHint, setSecretHint] = useState<string | null>(null)

  // Closing clears the form, so the next opening starts empty
  const changeOpen = (next: boolean) => {
    if (!next) {
      setSecretKey('')
      setError(null)
    }
    onOpenChange(next)
  }

  useEffect(() => {
    if (!open || !integrationId) return
    let cancelled = false
    void (async () => {
      const response = await fetch(`/api/integrations/${integrationId}/credentials`).catch(() => null)
      if (!response?.ok || cancelled) return
      const { credentials } = (await response.json()) as { credentials: { secretKeyMasked: string | null } }
      setSecretHint(credentials.secretKeyMasked)
    })()
    return () => {
      cancelled = true
    }
  }, [open, integrationId])

  const syncAfter = async (integration: string, success: string, failure: string) => {
    const sync = await fetch(`/api/integrations/${integration}/sync`, { method: 'POST' })
    if (sync.ok) toast.success(success)
    else toast.warning(failure)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const key = secretKey.trim()
    if (!RESTRICTED_KEY.test(key)) {
      setError('Collez une clé restreinte Stripe : elle commence par rk_live_ (pas sk_live_, la clé secrète du compte).')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      if (editing) {
        const response = await fetch(`/api/integrations/${integrationId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credentials: { secretKey: key } }),
        })
        if (!response.ok) {
          setError(await responseError(response, "La clé n'a pas pu être enregistrée. Réessayez."))
          return
        }
        await syncAfter(integrationId!, 'Clé Stripe mise à jour : la synchronisation reprend.', 'Clé Stripe mise à jour. La synchronisation a échoué : relancez-la depuis la page des comptes.')
        setSecretKey('')
        onConnected()
        return
      }

      const credentials = { secretKey: key }
      const verify = await fetch('/api/integrations/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, provider: 'STRIPE', credentials }),
      })
      const verdict = verify.ok ? ((await verify.json()) as { valid: boolean; error?: string }) : null
      if (!verdict?.valid) {
        setError(verdict?.error ?? 'Stripe refuse cette clé : vérifiez-la dans le Dashboard Stripe.')
        return
      }
      const created = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          provider: 'STRIPE',
          type: 'BANKING',
          name: 'Stripe',
          credentials,
          features: ['BANKING_ACCOUNTS', 'BANKING_TRANSACTIONS'],
          config: { balanceAccount },
        }),
      })
      if (!created.ok) {
        toast.error(await responseError(created, "La connexion n'a pas pu être enregistrée. Réessayez."))
        return
      }
      const { integration, stripe } = (await created.json()) as { integration: { id: string }; stripe?: SetupOutcome }
      for (const kept of stripe?.rules.kept ?? []) {
        if (kept.template.startsWith('Virements Stripe reçus')) {
          toast.warning(
            `Votre règle « ${kept.rule} » passe déjà les virements de Stripe reçus en banque : avec le compte Stripe connecté, ils vont en 58 « Virements internes ». Changez son compte, sinon chaque virement est passé deux fois, en 58 côté Stripe et en 467 côté banque.`,
          )
        }
      }
      await syncAfter(integration.id, 'Stripe connecté : vos paiements, frais et virements arrivent.', 'Stripe connecté. La première synchronisation a échoué : relancez-la depuis la page des comptes.')
      setSecretKey('')
      onConnected()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {editing ? 'Mettre à jour la clé' : 'Connecter'} <BankProviderLogo provider="STRIPE" withLabel />
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "Collez la nouvelle clé restreinte, par exemple après l'avoir renouvelée. Kledg la vérifie auprès de Stripe avant de l'enregistrer."
              : 'Kledg lit le solde Stripe et son historique avec une clé restreinte en lecture seule : dans le Dashboard Stripe, Développeurs, Clés API, créez une clé limitée avec l’accès en lecture au solde (Balance).'}{' '}
            <a href={STRIPE_API_KEYS_URL} target="_blank" rel="noreferrer" className="text-link inline-flex items-center gap-1 underline-offset-4 hover:underline">
              Clés API Stripe
              <ExternalLink aria-hidden className="size-3.5" />
            </a>{' '}
            <a href={docsUrl('stripe')} target="_blank" rel="noreferrer" className="text-link inline-flex items-center gap-1 underline-offset-4 hover:underline">
              Guide pas à pas
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          </DialogDescription>
        </DialogHeader>
        <form id="stripe-connect-form" onSubmit={submit} className="space-y-4" noValidate>
          <Field
            label="Clé restreinte"
            required
            error={error ?? undefined}
            hint={
              editing && secretHint
                ? `Clé actuelle : ${secretHint}. Chiffrée sur votre instance, elle n'est jamais réaffichée.`
                : "Commence par rk_live_. Chiffrée sur votre instance, elle n'est jamais réaffichée."
            }
          >
            <Input type="password" autoComplete="off" placeholder="rk_live_…" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} />
          </Field>
          {editing ? null : (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Compte du solde Stripe</legend>
              <RadioGroup value={balanceAccount} onValueChange={(next) => setBalanceAccount(next as BalanceAccount)} className="gap-2">
                {BALANCE_ACCOUNTS.map((option) => (
                  <div key={option.value} className="flex items-start gap-2 pointer-coarse:items-center">
                    <RadioGroupItem value={option.value} id={`${id}-${option.value}`} className="mt-0.5 pointer-coarse:mt-0" />
                    <Label htmlFor={`${id}-${option.value}`} className="flex-1 flex-col items-start gap-0.5 font-normal leading-snug">
                      <span>{option.label}</span>
                      <span className="text-muted-foreground text-xs">{option.description}</span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>
          )}
          {editing ? null : (
            <p className="text-muted-foreground text-xs">
              Kledg ajoute aussi les règles Stripe : paiements en ventes (706, TVA 20 %), commissions (6278), frais des logiciels Stripe (6278, TVA autoliquidée), virements vers la banque (58). Modifiez-les dans Règles.
            </p>
          )}
        </form>
        <p className="text-muted-foreground text-xs">{BANK_TRADEMARKS_NOTICE}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => changeOpen(false)} disabled={submitting}>
            Annuler
          </Button>
          <Button type="submit" form="stripe-connect-form" loading={submitting}>
            {editing ? 'Enregistrer la clé' : 'Connecter Stripe'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
