'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { CheckCircle2, Download, ExternalLink, FileUp, KeyRound } from 'lucide-react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog, DateDisplay, Field, PageHeader, StatusBadge } from '@/components/shared'
import { BankProviderLogo } from '@/components/features/banking/bank-provider-logo'
import { CopyValue } from '@/components/features/banking/copy-value'
import { responseError } from '@/components/features/banking/types'
import {
  BANK_TRADEMARKS_NOTICE,
  REVOLUT_API_GUIDE_URL,
  REVOLUT_API_PLANS_URL,
  REVOLUT_API_SETTINGS_URL,
} from '@/lib/banking/links'

interface RevolutSetup {
  integrationId: string
  certificate: string
  certificateExpiresAt: string | null
  redirectUri: string
  environment: 'production' | 'sandbox'
  clientId: string | null
  status: string
}

const STATUS_MESSAGES: Record<string, { title: string; body: string; tone: 'default' | 'destructive' }> = {
  connected: {
    title: 'Revolut Business est connecté',
    body: 'Vos comptes en euros et leurs opérations terminées arrivent dans Kledg. Associez maintenant chaque compte à son compte comptable 512.',
    tone: 'default',
  },
  denied: {
    title: "L'autorisation n'a pas été donnée",
    body: 'Revolut est revenu sans autorisation. Recommencez l\'étape 3 si vous souhaitez connecter vos comptes.',
    tone: 'destructive',
  },
  error: {
    title: "Revolut a refusé l'autorisation",
    body: "Vérifiez que l'identifiant client correspond au certificat collé dans Revolut Business et que l'URL de redirection est exactement celle indiquée, puis recommencez l'étape 3.",
    tone: 'destructive',
  },
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <li className="space-y-2">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="bg-background flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-medium"
        >
          {done ? <CheckCircle2 className="text-success size-3.5" /> : n}
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="space-y-3 pl-8 text-sm">{children}</div>
    </li>
  )
}

