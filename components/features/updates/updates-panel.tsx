'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleArrowUp, Copy, Database, ExternalLink, HelpCircle, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared'
import { MANUAL_UPDATE_COMMANDS, PLATFORM_LABELS, type Platform } from '@/lib/updates/hosting'
import type { UpdateOverview } from '@/lib/updates/overview'
import { formatDate, formatDateTime, SELF_HOSTING_DOCS_URL, updatesApi } from './api'
import { GitHubConnect } from './github-connect'
import { ReleaseNotes } from './release-notes'
import { UpdateActions } from './update-actions'

function StateBadge({ state }: { state: UpdateOverview['state'] }) {
  if (state === 'available') {
    return (
      <Badge>
        <CircleArrowUp />
        Mise à jour disponible
      </Badge>
    )
  }
  if (state === 'up-to-date' || state === 'ahead') {
    return (
      <Badge variant="secondary">
        <CheckCircle2 />
        À jour
      </Badge>
    )
  }
  return (
    <Badge variant="outline">
      <HelpCircle />
      Statut inconnu
    </Badge>
  )
}

export function UpdatesPanel() {
  const [overview, setOverview] = useState<UpdateOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setOverview(await updatesApi<UpdateOverview>('/api/updates'))
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(load, 0)
    return () => clearTimeout(timer)
  }, [load])

  return (
    <div className="w-full max-w-3xl space-y-6">
      <PageHeader title="Mises à jour" description="Version de votre instance et nouveautés de Kledg." />

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!overview && !error && (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {overview && <Overview overview={overview} onChange={load} />}
    </div>
  )
}

