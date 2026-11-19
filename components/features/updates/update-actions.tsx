'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, Rocket } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { GITHUB_DEPLOY_NOTES, PLATFORM_LABELS, type Platform } from '@/lib/updates/hosting'
import type { Channel, UpdateBranch, UpdatePull, WorkflowRun } from '@/lib/updates/service'
import { formatDateTime, NEON_BRANCHING_URL, SELF_HOSTING_DOCS_URL, updatesApi } from './api'

interface GitHubState {
  /** null: the token lacks the Variables permission, the workflow then follows releases. */
  channel: Channel | null
  /** owner/repo of the instance's repository. */
  repository: string
  workflow: { present: boolean; state: string | null; current: boolean }
  run: WorkflowRun | null
  pull: UpdatePull | null
  /** Prepared without its pull request (GitHub did not let the workflow open it): installing opens it. */
  branch?: UpdateBranch | null
}

type PrepareResult = { mode: 'workflow'; workflowInstalled: boolean; dispatchedAt: string } | { mode: 'merge-upstream' }

const CHANNEL_LABELS: Record<Channel, string> = {
  releases: 'Versions publiées (recommandé)',
  main: 'Branche principale (tests)',
  off: 'Désactivé',
}

const RUN_LABELS: Record<string, string> = {
  queued: 'en attente',
  in_progress: 'en cours',
  completed: 'terminée',
  waiting: 'en attente',
  requested: 'demandée',
  pending: 'en attente',
}

function runLabel(run: WorkflowRun): string {
  if (run.status !== 'completed') return `Préparation ${RUN_LABELS[run.status] ?? 'en cours'}`
  if (run.conclusion === 'success') return 'Préparation terminée'
  if (run.conclusion === 'cancelled') return 'Préparation annulée'
  return 'Préparation en échec'
}

const PREVIEW_LABELS: Record<string, string> = {
  success: 'prêt',
  pending: 'en construction',
  in_progress: 'en construction',
  queued: 'en construction',
  failure: 'en échec',
  error: 'en échec',
  inactive: 'remplacé',
}

