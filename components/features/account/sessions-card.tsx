'use client'

import { useCallback, useEffect, useImperativeHandle, useState, type Ref } from 'react'
import { Monitor, RefreshCw, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import type { AccountSession } from '@/lib/account/sessions.service'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDisplayDate, StatusBadge, useConfirm } from '@/components/shared'
import { accountApi } from './account-api'

const MOBILE = /iPhone|iPad|Android/

export interface SessionsCardHandle {
  reload: () => Promise<void>
}

/** Browsers and devices signed in to the account, with sign out per session or for all the others. */
export function SessionsCard({ ref }: { ref?: Ref<SessionsCardHandle> }) {
  const { confirm, dialog } = useConfirm()
  const [sessions, setSessions] = useState<AccountSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setSessions(await accountApi<AccountSession[]>('/api/account/sessions'))
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useImperativeHandle(ref, () => ({ reload: load }), [load])

  useEffect(() => {
    const timer = setTimeout(load, 0)
    return () => clearTimeout(timer)
  }, [load])

  const others = sessions?.filter((s) => !s.current) ?? []

  const revoke = async (session: AccountSession) => {
    const ok = await confirm({
      title: `Déconnecter la session ${session.device} ?`,
      description: 'Ce navigateur devra se reconnecter avec votre mot de passe pour accéder à Kledg.',
      confirmLabel: 'Déconnecter',
    })
    if (!ok) return
    setBusy(session.id)
    try {
      await accountApi(`/api/account/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' })
      toast.success('Session déconnectée')
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const revokeOthers = async () => {
    const ok = await confirm({
      title: 'Déconnecter les autres sessions ?',
      description: `${others.length} session${others.length > 1 ? 's' : ''} sur d'autres navigateurs ou appareils ${others.length > 1 ? 'seront fermées' : 'sera fermée'}. Cette session reste ouverte.`,
      confirmLabel: 'Déconnecter',
    })
    if (!ok) return
    setBusy('others')
    try {
      await accountApi('/api/account/sessions', { method: 'DELETE' })
      toast.success('Autres sessions déconnectées')
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card id="sessions" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>Sessions actives</CardTitle>
        <CardDescription>
          Les navigateurs et appareils connectés à votre compte. Déconnectez ceux que vous ne reconnaissez pas, puis
          changez votre mot de passe.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>Les sessions n&apos;ont pas pu être chargées. {error}</span>
              <Button size="sm" variant="outline" onClick={load}>
                <RefreshCw aria-hidden />
                Réessayer
              </Button>
            </AlertDescription>
          </Alert>
        ) : sessions === null ? (
          <ul className="divide-y" aria-busy="true" aria-label="Chargement des sessions">
            {[0, 1].map((i) => (
              <li key={i} className="flex items-center gap-3 py-3">
                <Skeleton className="size-8 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-64 max-w-full" />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="divide-y">
            {sessions.map((session) => {
              const Icon = MOBILE.test(session.device) ? Smartphone : Monitor
              return (
                <li key={session.id} className="flex items-center gap-3 py-3">
                  <span
                    aria-hidden
                    className="text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border"
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="truncate">{session.device}</span>
                      {session.current ? <StatusBadge tone="success">Cette session</StatusBadge> : null}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      Dernière activité le {formatDisplayDate(session.lastActiveAt, 'datetime')}
                      {session.ipAddress ? (
                        <>
                          {' · '}IP <span className="font-mono">{session.ipAddress}</span>
                        </>
                      ) : null}
                      {' · '}connectée le {formatDisplayDate(session.createdAt, 'long')}
                    </div>
                  </div>
                  {session.current ? null : (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => revoke(session)}
                      loading={busy === session.id}
                      disabled={busy !== null}
                      aria-label={`Déconnecter la session ${session.device}`}
                    >
                      Déconnecter
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
      <CardFooter className="pt-5">
        <Button
          variant="outline"
          onClick={revokeOthers}
          loading={busy === 'others'}
          disabled={others.length === 0 || busy !== null}
        >
          Déconnecter les autres sessions
        </Button>
      </CardFooter>
      {dialog}
    </Card>
  )
}
