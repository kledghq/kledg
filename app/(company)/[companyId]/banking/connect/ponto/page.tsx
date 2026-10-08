'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Field, PageHeader, StatusBadge } from '@/components/shared'
import { BankProviderLogo } from '@/components/features/banking/bank-provider-logo'
import { LedgerAccountSelect } from '@/components/features/banking/ledger-account-select'
import { useLedgerBankAccounts } from '@/components/features/banking/use-ledger-bank-accounts'
import { responseError, type BankAccountRow } from '@/components/features/banking/types'
import { bankAccountName, plural } from '@/components/features/banking/format'
import {
  BANK_TRADEMARKS_NOTICE,
  PONTO_CUSTOM_INTEGRATION_DOCS_URL,
  PONTO_DASHBOARD_URL,
  PONTO_PRICING_URL,
} from '@/lib/banking/links'

const schema = z.object({
  clientId: z.string().trim().min(1, "Collez l'identifiant client (client ID) de l'intégration."),
  clientSecret: z.string().trim().min(1, 'Collez le secret client (client secret).'),
})
type FormValues = z.infer<typeof schema>

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="space-y-2">
      <div className="flex items-center gap-2">
        <span aria-hidden className="bg-background flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-medium">
          {n}
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="text-muted-foreground space-y-2 pl-8 text-sm">{children}</div>
    </li>
  )
}