export function UpdateActions({
  platform,
  isFork,
  previousCommit,
  overviewMigrations,
  upToDate = false,
}: {
  platform: Platform
  isFork: boolean
  previousCommit: string | null
  overviewMigrations: string[]
  /** The instance already runs the latest version of its channel (the overview's state). */
  upToDate?: boolean
}) {
  const [state, setState] = useState<GitHubState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'prepare' | 'install' | 'channel' | null>(null)
  const [mergeUpstreamMode, setMergeUpstreamMode] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deploying, setDeploying] = useState<{ sha: string | null; since: number } | null>(null)
  const [deployed, setDeployed] = useState<string | null>(null)
  const [pollUntil, setPollUntil] = useState(0)

  const load = useCallback(async () => {
    try {
      const data = await updatesApi<GitHubState>('/api/updates/github')
      setState(data)
      setLoadError(null)
      return data
    } catch (error) {
      setLoadError((error as Error).message)
      return null
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(async () => {
      const data = await load()
      // A preparation or preview already in progress: follow it.
      if ((data?.run && data.run.status !== 'completed') || data?.pull?.preview?.state === 'pending') {
        setPollUntil(Date.now() + 5 * 60 * 1000)
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [load])

  // While the workflow runs (or the preview builds), refresh every 5 seconds for up to 5 minutes.
  useEffect(() => {
    if (!state) return
    const running = state.run && state.run.status !== 'completed'
    const building = state.pull?.preview && !['success', 'failure', 'error', 'inactive'].includes(state.pull.preview.state ?? '')
    const waitingForPull = !state.pull && pollUntil > 0
    if (!(running || building || waitingForPull) || Date.now() > pollUntil) return
    const timer = setTimeout(load, 5000)
    return () => clearTimeout(timer)
  }, [state, load, pollUntil])

  // After the merge, wait for the new deployment to answer with the new commit.
  useEffect(() => {
    if (!deploying) return
    let stopped = false
    const tick = async () => {
      try {
        const version = await updatesApi<{ version: string; commit: string | null }>('/api/updates/version')
        const done = deploying.sha ? version.commit === deploying.sha : version.commit !== previousCommit
        if (done) {
          setDeploying(null)
          setDeployed(version.version)
          return
        }
      } catch {
        // The instance may restart while it deploys: keep polling.
      }
      if (!stopped && Date.now() - deploying.since < 20 * 60 * 1000) setTimeout(tick, 10_000)
    }
    const timer = setTimeout(tick, 10_000)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [deploying, previousCommit])

  const prepare = async () => {
    setBusy('prepare')
    try {
      const result = await updatesApi<PrepareResult>('/api/updates/prepare', { method: 'POST' })
      if (result.mode === 'merge-upstream') {
        setMergeUpstreamMode(true)
        toast.info('Votre fork peut être synchronisé directement avec Kledg.')
      } else {
        toast.success(
          result.workflowInstalled
            ? 'Kledg a ajouté son outil de mise à jour à votre dépôt et lancé la préparation. La nouvelle version est prête dans une minute environ.'
            : 'Préparation lancée sur GitHub. La nouvelle version est prête dans une minute environ.',
        )
        setPollUntil(Date.now() + 5 * 60 * 1000)
        setTimeout(load, 4000)
      }
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const install = async () => {
    setBusy('install')
    try {
      const body = state?.pull
        ? { mode: 'pull', pullNumber: state.pull.number, headSha: state.pull.headSha, confirm: true }
        : state?.branch
          ? { mode: 'branch', headSha: state.branch.headSha, confirm: true }
          : { mode: 'merge-upstream', confirm: true }
      const result = await updatesApi<{ sha: string | null }>('/api/updates/install', { method: 'POST', body })
      setConfirmOpen(false)
      setDeploying({ sha: result.sha, since: Date.now() })
    } catch (error) {
      toast.error((error as Error).message)
      setConfirmOpen(false)
    } finally {
      setBusy(null)
    }
  }

  const changeChannel = async (channel: Channel) => {
    setBusy('channel')
    try {
      await updatesApi('/api/updates/channel', { method: 'PUT', body: { channel } })
      setState((s) => (s ? { ...s, channel } : s))
      toast.success('Canal de mise à jour enregistré.')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const host = platform === 'docker' || platform === 'node' ? 'votre hébergeur' : PLATFORM_LABELS[platform]
  const Host = host.charAt(0).toUpperCase() + host.slice(1)
  const pull = state?.pull ?? null
  const branch = pull ? null : (state?.branch ?? null)
  const ready = pull ?? branch
  const migrations = ready ? ready.migrations : overviewMigrations
  const canInstall = Boolean(ready) || mergeUpstreamMode

  if (deployed) {
    return (
      <Alert>
        <CheckCircle2 />
        <AlertDescription className="flex flex-wrap items-center gap-3">
          <span>Kledg {deployed} est installé.</span>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            Recharger la page
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (deploying) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            Déploiement en cours
          </CardTitle>
          <CardDescription>
            {Host} construit la nouvelle version et applique les migrations. Cela prend généralement quelques minutes&nbsp;; cette page
            se met à jour toute seule.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rocket className="size-4" />
          Installer une nouvelle version
        </CardTitle>
        <CardDescription>
          En deux étapes, depuis cette page. Rien ne change pour les utilisateurs de Kledg avant la seconde.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loadError && (
          <Alert variant="destructive">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        <ol className="space-y-6">
          <li className="space-y-3" data-slot="update-step-prepare">
            <div className="space-y-1">
              <h3 className="text-sm font-medium">1. Préparer</h3>
              <p className="text-muted-foreground text-sm">
                {mergeUpstreamMode
                  ? 'Votre fork n\u2019a pas l\u2019outil de mise à jour de Kledg\u00a0: rien à préparer, l\u2019installation l\u2019aligne directement sur Kledg (comme « Sync fork » sur GitHub), sans aperçu.'
                  : 'GitHub rassemble la nouvelle version dans votre dépôt, à côté de celle en service. Votre hébergeur peut en construire un aperçu à essayer.'}
              </p>
            </div>

            {state && !state.workflow.present && !isFork && (
              <p className="text-muted-foreground text-sm">
                Première fois&nbsp;: « Préparer » ajoute d&apos;abord à votre dépôt l&apos;outil de mise à jour de Kledg (un workflow GitHub
                Actions). {Host} redéploie alors la même version, sans changement.
              </p>
            )}

            {state?.run && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant={state.run.conclusion === 'failure' ? 'destructive' : 'secondary'}>{runLabel(state.run)}</Badge>
                <span className="text-muted-foreground">{formatDateTime(state.run.createdAt)}</span>
                <a href={state.run.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">
                  Journal sur GitHub
                  <ExternalLink className="size-3" />
                </a>
              </div>
            )}

            {state?.run && state.run.status === 'completed' && state.run.conclusion === 'success' && !ready && !mergeUpstreamMode && (
              <p className="text-muted-foreground text-sm" data-slot="prepare-no-pull">
                {upToDate
                  ? 'Rien à installer\u00a0: votre instance contient déjà la dernière version.'
                  : 'La préparation n\u2019a produit aucune version à installer\u00a0: le journal sur GitHub dit pourquoi.'}
              </p>
            )}

            {ready && (
              <div className="space-y-2 rounded-lg border p-4 text-sm" data-slot="update-ready">
                <div className="flex flex-wrap items-center gap-2">
                  <CheckCircle2 className="size-4" />
                  <span className="font-medium">
                    Version prête&nbsp;: {pull ? pull.title : branch?.label ? `Kledg ${branch.label}` : 'nouvelle version de Kledg'}
                  </span>
                  <a
                    href={pull ? pull.url : branch?.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground inline-flex items-center gap-1 underline underline-offset-4"
                  >
                    {pull ? `voir sur GitHub (#${pull.number})` : 'voir sur GitHub'}
                    <ExternalLink className="size-3" />
                  </a>
                  {pull?.mergeable === false && <Badge variant="destructive">Conflits</Badge>}
                </div>
                {pull?.mergeable === false && (
                  <p className="text-destructive">
                    Elle entre en conflit avec des modifications de votre dépôt&nbsp;: résolvez-les sur GitHub, puis préparez de nouveau.
                  </p>
                )}
                {branch && (
                  <div className="text-muted-foreground space-y-1" data-slot="update-branch-note">
                    <p>
                      GitHub n&apos;a pas proposé cette version lui-même&nbsp;: les réglages de votre{' '}
                      {branch.settings.organization ? 'organisation' : 'dépôt'} l&apos;interdisent sans doute. Kledg la proposera au
                      moment de l&apos;installer, rien à faire de plus.
                    </p>
                    <p>
                      Pour que GitHub la propose lui-même la prochaine fois, cochez «&nbsp;Allow GitHub Actions to create and approve
                      pull requests&nbsp;» (section Workflow permissions, puis Save)&nbsp;:{' '}
                      {branch.settings.organization ? (
                        <>
                          <a
                            href={branch.settings.organization.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-foreground underline underline-offset-4"
                          >
                            réglages de l&apos;organisation {branch.settings.organization.name}
                          </a>{' '}
                          (réservés à ses propriétaires), puis{' '}
                          <a href={branch.settings.repositoryUrl} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">
                            réglages du dépôt
                          </a>{' '}
                          si la case y est encore décochée.
                        </>
                      ) : (
                        <a href={branch.settings.repositoryUrl} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">
                          réglages du dépôt
                        </a>
                      )}
                    </p>
                  </div>
                )}
                {ready.preview && (
                  <p className="text-muted-foreground">
                    Aperçu&nbsp;: {PREVIEW_LABELS[ready.preview.state ?? 'pending'] ?? 'en construction'}
                    {ready.preview.url && (
                      <>
                        {' · '}
                        <a href={ready.preview.url} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">
                          essayer cette version
                        </a>
                      </>
                    )}
                  </p>
                )}
                <p className="text-muted-foreground">
                  {ready.migrations.length
                    ? `${ready.migrations.length} migration${ready.migrations.length > 1 ? 's' : ''} de la base`
                    : 'Aucune migration de la base'}
                </p>
              </div>
            )}

            {!mergeUpstreamMode && (
              <div className="flex flex-wrap gap-2">
                <Button variant={canInstall ? 'outline' : 'default'} onClick={prepare} disabled={busy !== null || state?.channel === 'off'}>
                  {busy === 'prepare' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  {ready ? 'Préparer de nouveau' : 'Préparer la mise à jour'}
                </Button>
                <Button variant="ghost" onClick={() => load()} disabled={busy !== null}>
                  Rafraîchir
                </Button>
              </div>
            )}
          </li>

          <li className="space-y-3" data-slot="update-step-install">
            <div className="space-y-1">
              <h3 className="text-sm font-medium">2. Installer</h3>
              <p className="text-muted-foreground text-sm">
                La nouvelle version remplace celle en service. {GITHUB_DEPLOY_NOTES[platform]}
              </p>
            </div>
            <Button onClick={() => setConfirmOpen(true)} disabled={busy !== null || !canInstall || pull?.mergeable === false}>
              <Rocket />
              Installer la mise à jour
            </Button>
            {!canInstall && <p className="text-muted-foreground text-xs">Disponible une fois la version préparée.</p>}
          </li>
        </ol>

        <div className="grid gap-2 border-t pt-5 sm:max-w-sm">
          <Label htmlFor="update-channel">Versions à suivre</Label>
          {state?.channel === null ? (
            <div className="space-y-2 text-sm">
              <p>{CHANNEL_LABELS.releases}</p>
              <p className="text-muted-foreground">
                C&apos;est le réglage par défaut. Pour en changer depuis cette page, ajoutez la permission{' '}
                <span className="font-medium">Variables</span> (Read and write) à votre{' '}
                <a
                  href="https://github.com/settings/personal-access-tokens"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4"
                >
                  jeton GitHub
                </a>
                , puis rafraîchissez. Ou définissez directement la variable{' '}
                <code className="bg-muted rounded px-1">KLEDG_UPDATES</code> (releases, main ou off) dans les{' '}
                <a
                  href={`https://github.com/${state.repository}/settings/variables/actions`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4"
                >
                  variables du dépôt
                </a>
                .
              </p>
            </div>
          ) : (
            <Select
              value={state?.channel ?? undefined}
              onValueChange={(value) => changeChannel(value as Channel)}
              disabled={!state || busy !== null}
            >
              <SelectTrigger id="update-channel" className="w-full">
                <SelectValue placeholder="Chargement..." />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CHANNEL_LABELS) as Channel[]).map((c) => (
                  <SelectItem key={c} value={c}>
                    {CHANNEL_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <AlertDialog open={confirmOpen} onOpenChange={(open) => busy !== 'install' && setConfirmOpen(open)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Installer la mise à jour&nbsp;?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-sm">
                  {migrations.length ? (
                    <>
                      <p>Le déploiement appliquera ces migrations à la base de données&nbsp;:</p>
                      <ul className="bg-muted max-h-40 list-disc overflow-auto rounded-md py-2 pr-2 pl-7 font-mono text-xs">
                        {migrations.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                      <p>
                        <span className="text-foreground font-medium">Sauvegardez la base avant de continuer.</span>{' '}
                        {platform === 'vercel' ? (
                          <>
                            Sur Neon, créez une branche de la base&nbsp;: elle permet de revenir en arrière.{' '}
                            <a href={NEON_BRANCHING_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                              Branches Neon
                            </a>
                          </>
                        ) : (
                          <>Vérifiez la dernière sauvegarde de la base chez {host}, ou faites un pg_dump.</>
                        )}
                        {' · '}
                        <a href={SELF_HOSTING_DOCS_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                          Guide de mise à jour
                        </a>
                      </p>
                    </>
                  ) : (
                    <p>Cette mise à jour ne modifie pas la base de données. Une sauvegarde régulière reste recommandée.</p>
                  )}
                  <p>{Host} redéploie ensuite l&apos;instance&nbsp;; elle reste disponible pendant la construction.</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy === 'install'}>Annuler</AlertDialogCancel>
              <Button onClick={install} disabled={busy === 'install'}>
                {busy === 'install' && <Loader2 className="animate-spin" />}
                {migrations.length ? "J'ai sauvegardé, installer" : 'Installer'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}
