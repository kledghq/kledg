'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Edit, Landmark, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { logger } from '@/lib/logger'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { Amount, DateDisplay, EmptyState, Field, formatDisplayDate, PageHeader, StatusBadge } from '@/components/shared'
import { docsUrl } from '@/lib/docs-links'
import { StatementImportDialog } from '@/components/features/banking/statement-import-dialog'
import { BANK_PROVIDER_LABELS, BankProviderLogo } from '@/components/features/banking/bank-provider-logo'
import { AccountSyncSwitch, canToggleSync } from '@/components/features/banking/account-sync-switch'
import { ConnectionsPanel } from '@/components/features/banking/connections-panel'
import { ConsentBanners } from '@/components/features/banking/consent-banners'
import { LedgerAccountSelect } from '@/components/features/banking/ledger-account-select'
import { ManualAccountDialog } from '@/components/features/banking/manual-account-dialog'
import { useLedgerBankAccounts } from '@/components/features/banking/use-ledger-bank-accounts'
import { responseError, type BankAccountRow, type BankConnectionRow } from '@/components/features/banking/types'
import { bankAccountName, bankAccountSubtitle, isTechnicalName, plural } from '@/components/features/banking/format'
import { consentStatus } from '@/lib/banking/consent'
import { ConnectBankButton } from '@/components/features/banking/connect-bank-button'
import { AccessNotice, useCompanyAccess } from '@/components/features/companies/company-access'

function syncStatus(account: BankAccountRow): { tone: 'success' | 'neutral' | 'warning' | 'danger'; label: string; title?: string } {
  if (account.bankConnection.provider === 'MANUAL') return { tone: 'neutral', label: 'Import de relevés' }
  if (account.supersededBy) {
    const via = BANK_PROVIDER_LABELS[account.supersededBy.provider] ?? account.supersededBy.provider
    return { tone: 'neutral', label: `Synchronisé via ${via}`, title: 'Une connexion directe couvre déjà ce compte (même IBAN).' }
  }
  const consent = consentStatus(account.consentExpiresAt)
  if (consent.level === 'expired' && consent.staleSince) {
    return { tone: 'danger', label: 'Accès expiré', title: `Données à jour jusqu'au ${formatDisplayDate(consent.staleSince)}` }
  }
  if (account.lastSyncError) return { tone: 'danger', label: 'Erreur', title: account.lastSyncError }
  if (!account.shouldSync || account.bankConnection.status === 'inactive') return { tone: 'neutral', label: 'Non synchronisé' }
  return { tone: 'success', label: 'Synchronisé' }
}

const NO_ACCOUNT_TEXT = 'Aucun compte bancaire. Connectez votre banque, ou ajoutez un compte et importez ses relevés.'

