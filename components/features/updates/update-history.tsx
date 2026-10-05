'use client'

import { useCallback, useId, useState } from 'react'
import { ChevronDown, ExternalLink, History } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
} from '@/components/ui/table'
import { DateDisplay, LoadMore } from '@/components/shared'
import { useCursorList, type CursorPage } from '@/hooks/use-cursor-list'
import type { VersionHistoryEntry, VersionHistoryPage } from '@/lib/updates/history'
import { updatesApi } from './api'

const COLUMNS = 5

export const EXTERNAL_INSTALL_LABEL = 'Hôte ou dépôt (hors de cette page)'

function shortCommit(commit: string | null): string | null {
  return commit ? commit.slice(0, 7) : null
}

function VersionLabel({ version, commit }: { version: string | null; commit: string | null }) {
  if (!version) return <span className="text-muted-foreground">Aucune</span>
  const short = shortCommit(commit)
  return (
    <span className="whitespace-nowrap">
      {version}
      {short && <span className="text-muted-foreground font-mono text-xs"> ({short})</span>}
    </span>
  )
}

function Migrations({ entry }: { entry: VersionHistoryEntry }) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  if (!entry.migrationsKnown) return <span className="text-muted-foreground">Inconnues</span>
  const count = entry.migrations.length
  if (count === 0) return <span className="text-muted-foreground">Aucune</span>
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        {count} migration{count > 1 ? 's' : ''}
        <ChevronDown className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </Button>
      {open && (
        <ul id={listId} className="bg-muted list-disc space-y-1 rounded-md py-2 pr-2 pl-6 font-mono text-xs break-all whitespace-normal">
          {entry.migrations.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NotesLink({ entry }: { entry: VersionHistoryEntry }) {
  if (!entry.notesUrl) return <span className="text-muted-foreground">Indisponibles</span>
  return (
    <a
      href={entry.notesUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 whitespace-nowrap underline underline-offset-4"
    >
      {entry.notesKind === 'release' ? 'Notes de version' : 'Voir le commit'}
      <ExternalLink className="size-3" aria-hidden />
      <span className="sr-only">
        {' '}
        de la version {entry.version} (nouvel onglet)
      </span>
    </a>
  )
}

/**
 * "Historique des mises à jour": the versions this instance has run, newest
 * first (GET /api/updates/history, lib/updates/history.ts).
 */
export function UpdateHistory({ currentVersion }: { currentVersion: string }) {
  const fetchPage = useCallback(async (cursor: string | null): Promise<CursorPage<VersionHistoryEntry>> => {
    const page = await updatesApi<VersionHistoryPage>(
      `/api/updates/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    )
    return { items: page.items, nextCursor: page.nextCursor }
  }, [])
  const list = useCursorList<VersionHistoryEntry>('history', fetchPage)
  const empty = !list.loading && !list.error && list.items.length === 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4" />
          Historique des mises à jour
        </CardTitle>
        <CardDescription>
          Les versions installées sur cette instance, de la plus récente à la plus ancienne, avec les migrations
          appliquées.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {list.error ? (
          <Alert variant="destructive">
            <AlertDescription>{list.error}</AlertDescription>
          </Alert>
        ) : (
          <Table aria-label="Historique des mises à jour">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Date</TableHead>
                <TableHead scope="col">Version</TableHead>
                <TableHead scope="col">Installée par</TableHead>
                <TableHead scope="col">Migrations</TableHead>
                <TableHead scope="col">
                  <span className="sr-only">Notes de version</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.loading && <TableSkeleton columns={COLUMNS} rows={3} />}
              {empty && (
                <TableEmpty colSpan={COLUMNS}>
                  L&apos;historique commence à cette version ({currentVersion}).
                </TableEmpty>
              )}
              {list.items.map((entry) => (
                <TableRow key={entry.id} className="align-top">
                  <TableCell>
                    <DateDisplay value={entry.firstSeenAt} format="datetime" />
                  </TableCell>
                  <TableCell>
                    <span className="sr-only">De </span>
                    <VersionLabel version={entry.previousVersion} commit={entry.previousCommit} />
                    <span aria-hidden> → </span>
                    <span className="sr-only"> à </span>
                    <VersionLabel version={entry.version} commit={entry.commit} />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {entry.installedBy ? entry.installedBy.name : (
                      <span className="text-muted-foreground">{EXTERNAL_INSTALL_LABEL}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Migrations entry={entry} />
                  </TableCell>
                  <TableCell>
                    <NotesLink entry={entry} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <LoadMore
          hasMore={list.hasMore}
          loading={list.loadingMore}
          error={list.loadMoreError}
          onLoadMore={list.loadMore}
          auto={false}
        />
      </CardContent>
    </Card>
  )
}
