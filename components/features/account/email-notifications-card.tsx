'use client'

import * as React from 'react'
import { toast } from 'sonner'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { responseError } from '@/hooks/use-cursor-list'

/**
 * The user's own emails (Paramètres, Profil): the weekly email of the
 * receipts still missing (lib/receipts/digest), on by default.
 */
export function EmailNotificationsCard({ initial }: { initial: { receiptDigest: boolean } }) {
  const [receiptDigest, setReceiptDigest] = React.useState(initial.receiptDigest)
  const [busy, setBusy] = React.useState(false)

  async function change(next: boolean) {
    setBusy(true)
    setReceiptDigest(next)
    try {
      const response = await fetch('/api/account/notifications', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ receiptDigest: next }) })
      if (!response.ok) throw new Error(await responseError(response, 'Le réglage n’a pas pu être enregistré. Réessayez.'))
      toast.success(next ? 'Vous recevrez le récapitulatif chaque lundi.' : 'Vous ne recevrez plus le récapitulatif.')
    } catch (error) {
      setReceiptDigest(!next)
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>E-mails</CardTitle>
        <CardDescription>Les messages que Kledg vous envoie, en plus de ceux de votre compte (connexion, mot de passe, invitations).</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start gap-3">
          <Switch id="receipt-digest" checked={receiptDigest} onCheckedChange={(next) => void change(next)} disabled={busy} />
          <label htmlFor="receipt-digest" className="text-sm">
            Récapitulatif des justificatifs manquants
            <span className="text-muted-foreground block text-xs">
              Chaque lundi, les dépenses des 30 derniers jours sans justificatif, pour chaque société où vous pouvez en joindre. Rien n’est envoyé quand il ne manque rien.
            </span>
          </label>
        </div>
      </CardContent>
    </Card>
  )
}