export default function RevolutSetupPage() {
  const params = useParams()
  const search = useSearchParams()
  const companyId = params?.companyId as string
  const status = search.get('status')
  const [setup, setSetup] = useState<RevolutSetup | null>(null)
  const [redirectUri, setRedirectUri] = useState('')
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [regenerateOpen, setRegenerateOpen] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientIdError, setClientIdError] = useState<string | undefined>()
  const [authorizing, setAuthorizing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const response = await fetch(`/api/banking/revolut?companyId=${companyId}`)
    if (response.ok) {
      const data = (await response.json()) as { setup: RevolutSetup | null; redirectUri: string }
      setSetup(data.setup)
      setRedirectUri(data.setup?.redirectUri ?? data.redirectUri)
      setClientId(data.setup?.clientId ?? '')
    } else {
      toast.error(await responseError(response, "La configuration Revolut n'a pas pu être chargée."))
    }
    setLoading(false)
  }, [companyId])

  useEffect(() => {
    if (companyId) void load()
  }, [companyId, load])

  const generate = async (regenerate = false) => {
    setGenerating(true)
    const response = await fetch('/api/banking/revolut', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId, regenerate }),
    })
    setGenerating(false)
    setRegenerateOpen(false)
    if (!response.ok) {
      toast.error(await responseError(response, "Le certificat n'a pas pu être généré. Réessayez."))
      return
    }
    const data = (await response.json()) as { setup: RevolutSetup }
    setSetup(data.setup)
    setRedirectUri(data.setup.redirectUri)
    setClientId(data.setup.clientId ?? '')
    toast.success(regenerate ? 'Nouveau certificat généré' : 'Certificat généré')
  }

  const authorize = async () => {
    setClientIdError(undefined)
    if (clientId.trim().length < 8) {
      setClientIdError("Collez l'identifiant client (client ID) affiché par Revolut Business.")
      return
    }
    setAuthorizing(true)
    const response = await fetch('/api/banking/revolut/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId, clientId: clientId.trim() }),
    })
    if (!response.ok) {
      setAuthorizing(false)
      setClientIdError(await responseError(response, "L'autorisation n'a pas pu démarrer. Réessayez."))
      return
    }
    const { url } = (await response.json()) as { url: string }
    window.location.assign(url)
  }

  const downloadCertificate = () => {
    if (!setup?.certificate) return
    const blob = new Blob([setup.certificate], { type: 'application/x-x509-ca-cert' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'kledg-revolut.cer'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const message = status ? STATUS_MESSAGES[status] : undefined
  const active = setup?.status === 'active'

  return (
    <div className="w-full max-w-3xl space-y-6">
      <PageHeader
        title="Connecter Revolut Business"
        description="Connexion directe à l'API Revolut Business, sans intermédiaire ni frais Kledg."
        actions={
          <Button asChild variant="outline">
            <Link href={`/${companyId}/banking/connect`}>Autres banques</Link>
          </Button>
        }
      />

      {message ? (
        <Alert variant={message.tone}>
          <AlertTitle>{message.title}</AlertTitle>
          <AlertDescription>
            <p>{message.body}</p>
            {status === 'connected' ? (
              <Button asChild size="sm" className="mt-2">
                <Link href={`/${companyId}/banking`}>Associer les comptes</Link>
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <Alert>
        <KeyRound aria-hidden />
        <AlertTitle>Offre Revolut Business requise&nbsp;: Grow, Scale ou Enterprise</AlertTitle>
        <AlertDescription>
          <p>
            L&apos;API Revolut Business n&apos;est pas incluse dans l&apos;offre Basic.{' '}
            <a href={REVOLUT_API_PLANS_URL} target="_blank" rel="noreferrer" className="text-link underline-offset-4 hover:underline">
              Offres incluant l&apos;API
            </a>
            . Avec l&apos;offre Basic, importez vos relevés Revolut (CSV ou OFX) à la place.
          </p>
          <Button asChild size="sm" variant="outline" className="mt-2">
            <Link href={`/${companyId}/banking/statements`}>
              <FileUp aria-hidden />
              Importer un relevé (fichier)
            </Link>
          </Button>
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BankProviderLogo provider="REVOLUT" withLabel />
            {active ? <StatusBadge tone="success">Connecté</StatusBadge> : null}
            {setup?.environment === 'sandbox' ? <StatusBadge tone="info">Sandbox</StatusBadge> : null}
          </CardTitle>
          <CardDescription>
            Trois étapes, environ cinq minutes. Vous aurez besoin d&apos;un accès administrateur à Revolut Business.{' '}
            <a href={REVOLUT_API_GUIDE_URL} target="_blank" rel="noreferrer" className="text-link inline-flex items-center gap-1 underline-offset-4 hover:underline">
              Guide Revolut
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent aria-busy={loading || undefined}>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <ol className="space-y-6">
              <Step n={1} title="Générer le certificat" done={Boolean(setup?.certificate)}>
                <p className="text-muted-foreground">
                  Kledg crée une clé privée, qui reste chiffrée sur votre instance, et le certificat public correspondant à
                  donner à Revolut.
                </p>
                {setup?.certificate ? (
                  <>
                    <CopyValue value={setup.certificate} label="le certificat" multiline />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" onClick={downloadCertificate}>
                        <Download aria-hidden />
                        Télécharger (.cer)
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRegenerateOpen(true)}>
                        Générer un nouveau certificat
                      </Button>
                      {setup.certificateExpiresAt ? (
                        <span className="text-muted-foreground text-xs">
                          Valable jusqu&apos;au <DateDisplay value={setup.certificateExpiresAt} format="long" />
                        </span>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <Button size="sm" onClick={() => generate(false)} loading={generating}>
                    Générer le certificat
                  </Button>
                )}
              </Step>

              <Step n={2} title="Ajouter le certificat dans Revolut Business" done={Boolean(setup?.clientId)}>
                <p className="text-muted-foreground">
                  Dans Revolut Business, ouvrez Paramètres, API, Business API, puis ajoutez un certificat. Collez le
                  certificat ci-dessus et cette URL de redirection OAuth, à l&apos;identique&nbsp;:
                </p>
                <CopyValue value={redirectUri} label="l'URL de redirection" />
                <Button asChild size="sm" variant="outline">
                  <a href={REVOLUT_API_SETTINGS_URL} target="_blank" rel="noreferrer">
                    Ouvrir les réglages API de Revolut
                    <ExternalLink aria-hidden />
                  </a>
                </Button>
                <p className="text-muted-foreground">Revolut affiche alors un identifiant client (client ID).</p>
              </Step>

              <Step n={3} title="Autoriser Kledg à lire vos comptes" done={active}>
                <Field
                  label="Identifiant client (client ID)"
                  required
                  error={clientIdError}
                  hint="Kledg demande uniquement la lecture (comptes et opérations), jamais de paiement."
                >
                  <Input
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="ex. kU7x2...Qp9"
                    autoComplete="off"
                    className="font-mono"
                    disabled={!setup?.certificate}
                  />
                </Field>
                <Button onClick={authorize} loading={authorizing} disabled={!setup?.certificate}>
                  {active ? 'Autoriser de nouveau dans Revolut' : 'Autoriser dans Revolut'}
                </Button>
                <p className="text-muted-foreground text-xs">
                  L&apos;autorisation est valable 90 jours&nbsp;: Kledg vous prévient avant son expiration pour la renouveler ici.
                </p>
              </Step>
            </ol>
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">{BANK_TRADEMARKS_NOTICE}</p>

      <ConfirmDialog
        open={regenerateOpen}
        onOpenChange={setRegenerateOpen}
        title="Générer un nouveau certificat ?"
        description="L'ancien certificat ne fonctionnera plus&nbsp;: vous devrez ajouter le nouveau dans Revolut Business, puis autoriser Kledg de nouveau avec le nouvel identifiant client."
        confirmLabel="Générer un nouveau certificat"
        loading={generating}
        onConfirm={() => generate(true)}
      />
    </div>
  )
}
