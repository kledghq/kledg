'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowRight, FileUp, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { EmptyState, PageHeader, StatusBadge, type StatusTone } from '@/components/shared'
import { BankProviderLogo } from '@/components/features/banking/bank-provider-logo'
import { ManualAccountDialog } from '@/components/features/banking/manual-account-dialog'
import { QontoConnectDialog } from '@/components/features/banking/qonto-connect-dialog'
import { responseError, type BankConnectionRow } from '@/components/features/banking/types'
import { BANK_TRADEMARKS_NOTICE } from '@/lib/banking/links'
import { AccessNotice, useCompanyAccess } from '@/components/features/companies/company-access'
import type { ProviderInstitution } from '@/lib/banking/providers/types'

const STATUS: Record<string, { tone: StatusTone; label: string; title: string }> = {
  stable: { tone: 'success', label: 'Stable', title: 'Connexion éprouvée chez Ponto.' },
  beta: { tone: 'info', label: 'Bêta', title: 'Connexion récente chez Ponto\u00a0: elle fonctionne mais peut évoluer.' },
  experimental: {
    tone: 'warning',
    label: 'Expérimental',
    title: "Connexion expérimentale chez Ponto\u00a0: gardez l'import de relevés sous la main.",
  },
}

/** Normalized for search: lower case, no accents. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

export default function ConnectBankPage() {
  const params = useParams()
  const router = useRouter()
  const companyId = params?.companyId as string
  const { can, denied } = useCompanyAccess()
  const canManage = can({ banking: ['manage'] })
  const [institutions, setInstitutions] = useState<ProviderInstitution[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [qontoOpen, setQontoOpen] = useState(false)
  const [connections, setConnections] = useState<BankConnectionRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [institutionsResponse, connectionsResponse] = await Promise.all([
      fetch(`/api/banking/institutions?companyId=${companyId}`),
      fetch(`/api/banking/connections?companyId=${companyId}`),
    ])
    if (institutionsResponse.ok) {
      setInstitutions(((await institutionsResponse.json()) as { institutions: ProviderInstitution[] }).institutions)
    } else {
      setError(await responseError(institutionsResponse, "La liste des banques n'a pas pu être chargée. Réessayez."))
    }
    if (connectionsResponse.ok) {
      setConnections(((await connectionsResponse.json()) as { connections: BankConnectionRow[] }).connections)
    }
    setLoading(false)
  }, [companyId])

  useEffect(() => {
    if (companyId) void load()
  }, [companyId, load])

  const filtered = useMemo(() => {
    const q = fold(query.trim())
    return q ? institutions.filter((i) => fold(i.name).includes(q)) : institutions
  }, [institutions, query])

  const connected = (provider: string) =>
    connections.some((c) => c.provider === provider && c.integration && c.integration.status === 'active')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connecter une banque"
        description="Recevez automatiquement les opérations de vos comptes bancaires. Choisissez votre banque."
        actions={
          <Button asChild variant="outline">
            <Link href={`/${companyId}/banking`}>Retour aux comptes</Link>
          </Button>
        }
      />

      {!canManage ? (
        <AccessNotice>{denied("connecter une banque ni d'ajouter un compte")}</AccessNotice>
      ) : null}

      {/* A role that cannot manage bank connections sees the choices, inert */}
      <div inert={!canManage} className={canManage ? 'space-y-6' : 'space-y-6 opacity-60'}>
      <section className="space-y-3" aria-labelledby="direct-title">
        <div>
          <h2 id="direct-title" className="text-base font-semibold">
            Connexion directe
          </h2>
          <p className="text-muted-foreground text-sm">Kledg se connecte à l&apos;API de la banque, sans intermédiaire.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => (connected('QONTO') ? router.push(`/${companyId}/banking`) : setQontoOpen(true))}
            className="bg-card hover:bg-muted/40 focus-visible:ring-ring/50 flex flex-col items-start gap-2 rounded-lg border p-4 text-left outline-none focus-visible:ring-[3px]"
          >
            <div className="flex w-full items-center justify-between gap-2">
              <BankProviderLogo provider="QONTO" />
              {connected('QONTO') ? <StatusBadge tone="success">Connecté</StatusBadge> : <StatusBadge>Gratuit</StatusBadge>}
            </div>
            <p className="text-muted-foreground text-sm">Avec la clé API de votre organisation Qonto. Comptes, opérations et justificatifs.</p>
          </button>
          <Link
            href={`/${companyId}/banking/connect/revolut`}
            className="bg-card hover:bg-muted/40 focus-visible:ring-ring/50 flex flex-col items-start gap-2 rounded-lg border p-4 text-left outline-none focus-visible:ring-[3px]"
          >
            <div className="flex w-full items-center justify-between gap-2">
              <BankProviderLogo provider="REVOLUT" withLabel />
              {connected('REVOLUT') ? (
                <StatusBadge tone="success">Connecté</StatusBadge>
              ) : (
                <StatusBadge title="L'API Revolut Business est incluse dans les offres Grow, Scale et Enterprise.">Offre Grow ou plus</StatusBadge>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              Avec l&apos;API Revolut Business&nbsp;: un certificat généré par Kledg, puis votre autorisation dans Revolut.
            </p>
          </Link>
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Autre banque</CardTitle>
          <CardDescription>
            Via Ponto (Isabel Group), un agrégateur agréé&nbsp;: vous ouvrez votre propre compte Ponto, environ 4 € par compte
            bancaire et par mois facturés par Ponto, 14 jours d&apos;essai.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative max-w-sm">
            <Search aria-hidden className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              aria-label="Rechercher une banque"
              placeholder="Rechercher une banque (ex. Crédit Agricole)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>
                <p>{error}</p>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => void load()}>
                  Réessayer
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          <div aria-busy={loading || undefined} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {loading
              ? Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)
              : filtered.map((institution) => {
                  const status = STATUS[institution.status] ?? STATUS.beta
                  return (
                    <Link
                      key={institution.id}
                      title={institution.name}
                      href={`/${companyId}/banking/connect/ponto?institution=${encodeURIComponent(institution.id)}&name=${encodeURIComponent(institution.name)}`}
                      className="bg-card hover:bg-muted/40 focus-visible:ring-ring/50 flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 py-2.5 outline-none focus-visible:ring-[3px]"
                    >
                      <BankProviderLogo provider="PONTO" logoUrl={institution.logoUrl} institutionName={institution.name} withLabel className="min-w-0" />
                      <StatusBadge tone={status.tone} title={status.title}>
                        {status.label}
                      </StatusBadge>
                    </Link>
                  )
                })}
          </div>
          {!loading && !error && filtered.length === 0 ? (
            <EmptyState
              title="Aucune banque ne correspond"
              description="Vérifiez l'orthographe, ou utilisez l'import de relevés ci-dessous si votre banque n'est pas proposée."
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Votre banque n&apos;est pas dans la liste&nbsp;?</CardTitle>
          <CardDescription>
            BoursoBank, Shine ou toute autre banque&nbsp;: ajoutez le compte, puis importez ses relevés (CAMT.053, OFX, CSV ou
            Excel) exportés depuis l&apos;espace en ligne de la banque.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <ManualAccountDialog companyId={companyId} onCreated={() => router.push(`/${companyId}/banking`)} />
          <Button asChild variant="outline">
            <Link href={`/${companyId}/banking/statements`}>
              <FileUp aria-hidden />
              Importer un relevé (fichier)
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </CardContent>
      </Card>

      </div>

      <p className="text-muted-foreground text-xs">{BANK_TRADEMARKS_NOTICE}</p>

      <QontoConnectDialog
        companyId={companyId}
        open={qontoOpen}
        onOpenChange={setQontoOpen}
        onConnected={() => {
          setQontoOpen(false)
          router.push(`/${companyId}/banking`)
        }}
      />
    </div>
  )
}