export default function BankingPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [accounts, setAccounts] = useState<BankAccountRow[]>([])
  const [connections, setConnections] = useState<BankConnectionRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editingAccount, setEditingAccount] = useState<BankAccountRow | null>(null)
  const [displayNameValue, setDisplayNameValue] = useState<string>('')
  const { accounts: ledgerAccounts } = useLedgerBankAccounts(companyId)
  const { can, denied, roleLabel } = useCompanyAccess()
  const canManage = can({ banking: ['manage'] })
  const canReconcile = can({ banking: ['reconcile'] })

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setError(null)
    try {
      const [accountsResponse, connectionsResponse] = await Promise.all([
        fetch(`/api/banking/accounts?companyId=${companyId}`),
        fetch(`/api/banking/connections?companyId=${companyId}`),
      ])
      if (!accountsResponse.ok) {
        setError(await responseError(accountsResponse, "Les comptes bancaires n'ont pas pu être chargés. Réessayez."))
        return
      }
      setAccounts(((await accountsResponse.json()) as { accounts: BankAccountRow[] }).accounts ?? [])
      if (connectionsResponse.ok) {
        setConnections(((await connectionsResponse.json()) as { connections: BankConnectionRow[] }).connections ?? [])
      }
    } catch (err) {
      logger.error('Error loading bank accounts:', err)
      setError("Les comptes bancaires n'ont pas pu être chargés. Réessayez.")
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    void load()
  }, [load])

  /** Reads what the banks hold now for every connection (no bank refresh request). */
  const handleSync = async () => {
    setSyncing(true)
    setError(null)
    try {
      const response = await fetch('/api/integrations/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      })
      if (!response.ok) {
        const message = await responseError(response, 'La synchronisation a échoué. Réessayez.')
        toast.error(message)
        setError(message)
        return
      }
      const result = (await response.json()) as { success: boolean; totalItemsSynced: number; errors: string[] }
      // Reload first: load() clears the error, which would erase the sync failure shown below
      await load()
      if (result.success) {
        toast.success(`Synchronisation terminée\u00a0: ${plural(result.totalItemsSynced, 'élément reçu', 'éléments reçus')}`)
      } else {
        const message = result.errors.join(', ') || 'La synchronisation a échoué. Réessayez.'
        toast.error(message)
        setError(message)
      }
    } catch (err) {
      logger.error('[BankingPage] sync failed', err)
      toast.error('La synchronisation a échoué. Réessayez.')
    } finally {
      setSyncing(false)
    }
  }

  const handleSaveDisplayName = async () => {
    if (!editingAccount) return
    const response = await fetch(`/api/banking/accounts/${editingAccount.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: displayNameValue.trim() || null }),
    })
    if (!response.ok) {
      toast.error(await responseError(response, "Le nom n'a pas pu être enregistré."))
      return
    }
    toast.success("Nom d'affichage mis à jour")
    setEditingAccount(null)
    void load()
  }

  if (!companyId) {
    return <NoCompanySelected />
  }

  const hasApiConnection = connections.some((c) => c.provider !== 'MANUAL' && c.integration)

  const syncCell = (account: BankAccountRow) => {
    const status = syncStatus(account)
    return (
      <div>
        <div className="flex items-center gap-2">
          {canToggleSync(account) ? (
            <AccountSyncSwitch key={`${account.id}:${account.shouldSync}`} account={account} onChanged={load} />
          ) : null}
          <StatusBadge tone={status.tone} title={status.title}>
            {status.label}
          </StatusBadge>
        </div>
        {account.lastSyncedAt && !account.supersededBy ? (
          <div className="text-muted-foreground mt-1 text-xs">
            <DateDisplay value={account.lastSyncedAt} format="datetime" />
          </div>
        ) : null}
      </div>
    )
  }

  const renameButton = (account: BankAccountRow, name: string) => (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Renommer ${name}`}
      disabled={!canManage}
      title={canManage ? "Modifier le nom d'affichage" : denied('renommer un compte')}
      onClick={() => {
        setEditingAccount(account)
        setDisplayNameValue(account.displayName || '')
      }}
    >
      <Edit aria-hidden />
    </Button>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comptes bancaires"
        description="Vos comptes bancaires, leur connexion à la banque et le compte comptable 512 de chacun."
        actions={
          <>
            {hasApiConnection ? (
              <Button
                onClick={handleSync}
                loading={syncing}
                variant="outline"
                disabled={!canReconcile}
                title={canReconcile ? undefined : denied('synchroniser les comptes')}
              >
                <RefreshCw aria-hidden />
                Synchroniser
              </Button>
            ) : null}
            <StatementImportDialog companyId={companyId} accounts={accounts} onImported={load} />
            <ManualAccountDialog companyId={companyId} onCreated={load} />
            <ConnectBankButton companyId={companyId}>
              <Landmark aria-hidden />
              Connecter une banque
            </ConnectBankButton>
          </>
        }
      />

      {!canManage ? (
        <AccessNotice>
          Votre rôle{roleLabel ? ` (${roleLabel})` : ''} permet de consulter les comptes
          {canReconcile ? ", d'importer des relevés et de synchroniser les banques connectées" : ''}. Connecter une banque,
          ajouter un compte ou modifier un compte (nom, compte 512, synchronisation, clé d&apos;accès) est réservé aux
          administrateurs de la société.
        </AccessNotice>
      ) : null}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <ConsentBanners companyId={companyId} accounts={accounts} />

      {!loading && !error && accounts.length === 0 && connections.length === 0 ? (
        <EmptyState
          bordered
          icon={Landmark}
          title="Aucun compte bancaire"
          description="Les opérations bancaires sont la source de la plupart des écritures. Connectez votre banque pour les recevoir chaque jour, ou ajoutez un compte puis importez un relevé (CSV, OFX ou Excel) exporté depuis votre banque."
          action={<ConnectBankButton companyId={companyId} size="sm" />}
          docsHref={docsUrl('importStatement')}
          docsLabel="Importer un relevé"
        />
      ) : (
        <>
        <Card>
          <CardHeader>
            <CardTitle>Comptes</CardTitle>
            <CardDescription>
              Associez chaque compte à son compte comptable de banque (512)&nbsp;: ses opérations y seront enregistrées.
              Suspendez la synchronisation d&apos;un compte dont vous ne voulez pas recevoir les opérations.
            </CardDescription>
          </CardHeader>
          <CardContent aria-busy={loading || undefined}>
            {/* Phones and tablets: one block per account, every control in reach without scrolling sideways. */}
            <div className="lg:hidden">
              {loading ? (
                <div className="divide-y rounded-lg border" aria-hidden>
                  {Array.from({ length: 2 }, (_, i) => (
                    <div key={i} className="space-y-3 p-4">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-4 w-56" />
                      <Skeleton className="h-9 w-full" />
                    </div>
                  ))}
                </div>
              ) : accounts.length === 0 ? (
                <p className="text-muted-foreground rounded-lg border px-4 py-8 text-center text-sm">{NO_ACCOUNT_TEXT}</p>
              ) : (
                <ul className="divide-y rounded-lg border" aria-label="Comptes bancaires">
                  {accounts.map((account) => {
                    const name = bankAccountName(account)
                    const subtitle = bankAccountSubtitle(account)
                    return (
                      <li key={account.id} className="space-y-3 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="font-medium break-words">{name}</div>
                            {subtitle ? <div className="text-muted-foreground text-xs">{subtitle}</div> : null}
                            <BankProviderLogo
                              provider={account.bankConnection.provider}
                              logoUrl={account.institution?.logoUrl}
                              institutionName={account.institution?.name}
                              withLabel
                            />
                          </div>
                          <div className="flex shrink-0 items-start gap-1">
                            {account.bankConnection.provider === 'MANUAL' ? null : (
                              <Amount value={account.balance} className="pt-0.5 font-medium" />
                            )}
                            {renameButton(account, name)}
                          </div>
                        </div>
                        {account.iban ? <div className="font-mono text-xs break-all">{account.iban}</div> : null}
                        <div className="space-y-1.5">
                          <div className="text-muted-foreground text-xs">Compte comptable</div>
                          <LedgerAccountSelect
                            bankAccountId={account.id}
                            value={account.ledgerAccountCode}
                            options={ledgerAccounts}
                            label={`Compte comptable de ${name}`}
                            className="w-full"
                          />
                        </div>
                        {syncCell(account)}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            <Table containerClassName="hidden lg:block">
              <TableHeader>
                <TableRow>
                  <TableHead>Compte</TableHead>
                  <TableHead>Banque</TableHead>
                  <TableHead>IBAN</TableHead>
                  <TableHead numeric>Solde</TableHead>
                  <TableHead>Compte comptable</TableHead>
                  <TableHead>Synchronisation</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeleton columns={7} rows={3} />
                ) : accounts.length === 0 ? (
                  <TableEmpty colSpan={7}>{NO_ACCOUNT_TEXT}</TableEmpty>
                ) : (
                  accounts.map((account) => {
                    const name = bankAccountName(account)
                    const subtitle = bankAccountSubtitle(account)
                    return (
                      <TableRow key={account.id}>
                        <TableCell className="font-medium">
                          <div>{name}</div>
                          {subtitle ? <div className="text-muted-foreground text-xs font-normal">{subtitle}</div> : null}
                        </TableCell>
                        <TableCell>
                          <BankProviderLogo
                            provider={account.bankConnection.provider}
                            logoUrl={account.institution?.logoUrl}
                            institutionName={account.institution?.name}
                            withLabel={account.bankConnection.provider !== 'QONTO'}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{account.iban || '-'}</TableCell>
                        <TableCell numeric>
                          {account.bankConnection.provider === 'MANUAL' ? (
                            <span className="text-muted-foreground">-</span>
                          ) : (
                            <Amount value={account.balance} />
                          )}
                        </TableCell>
                        <TableCell>
                          <LedgerAccountSelect
                            bankAccountId={account.id}
                            value={account.ledgerAccountCode}
                            options={ledgerAccounts}
                            label={`Compte comptable de ${name}`}
                          />
                        </TableCell>
                        <TableCell>{syncCell(account)}</TableCell>
                        <TableCell>{renameButton(account, name)}</TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <ConnectionsPanel
          companyId={companyId}
          connections={connections}
          loading={loading}
          canManage={canManage}
          canRefresh={canReconcile}
          onChanged={load}
        />
        </>
      )}

      <Dialog open={editingAccount !== null} onOpenChange={(open) => !open && setEditingAccount(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier le nom d&apos;affichage</DialogTitle>
            <DialogDescription>Le nom sous lequel ce compte apparaît dans Kledg (listes, filtres, rapprochement).</DialogDescription>
          </DialogHeader>
          <Field
            label="Nom d'affichage"
            optional
            hint={
              !editingAccount
                ? undefined
                : !isTechnicalName(editingAccount.name)
                  ? `Nom chez la banque\u00a0: ${editingAccount.name}`
                  : editingAccount.iban
                    ? `Laissé vide, le compte est désigné par la fin de son IBAN (${bankAccountName({ ...editingAccount, displayName: null })}).`
                    : undefined
            }
          >
            <Input
              value={displayNameValue}
              onChange={(e) => setDisplayNameValue(e.target.value)}
              placeholder="ex. Compte courant"
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingAccount(null)}>
              Annuler
            </Button>
            <Button onClick={handleSaveDisplayName}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