function Overview({ overview, onChange }: { overview: UpdateOverview; onChange: () => void }) {
  const { current, latest, state } = overview
  const repo = current.repository
  const commitUrl = repo && current.commit ? `https://github.com/${repo.owner}/${repo.repo}/commit/${current.commit}` : null
  const migrations = overview.migrations?.names ?? []

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Kledg {current.version}
            <StateBadge state={state} />
          </CardTitle>
          <CardDescription>
            {state === 'available' && latest
              ? `La version ${latest.version} est disponible${latest.publishedAt ? ` depuis le ${formatDate(latest.publishedAt)}` : ''}.`
              : state === 'ahead' && latest
                ? `Votre instance suit une version plus récente que la dernière publiée (${latest.version}).`
                : state === 'up-to-date'
                  ? 'Vous utilisez la dernière version publiée.'
                  : (overview.releasesError ?? "Aucune version de Kledg n'est encore publiée.")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">Version installée</dt>
            <dd>{current.version}</dd>
            <dt className="text-muted-foreground">Dernière version</dt>
            <dd>{latest ? latest.version : 'Inconnue'}</dd>
            <dt className="text-muted-foreground">Commit déployé</dt>
            <dd className="font-mono">
              {current.commit ? (
                commitUrl ? (
                  <a href={commitUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                    {current.commit.slice(0, 7)}
                  </a>
                ) : (
                  current.commit.slice(0, 7)
                )
              ) : (
                <span className="text-muted-foreground font-sans">Inconnu</span>
              )}
              {current.branch && <span className="text-muted-foreground font-sans"> (branche {current.branch})</span>}
            </dd>
            <dt className="text-muted-foreground">Construite le</dt>
            <dd>{formatDateTime(current.buildDate) ?? 'Inconnu'}</dd>
            <dt className="text-muted-foreground">Hébergement</dt>
            <dd>{PLATFORM_LABELS[current.platform]}</dd>
          </dl>
        </CardContent>
      </Card>

      {overview.notes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Nouveautés depuis votre version</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {overview.notes.map((release) => (
              <section key={release.tag} className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-semibold">{release.name}</h2>
                  <a
                    href={release.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground inline-flex items-center gap-1 text-xs underline underline-offset-4"
                  >
                    {formatDate(release.publishedAt) ?? release.tag}
                    <ExternalLink className="size-3" />
                  </a>
                </div>
                <ReleaseNotes markdown={release.body} />
              </section>
            ))}
          </CardContent>
        </Card>
      )}

      {state === 'available' && overview.migrations && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="size-4" />
              Base de données
            </CardTitle>
            <CardDescription>
              {overview.migrations.error
                ? overview.migrations.error
                : migrations.length
                  ? "La mise à jour applique ces migrations pendant le déploiement. Elles ne font qu'ajouter\u00a0: aucune donnée n'est supprimée."
                  : 'Cette mise à jour ne modifie pas la base de données.'}
            </CardDescription>
          </CardHeader>
          {migrations.length > 0 && (
            <CardContent>
              <ul className="bg-muted list-disc space-y-1 rounded-md py-3 pr-3 pl-8 font-mono text-xs break-all">
                {migrations.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>
      )}

      {overview.managementRefused ? (
        <Alert>
          <AlertDescription>{overview.managementRefused}</AlertDescription>
        </Alert>
      ) : current.deploysFromGitHub ? (
        <>
          <GitHubConnect detected={repo} connection={overview.connection} platform={current.platform} onChange={onChange} />
          {overview.connection && !overview.connection.expired && (
            <UpdateActions
              platform={current.platform}
              isFork={overview.connection.kind === 'fork'}
              previousCommit={current.commit}
              overviewMigrations={migrations}
              upToDate={state === 'up-to-date' || state === 'ahead'}
            />
          )}
        </>
      ) : (
        <ManualUpdate platform={current.platform} />
      )}
    </>
  )
}

function ManualTitle({ platform }: { platform: Platform }) {
  if (platform === 'docker') return <>Mettre à jour avec Docker</>
  if (platform === 'node') return <>Mettre à jour à la main</>
  return <>Mettre à jour sur {PLATFORM_LABELS[platform]}</>
}

function ManualUpdate({ platform }: { platform: Platform }) {
  const commands = MANUAL_UPDATE_COMMANDS[platform]
  const host = PLATFORM_LABELS[platform]
  const onServer = platform === 'docker' || platform === 'node'
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(commands)
      toast.success('Commandes copiées')
    } catch {
      toast.error('Copie impossible : sélectionnez le texte.')
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="size-4" />
          <ManualTitle platform={platform} />
        </CardTitle>
        <CardDescription>
          {onServer
            ? "Cette instance n'est pas redéployée depuis GitHub : lancez ces commandes sur le serveur, dans le dossier du dépôt."
            : `Mettez à jour votre dépôt puis redéployez sur ${host}. Si ${host} redéploie votre dépôt GitHub à chaque fusion, définissez KLEDG_DEPLOYS_FROM_GITHUB=true pour mettre à jour depuis cette page.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <pre className="bg-muted overflow-x-auto rounded-md p-4 pr-12 font-mono text-xs leading-relaxed">{commands}</pre>
          <Button size="icon-sm" variant="ghost" className="absolute top-2 right-2" onClick={copy} title="Copier">
            <Copy />
            <span className="sr-only">Copier les commandes</span>
          </Button>
        </div>
        {platform === 'docker' || platform === 'coolify' ? (
          <Alert>
            <Database />
            <AlertDescription>
              Au démarrage, le conteneur sauvegarde la base avec pg_dump (dossier /app/backups, 5 dernières sauvegardes) dès
              qu&apos;il y a des migrations à appliquer, puis les applique. Montez ce dossier sur un volume pour garder les
              sauvegardes.
            </AlertDescription>
          </Alert>
        ) : platform === 'node' ? (
          <Alert>
            <AlertTriangle />
            <AlertDescription>Sauvegardez la base (pg_dump) avant pnpm db:migrate si la mise à jour annonce des migrations.</AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertTriangle />
            <AlertDescription>
              Les migrations s&apos;appliquent au déploiement. Si la mise à jour en annonce, vérifiez d&apos;abord la dernière
              sauvegarde de la base chez {host} (ou faites un pg_dump).
            </AlertDescription>
          </Alert>
        )}
        <a href={SELF_HOSTING_DOCS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm underline underline-offset-4 pointer-coarse:-my-3 pointer-coarse:py-3">
          Guide de mise à jour
          <ExternalLink className="size-3" />
        </a>
      </CardContent>
    </Card>
  )
}
