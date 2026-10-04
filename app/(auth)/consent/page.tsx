'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { TriangleAlert } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { AuthShell } from '@/components/brand/auth-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  ADMIN_SCOPE,
  ACCESS_LEVELS,
  READ_SCOPE,
  WRITE_SCOPE,
  availableLevels,
  defaultLevel,
  scopesForLevel,
  startingAccess,
  type AccessLevel,
  type CompanyAccess,
  type ExecutionMode,
} from '@/lib/ai-access/access'
import { AccessLevelPicker } from '@/components/features/settings/access-level-picker'
import { ExecutionModePicker } from '@/components/features/settings/execution-mode-picker'
import { AssistantLogo } from '@/components/features/settings/assistant-logos'
import { CompanyAccessPicker, accessError } from '@/components/features/settings/company-access-picker'
import { clientDisplayName, safeLogoUri } from '@/components/features/settings/consent-client'
import { assistantKind, declaredDomain } from '@/components/features/settings/use-assistant-connections'
import { putAccess, useAiAccessGrants, useMyCompanies } from '@/components/features/settings/use-ai-access'

type PublicClient = { client_name?: string; client_uri?: string; logo_uri?: string }

const SCOPE_LABELS: Record<string, string> = {
  openid: 'Vous identifier',
  profile: 'Voir votre nom',
  email: 'Voir votre adresse email',
  offline_access: 'Rester connecté sans vous redemander votre accord',
  [READ_SCOPE]: 'Consulter votre comptabilité : sociétés, comptes, écritures, états, transactions, échéances',
  [WRITE_SCOPE]: 'Préparer des brouillons (écritures, notes de frais, budget, provisions), que vous vérifierez vous-même',
  [ADMIN_SCOPE]: 'Agir comme vous : valider, rapprocher, importer, clôturer, dans la limite de vos droits',
}

function redirectTarget(data: unknown): string | null {
  const d = data as { redirect_uri?: string; url?: string; uri?: string } | null
  return d?.redirect_uri ?? d?.url ?? d?.uri ?? null
}

/** Host of a URL, or null when it doesn't parse. */
function hostOf(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).host || null
  } catch {
    return null
  }
}

/**
 * Clients identified by a metadata document URL (CIMD) are vouched for by the
 * domain serving that document. Every other client registered itself through
 * open dynamic registration (RFC 7591): its name and logo are self-declared.
 */
function cimdHost(clientId: string): string | null {
  return clientId.startsWith('https://') ? hostOf(clientId) : null
}

/**
 * Public fields of the client. The session endpoint is tried first, then the
 * pre-login one (it reads the signed OAuth query the client plugin adds), so
 * a missing or stale session cookie does not leave the client unnamed.
 */
async function loadClient(clientId: string): Promise<PublicClient | null> {
  const viaSession = await authClient
    .$fetch<PublicClient>('/oauth2/public-client', { query: { client_id: clientId } })
    .catch(() => null)
  if (viaSession?.data) return viaSession.data
  const prelogin = await authClient
    .$fetch<PublicClient>('/oauth2/public-client-prelogin', { method: 'POST', body: { client_id: clientId } })
    .catch(() => null)
  return prelogin?.data ?? null
}