export default function PontoSetupPage() {
  const params = useParams()
  const search = useSearchParams()
  const companyId = params?.companyId as string
  const bankName = search.get('name') || 'votre banque'
  const [connectedAccounts, setConnectedAccounts] = useState<BankAccountRow[] | null>(null)
  const { accounts: ledgerAccounts } = useLedgerBankAccounts(companyId)
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { clientId: '', clientSecret: '' } })
  const { errors, isSubmitting } = form.formState

  const loadAccounts = useCallback(async () => {
    const response = await fetch(`/api/banking/accounts?companyId=${companyId}`)
    if (!response.ok) return
    const { accounts } = (await response.json()) as { accounts: BankAccountRow[] }
    const ponto = accounts.filter((a) => a.bankConnection.provider === 'PONTO')
    if (ponto.length > 0) setConnectedAccounts(ponto)
  }, [companyId])

  useEffect(() => {
    if (companyId) void loadAccounts()
  }, [companyId, loadAccounts])

  const submit = form.handleSubmit(async (values) => {
    const response = await fetch('/api/banking/ponto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId, ...values }),
    })
    if (!response.ok) {
      form.setError('clientSecret', {
        message: await responseError(response, "Ponto refuse ces identifiants\u00a0: vérifiez l'identifiant et le secret client."),
      })
      return
    }
    const result = (await response.json()) as { accountsCount: number }
    toast.success(`Ponto connecté\u00a0: ${plural(result.accountsCount, 'compte trouvé', 'comptes trouvés')}`)
    form.reset()
    await loadAccounts()
  })

  return (
    <div className="w-full max-w-3xl space-y-6">
      <PageHeader
        title={`Connecter ${bankName}`}
        description="Via Ponto (Isabel Group), agrégateur bancaire agréé&nbsp;: vous gardez la main sur votre compte Ponto, Kledg lit vos comptes avec une intégration personnelle."
        actions={
          <Button asChild variant="outline">
            <Link href={`/${companyId}/banking/connect`}>Autres banques</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Mettre en place Ponto</CardTitle>
          <CardDescription>
            Ponto facture directement votre société&nbsp;: 14 jours d&apos;essai, puis environ 4 € par compte bancaire et par
            mois.{' '}
            <a href={PONTO_PRICING_URL} target="_blank" rel="noreferrer" className="text-link inline-flex items-center gap-1 underline-offset-4 hover:underline">
              Tarifs Ponto
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-5">
            <Step n={1} title="Créer votre compte Ponto">
              <p>Inscrivez votre société sur Ponto. Aucun contrat avec Kledg&nbsp;: le compte Ponto est à vous.</p>
              <Button asChild size="sm" variant="outline">
                <a href={PONTO_DASHBOARD_URL} target="_blank" rel="noreferrer">
                  Ouvrir Ponto
                  <ExternalLink aria-hidden />
                </a>
              </Button>
            </Step>
            <Step n={2} title={`Relier ${bankName} dans Ponto`}>
              <p>
                Dans Ponto, ajoutez votre banque et confirmez avec l&apos;authentification forte de la banque. L&apos;accès
                est valable 90 ou 180 jours selon la banque&nbsp;: Kledg vous prévient avant son expiration.
              </p>
            </Step>
            <Step n={3} title="Créer une intégration personnalisée">
              <p>
                Dans Ponto, ouvrez Intégrations, puis créez une intégration personnalisée (custom integration) nommée
                Kledg, avec accès aux comptes. Ponto affiche un identifiant client et un secret client.{' '}
                <a href={PONTO_CUSTOM_INTEGRATION_DOCS_URL} target="_blank" rel="noreferrer" className="text-link underline-offset-4 hover:underline">
                  Documentation Ponto
                </a>
              </p>
            </Step>
            <Step n={4} title="Coller les identifiants ici">
              <form id="ponto-connect-form" onSubmit={submit} className="space-y-4 text-foreground" noValidate>
                <Field label="Identifiant client (client ID)" required error={errors.clientId?.message}>
                  <Input autoComplete="off" className="font-mono" {...form.register('clientId')} />
                </Field>
                <Field label="Secret client (client secret)" required error={errors.clientSecret?.message} hint="Chiffré sur votre instance, il n'est jamais réaffiché.">
                  <Input type="password" autoComplete="off" {...form.register('clientSecret')} />
                </Field>
                <Button type="submit" loading={isSubmitting}>
                  Connecter Ponto
                </Button>
              </form>
            </Step>
          </ol>
        </CardContent>
      </Card>

      {connectedAccounts ? (
        <Card>
          <CardHeader>
            <CardTitle>Associer les comptes</CardTitle>
            <CardDescription>
              Choisissez pour chaque compte (IBAN) le compte comptable de banque 512 où ses opérations seront enregistrées.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Compte</TableHead>
                  <TableHead>IBAN</TableHead>
                  <TableHead>Compte comptable</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connectedAccounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell>
                      <BankProviderLogo
                        provider="PONTO"
                        logoUrl={account.institution?.logoUrl}
                        institutionName={account.institution?.name ?? account.name}
                        withLabel
                      />
                      <div className="text-muted-foreground mt-1 text-xs">{bankAccountName(account)}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{account.iban || '-'}</TableCell>
                    <TableCell>
                      {account.supersededBy ? (
                        <StatusBadge title="Une connexion directe couvre déjà ce compte (même IBAN)&nbsp;: ses opérations viennent d'elle.">
                          Synchronisé via {account.supersededBy.provider === 'QONTO' ? 'Qonto' : 'Revolut Business'}
                        </StatusBadge>
                      ) : (
                        <LedgerAccountSelect
                          bankAccountId={account.id}
                          value={account.ledgerAccountCode}
                          options={ledgerAccounts}
                          label={`Compte comptable de ${bankAccountName(account)}`}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button asChild size="sm" className="mt-4">
              <Link href={`/${companyId}/banking`}>Terminer</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Alert>
          <AlertTitle>Votre banque refuse la connexion ou n&apos;est pas stable&nbsp;?</AlertTitle>
          <AlertDescription>
            <p>Vous pouvez toujours ajouter le compte et importer ses relevés (fichier).</p>
            <Button asChild size="sm" variant="outline" className="mt-2">
              <Link href={`/${companyId}/banking/statements`}>Importer un relevé (fichier)</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <p className="text-muted-foreground text-xs">{BANK_TRADEMARKS_NOTICE}</p>
    </div>
  )
}
