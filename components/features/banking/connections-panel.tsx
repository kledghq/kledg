'use client'

import { useState } from 'react'
import Link from 'next/link'
import { KeyRound, RefreshCw, Unplug } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog, DateDisplay, EmptyState, StatusBadge, type StatusTone } from '@/components/shared'
import { BANK_PROVIDER_LABELS, BankProviderLogo } from './bank-provider-logo'
import { QontoConnectDialog } from './qonto-connect-dialog'
import type { BankConnectionRow } from './types'
import { responseError } from './types'

interface ConnectionsPanelProps {
  companyId: string
  connections: BankConnectionRow[]
  loading: boolean
  canManage: boolean
  canRefresh: boolean
  onChanged: () => void
}

/** Status of a bank connection as shown everywhere (banking page, Informations). */
export function connectionStatus(connection: BankConnectionRow): { tone: StatusTone; label: string } {
  if (connection.provider === 'MANUAL') return { tone: 'neutral', label: 'Import de relevés' }
  if (connection.status === 'inactive' || !connection.integration) return { tone: 'neutral', label: 'Déconnectée' }
  if (connection.integration.status === 'pending') return { tone: 'warning', label: 'Autorisation à terminer' }
  if (connection.lastSyncError) return { tone: 'danger', label: 'Erreur de synchronisation' }
  return { tone: 'success', label: 'Connectée' }
}

/** Bank connections of the company (one per provider), with refresh, Qonto API key update and disconnect. */
export function ConnectionsPanel({ companyId, connections, loading, canManage, canRefresh, onChanged }: ConnectionsPanelProps) {
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState<BankConnectionRow | null>(null)
  const [busy, setBusy] = useState(false)
  /** Integration whose Qonto API key is being replaced. */
  const [editingKey, setEditingKey] = useState<string | null>(null)

  const refresh = async (connection: BankConnectionRow) => {
    setRefreshing(connection.id)
    const response = await fetch(`/api/banking/connections/${connection.id}/refresh`, { method: 'POST' })
    setRefreshing(null)
    if (!response.ok) {
      toast.error(await responseError(response, "L'actualisation a échoué. Réessayez dans quelques minutes."))
      return
    }
    const result = (await response.json()) as { itemsSynced: number; errors: string[]; bankRefreshRequested: boolean }
    if (result.errors.length > 0) toast.error(result.errors[0])
    else if (result.bankRefreshRequested) toast.success("Actualisation demandée\u00a0: Ponto interroge votre banque, les nouvelles opérations arrivent d'ici quelques minutes.")
    else toast.success('Comptes à jour')
    onChanged()
  }

  const disconnect = async () => {
    if (!disconnecting) return
    setBusy(true)
    const response = await fetch(`/api/banking/connections/${disconnecting.id}`, { method: 'DELETE' })
    setBusy(false)
    if (!response.ok) {
      toast.error(await responseError(response, "La déconnexion a échoué. Réessayez."))
      return
    }
    toast.success('Banque déconnectée')
    setDisconnecting(null)
    onChanged()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connexions bancaires</CardTitle>
        <CardDescription>Les banques reliées à Kledg et l&apos;état de leur synchronisation.</CardDescription>
      </CardHeader>
      <CardContent aria-busy={loading || undefined}>
        {!loading && connections.length === 0 ? (
          <EmptyState
            title="Aucune connexion bancaire"
            description="Connectez votre banque pour recevoir vos opérations automatiquement, ou ajoutez un compte et importez ses relevés."
            action={
              canManage ? (
                <Button asChild size="sm">
                  <Link href={`/${companyId}/banking/connect`}>Connecter une banque</Link>
                </Button>
              ) : null
            }
          />
        ) : (
          <ul className="divide-y">
            {connections.map((connection) => {
              const status = connectionStatus(connection)
              const active = connection.provider !== 'MANUAL' && connection.status !== 'inactive' && connection.integration
              const label = BANK_PROVIDER_LABELS[connection.provider] ?? connection.provider
              return (
                <li key={connection.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <BankProviderLogo provider={connection.provider} withLabel={connection.provider !== 'QONTO'} />
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {connection.bankAccounts.length} compte{connection.bankAccounts.length > 1 ? 's' : ''}
                      {connection.lastSyncAt ? (
                        <>
                          {' '}· Dernière synchronisation le <DateDisplay value={connection.lastSyncAt} format="datetime" />
                        </>
                      ) : null}
                    </p>
                    {connection.lastSyncError ? (
                      <p className="text-destructive max-w-prose text-xs break-words">{connection.lastSyncError}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {connection.integration?.status === 'pending' && connection.provider === 'REVOLUT' && canManage ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/${companyId}/banking/connect/revolut`}>Terminer la connexion</Link>
                      </Button>
                    ) : null}
                    {active && connection.integration?.status === 'active' && canRefresh ? (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={refreshing === connection.id}
                        onClick={() => refresh(connection)}
                        title={connection.provider === 'PONTO' ? 'Ponto accepte une actualisation toutes les 5 minutes' : undefined}
                      >
                        <RefreshCw aria-hidden />
                        Actualiser
                      </Button>
                    ) : null}
                    {active && canManage && connection.provider === 'QONTO' && connection.integration ? (
                      <Button size="sm" variant="outline" onClick={() => setEditingKey(connection.integration?.id ?? null)}>
                        <KeyRound aria-hidden />
                        Mettre à jour la clé API
                      </Button>
                    ) : null}
                    {active && canManage ? (
                      <Button size="icon-sm" variant="ghost" aria-label={`Déconnecter ${label}`} title="Déconnecter" onClick={() => setDisconnecting(connection)}>
                        <Unplug aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={disconnecting !== null}
        onOpenChange={(open) => !open && setDisconnecting(null)}
        title={`Déconnecter ${disconnecting ? (BANK_PROVIDER_LABELS[disconnecting.provider] ?? disconnecting.provider) : ''} ?`}
        description="Kledg supprime les identifiants de cette connexion et arrête la synchronisation. Les comptes et les opérations déjà reçues restent dans Kledg."
        confirmLabel="Déconnecter"
        loading={busy}
        onConfirm={disconnect}
      />
      <QontoConnectDialog
        companyId={companyId}
        integrationId={editingKey ?? undefined}
        open={editingKey !== null}
        onOpenChange={(open) => !open && setEditingKey(null)}
        onConnected={() => {
          setEditingKey(null)
          onChanged()
        }}
      />
    </Card>
  )
}