function ConsentForm() {
  const params = useSearchParams()
  const clientId = params.get('client_id') ?? ''
  // Where the authorization code will be sent: the one fact the user must check.
  const redirectHost = hostOf(params.get('redirect_uri'))
  const identifiedBy = cimdHost(clientId)
  const requestedScopes = (params.get('scope') ?? '').split(' ').filter(Boolean)
  // The user may lower what the assistant asked for, never raise it; full
  // control is offered only when asked for, and never preselected.
  const levels = availableLevels(requestedScopes)
  const [level, setLevel] = useState<AccessLevel>(defaultLevel(requestedScopes))
  const scopes = scopesForLevel(requestedScopes, level)
  const [client, setClient] = useState<PublicClient | null>(null)
  const [loading, setLoading] = useState<'accept' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { data: session } = authClient.useSession()
  const { companies, loading: companiesLoading, error: companiesError } = useMyCompanies()
  const grants = useAiAccessGrants()
  // Every company by default, so the usual flow is one click; a reconnected
  // assistant starts from the companies it had, if the user still has them.
  const [chosen, setChosen] = useState<CompanyAccess | null>(null)
  const [accessMessage, setAccessMessage] = useState<string | null>(null)
  const accessibleIds = companiesLoading || companiesError ? null : companies.map((c) => c.id)
  const access = chosen ?? startingAccess(grants.assistants.get(clientId), accessibleIds)
  // Full control only: automatic by default (owner's choice), or the mode a previous grant had.
  const [chosenMode, setChosenMode] = useState<ExecutionMode | null>(null)
  const executionMode = chosenMode ?? grants.assistants.get(clientId)?.executionMode ?? 'automatic'

  // Branding only for a verified identity (CIMD document on claude.ai or chatgpt.com).
  const kind = assistantKind(clientId, client)
  const name = clientDisplayName(client?.client_name, kind, identifiedBy)
  const unverified = kind === 'other' && !identifiedBy
  const declaredName = client?.client_name?.trim() || null
  const declaredHost = declaredDomain(client)
  const logo = kind === 'other' ? safeLogoUri(client?.logo_uri, identifiedBy) : null

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    loadClient(clientId).then((data) => {
      if (!cancelled) setClient(data)
    })
    return () => {
      cancelled = true
    }
  }, [clientId])

  async function decide(accept: boolean) {
    setError(null)
    if (accept) {
      const invalid = accessError(access)
      if (invalid) {
        setAccessMessage(invalid)
        return
      }
    }
    setLoading(accept ? 'accept' : 'deny')
    if (accept) {
      // The grant is saved first: the assistant never gets a token for more
      // companies than chosen here.
      try {
        await putAccess('/api/ai-access/assistants', {
          clientId,
          access: { allCompanies: access.allCompanies, companyIds: access.companyIds },
          ...(level === 'admin' && { executionMode }),
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : "L'accès n'a pas pu être enregistré. Réessayez.")
        setLoading(null)
        return
      }
    }
    // Better Auth issues the code, then the tokens, for the accepted scopes
    // only: a narrower `scope` here is what the assistant gets.
    const narrowed = accept && scopes.length < requestedScopes.length
    const { data, error: consentError } = await authClient.oauth2.consent({
      accept,
      ...(narrowed && { scope: scopes.join(' ') }),
    })
    const target = redirectTarget(data)
    if (consentError || !target) {
      setError(consentError?.message ?? "La demande d'accès a expiré. Relancez la connexion depuis votre assistant.")
      setLoading(null)
      return
    }
    window.location.href = target
  }

  const whatItCanDo =
    level === 'admin'
      ? ' et agir comme vous : valider des écritures, rapprocher, importer, clôturer un exercice...'
      : level === 'write'
        ? " et préparer des brouillons (écritures, notes de frais, budget, provisions, données de l'approbation des comptes), que vous vérifierez vous-même dans Kledg."
        : ", sans pouvoir proposer d'écritures."

  return (
    <Card>
      <CardHeader>
        <div className="bg-muted mb-2 flex size-10 items-center justify-center rounded-lg">
          {logo ? (
            // Remote logo of a CIMD client: https raster only, fixed size, no referrer.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" width={24} height={24} referrerPolicy="no-referrer" className="size-6 object-contain" />
          ) : (
            <AssistantLogo kind={kind} className="size-5" />
          )}
        </div>
        <CardTitle>
          <h1>{unverified ? "Une application non vérifiée demande l'accès à votre comptabilité" : `${name} demande l'accès à votre comptabilité`}</h1>
        </CardTitle>
        <div className="bg-muted rounded-md px-3 py-2 text-sm">
          <span className="text-muted-foreground">Vous serez redirigé vers </span>
          <span className="font-semibold break-all">{redirectHost ?? 'une adresse inconnue'}</span>
        </div>
        <CardDescription>
          En autorisant l&apos;accès, {unverified ? 'cette application' : name} pourra consulter les sociétés que vous choisissez
          ci-dessous (comptes, écritures, états, transactions, échéances){whatItCanDo}
        </CardDescription>
        {session?.user?.email && (
          <p className="text-muted-foreground text-xs">
            Connecté en tant que <span className="text-foreground font-medium">{session.user.email}</span>.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {identifiedBy ? (
          <p className="text-muted-foreground text-xs">
            Application identifiée par le domaine <span className="font-medium">{identifiedBy}</span>.
          </p>
        ) : (
          <Alert>
            <TriangleAlert className="size-4" />
            <AlertDescription>
              <span className="font-medium">Application non vérifiée.</span>{' '}
              {declaredName ? <>Elle se présente comme « {declaredName} »{declaredHost ? <> ({declaredHost})</> : null}, mais </> : null}
              son nom et son domaine sont déclarés par l&apos;application elle-même : Kledg ne peut pas confirmer
              qu&apos;il s&apos;agit de Claude, de ChatGPT ou d&apos;un autre assistant. N&apos;autorisez l&apos;accès
              que si vous venez de connecter votre assistant à Kledg et que l&apos;adresse de redirection ci-dessus
              correspond bien à cet assistant.
            </AlertDescription>
          </Alert>
        )}
        {scopes.length > 0 && (
          <ul className="text-muted-foreground list-inside list-disc space-y-1 text-sm">
            {scopes.map((s) => (
              <li key={s}>{SCOPE_LABELS[s] ?? s}</li>
            ))}
          </ul>
        )}
        {levels.length > 1 && (
          <AccessLevelPicker
            value={level}
            onChange={setLevel}
            levels={ACCESS_LEVELS.filter((l) => levels.includes(l))}
            disabled={loading !== null}
          />
        )}
        {level === 'admin' && <ExecutionModePicker value={executionMode} onChange={setChosenMode} disabled={loading !== null} />}
        <CompanyAccessPicker
          companies={companies}
          loading={companiesLoading}
          loadFailed={companiesError}
          value={access}
          onChange={(next) => {
            setChosen(next)
            setAccessMessage(null)
          }}
          disabled={loading !== null}
          error={accessMessage ?? undefined}
        />
        {client?.client_uri && !unverified && (
          <p className="text-muted-foreground text-xs">Application : {client.client_uri}</p>
        )}
        <p className="text-muted-foreground text-xs">
          Vous pourrez modifier les sociétés et le mode d&apos;exécution, réduire l&apos;accès ou le révoquer à tout
          moment depuis la page Assistants IA de Kledg.
        </p>
      </CardContent>
      <CardFooter className="flex gap-2 pt-2">
        <Button variant="outline" className="flex-1" disabled={loading !== null} onClick={() => decide(false)}>
          {loading === 'deny' ? 'Refus...' : 'Refuser'}
        </Button>
        <Button className="flex-1" disabled={loading !== null} onClick={() => decide(true)}>
          {loading === 'accept' ? 'Autorisation...' : 'Autoriser'}
        </Button>
      </CardFooter>
    </Card>
  )
}

export default function ConsentPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <ConsentForm />
      </Suspense>
    </AuthShell>
  )
}
