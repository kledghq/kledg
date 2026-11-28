'use client'

import * as React from 'react'
import { Copy, Mail } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/shared'
import type { ReceiptInboxView } from '@/lib/receipts/inbound/inbox.service'
import { responseError } from '@/components/features/banking/types'

interface ReceiptInboxCardProps {
  companyId: string
  /** settings:update: creates or changes the address. */
  canManage: boolean
}

/**
 * The company's receipt email address (docs/justificatifs-email.md): a
 * receipt forwarded there, or sent there by a supplier, lands in the
 * receipts dropped below, read and matched like an upload. Shown only when
 * the instance receives receipt emails.
 */
export function ReceiptInboxCard({ companyId, canManage }: ReceiptInboxCardProps) {
  const [inbox, setInbox] = React.useState<ReceiptInboxView | null>(null)
  const [confirming, setConfirming] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    fetch(`/api/receipts/inbox?companyId=${encodeURIComponent(companyId)}`)
      .then((response) => (response.ok ? (response.json() as Promise<ReceiptInboxView>) : null))
      .then((view) => {
        if (!cancelled) setInbox(view)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [companyId])

  if (!inbox?.available) return null

  async function renew() {
    setBusy(true)
    try {
      const response = await fetch('/api/receipts/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      })
      if (!response.ok) throw new Error(await responseError(response, "L'adresse n'a pas pu être créée. Réessayez."))
      const replaced = Boolean(inbox?.address)
      setInbox((await response.json()) as ReceiptInboxView)
      toast.success(replaced ? 'Nouvelle adresse créée : l’ancienne ne reçoit plus rien.' : 'Adresse créée.')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  async function copy(address: string) {
    try {
      await navigator.clipboard.writeText(address)
      toast.success('Adresse copiée.')
    } catch {
      toast.error('La copie a échoué : sélectionnez l’adresse pour la copier.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="size-4" aria-hidden />
          Recevoir les justificatifs par e-mail
        </CardTitle>
        <CardDescription>
          Transférez une facture reçue par e-mail à cette adresse, ou donnez-la à vos fournisseurs comme adresse de facturation&nbsp;: Kledg lit les pièces jointes (PDF, JPEG, PNG), puis cherche leur transaction. Vous rattachez ensuite chaque justificatif d’un clic.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {inbox.address ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <code className="bg-muted rounded px-2 py-1 text-sm break-all" data-testid="receipt-inbox-address">
                {inbox.address}
              </code>
              <Button size="sm" variant="outline" onClick={() => void copy(inbox.address as string)}>
                <Copy aria-hidden />
                Copier
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Toute personne qui connaît cette adresse peut vous envoyer des justificatifs&nbsp;: ils attendent votre vérification, rien n’est rattaché ni comptabilisé sans vous.
            </p>
            {canManage ? (
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} disabled={busy}>
                Changer d’adresse
              </Button>
            ) : null}
          </>
        ) : canManage ? (
          <Button size="sm" onClick={() => void renew()} loading={busy}>
            Créer l’adresse
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">Un administrateur de la société peut créer l’adresse.</p>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Changer l’adresse des justificatifs ?"
        description="L’adresse actuelle cessera aussitôt de recevoir des justificatifs. Donnez la nouvelle à vos fournisseurs."
        confirmLabel="Changer d’adresse"
        loading={busy}
        onConfirm={renew}
      />
    </Card>
  )
}
