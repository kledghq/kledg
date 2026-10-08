'use client'

import { useState } from 'react'
import { AlertTriangle, ExternalLink, Github, Loader2, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import type { ConnectionSummary } from '@/lib/updates/connection'
import type { RepoRef } from '@/lib/updates/github'
import { GITHUB_DEPLOY_NOTES, type Platform } from '@/lib/updates/hosting'
import { TOKEN_EXPIRY_DAYS, tokenCreationUrl } from '@/lib/updates/token-url'
import { formatDate, updatesApi } from './api'

const PERMISSIONS: Array<[string, string]> = [
  ['Contents', 'Read and write'],
  ['Pull requests', 'Read and write'],
  ['Actions', 'Read and write'],
  ['Variables', 'Read and write'],
  ['Workflows', 'Read and write'],
  ['Deployments', 'Read-only'],
  ['Metadata', 'Read-only (ajoutée automatiquement)'],
]

export function GitHubConnect({
  detected,
  connection,
  platform,
  onChange,
}: {
  detected: RepoRef | null
  connection: ConnectionSummary | null
  platform: Platform
  onChange: () => void
}) {
  if (connection) return <ConnectedCard connection={connection} onChange={onChange} />
  return <ConnectForm detected={detected} platform={platform} onChange={onChange} />
}

function ConnectedCard({ connection, onChange }: { connection: ConnectionSummary; onChange: () => void }) {
  const [busy, setBusy] = useState(false)

  const disconnect = async () => {
    setBusy(true)
    try {
      await updatesApi('/api/updates/connection', { method: 'DELETE' })
      toast.success('GitHub déconnecté. Pensez à supprimer le jeton sur GitHub.')
      onChange()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Github className="size-4" />
          Connexion GitHub
          <Badge variant="secondary">{connection.kind === 'fork' ? 'Fork de kledghq/kledg' : 'Copie de kledghq/kledg'}</Badge>
        </CardTitle>
        <CardDescription>
          Dépôt{' '}
          <a
            className="font-medium underline underline-offset-4"
            href={`https://github.com/${connection.owner}/${connection.repo}`}
            target="_blank"
            rel="noreferrer"
          >
            {connection.owner}/{connection.repo}
          </a>{' '}
          (branche {connection.defaultBranch})
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">Jeton</dt>
          <dd className="font-mono">github_pat_••••{connection.tokenLast4}</dd>
          <dt className="text-muted-foreground">Expiration</dt>
          <dd>{connection.tokenExpiresAt ? formatDate(connection.tokenExpiresAt) : 'Aucune'}</dd>
        </dl>

        {(connection.expired || connection.expiresSoon) && (
          <Alert variant={connection.expired ? 'destructive' : 'default'}>
            <AlertTriangle />
            <AlertDescription>
              {connection.expired
                ? 'Le jeton a expiré\u00a0: créez-en un nouveau puis reconnectez GitHub.'
                : `Le jeton expire le ${formatDate(connection.tokenExpiresAt)}. Régénérez-le sur GitHub (Regenerate token) puis reconnectez GitHub.`}
            </AlertDescription>
          </Alert>
        )}

        {connection.tokenReachesOtherRepos && (
          <Alert>
            <AlertTriangle />
            <AlertDescription>
              Ce jeton donne aussi accès à d&apos;autres dépôts que {connection.owner}/{connection.repo}. Sur GitHub, dans « Repository access », choisissez « Only select repositories » puis ce seul dépôt, et reconnectez GitHub.
            </AlertDescription>
          </Alert>
        )}

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Unplug />}
              Déconnecter
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Déconnecter GitHub&nbsp;?</AlertDialogTitle>
              <AlertDialogDescription>
                Kledg oublie le jeton. Les mises à jour restent possibles depuis GitHub. Supprimez aussi le jeton dans vos
                réglages GitHub (Settings, Developer settings, Personal access tokens).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={disconnect}>Déconnecter</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}

function ConnectForm({ detected, platform, onChange }: { detected: RepoRef | null; platform: Platform; onChange: () => void }) {
  const [owner, setOwner] = useState('')
  const [repo, setRepo] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const targetOwner = detected?.owner ?? owner
  const url = tokenCreationUrl(targetOwner || null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await updatesApi('/api/updates/connection', {
        method: 'POST',
        body: detected ? { token } : { token, owner, repo },
      })
      setToken('')
      toast.success('GitHub connecté.')
      onChange()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Github className="size-4" />
          Connecter GitHub
        </CardTitle>
        <CardDescription>
          Facultatif. Avec un jeton limité à votre dépôt, Kledg prépare et installe les mises à jour depuis cette page. Sans
          jeton, elles arrivent chaque lundi sous forme de pull request sur GitHub. {GITHUB_DEPLOY_NOTES[platform]}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ol className="space-y-4 text-sm">
          <li className="space-y-2">
            <p>
              <span className="font-medium">1. Créez le jeton sur GitHub.</span> Le lien ouvre le formulaire déjà rempli&nbsp;: nom
              « Kledg updates », expiration {TOKEN_EXPIRY_DAYS} jours et permissions minimales.
            </p>
            <Button asChild size="sm">
              <a href={url} target="_blank" rel="noreferrer">
                Créer le jeton sur GitHub
                <ExternalLink />
              </a>
            </Button>
          </li>
          <li className="space-y-1">
            <p>
              <span className="font-medium">2. Limitez-le à votre dépôt.</span> Dans « Repository access », choisissez « Only
              select repositories » puis{' '}
              {detected ? (
                <span className="font-mono">
                  {detected.owner}/{detected.repo}
                </span>
              ) : (
                'le dépôt de votre instance'
              )}
              . GitHub ne permet pas de présélectionner le dépôt.
            </p>
          </li>
          <li className="space-y-2">
            <p>
              <span className="font-medium">3. Vérifiez les permissions</span> (section « Repository permissions »), puis
              cliquez sur « Generate token »&nbsp;:
            </p>
            <ul className="text-muted-foreground grid gap-1 sm:grid-cols-2">
              {PERMISSIONS.map(([name, level]) => (
                <li key={name}>
                  <span className="text-foreground font-medium">{name}</span> : {level}
                </li>
              ))}
            </ul>
          </li>
          <li>
            <p>
              <span className="font-medium">4. Collez le jeton ci-dessous.</span> Il est vérifié puis chiffré&nbsp;; il ne sera plus
              jamais affiché.
            </p>
          </li>
        </ol>

        <form onSubmit={submit} className="space-y-4">
          {detected ? (
            <p className="text-muted-foreground text-sm">
              Dépôt détecté&nbsp;:{' '}
              <span className="text-foreground font-mono">
                {detected.owner}/{detected.repo}
              </span>
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="gh-owner">Propriétaire du dépôt</Label>
                <Input id="gh-owner" placeholder="mon-compte" value={owner} onChange={(e) => setOwner(e.target.value)} autoComplete="off" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gh-repo">Nom du dépôt</Label>
                <Input id="gh-repo" placeholder="kledg" value={repo} onChange={(e) => setRepo(e.target.value)} autoComplete="off" />
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="gh-token">Jeton GitHub</Label>
            <Input
              id="gh-token"
              type="password"
              placeholder="github_pat_..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={busy || !token || (!detected && (!owner || !repo))}>
            {busy && <Loader2 className="animate-spin" />}
            Vérifier et connecter
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
