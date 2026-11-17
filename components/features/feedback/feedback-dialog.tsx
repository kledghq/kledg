'use client'

import { useMemo, useState } from 'react'
import { useParams, usePathname } from 'next/navigation'
import { ArrowUpRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/shared'
import {
  browserLabel,
  contextLines,
  feedbackIssueUrl,
  feedbackSearchUrl,
  pagePattern,
  TEXT_MAX,
  TITLE_MAX,
  type FeedbackContext,
  type FeedbackKind,
} from '@/lib/feedback/issue-url'
import type { FeedbackTarget } from '@/lib/feedback/target'

const COPY: Record<FeedbackKind, { title: string; intro: string; description: string; details: string; detailsHint: string }> = {
  bug: {
    title: 'Signaler un problème',
    intro: 'Décrivez ce qui ne fonctionne pas. Kledg prépare le signalement sur GitHub, vous le relisez et l’envoyez depuis votre compte GitHub.',
    description: 'Que se passe-t-il ?',
    details: 'Étapes pour reproduire',
    detailsHint: '1. Aller sur ... 2. Cliquer sur ... 3. Constater ...',
  },
  idea: {
    title: 'Proposer une idée',
    intro: 'Décrivez votre besoin. Kledg prépare la proposition sur GitHub, vous la relisez et l’envoyez depuis votre compte GitHub.',
    description: 'Besoin',
    details: 'Proposition',
    detailsHint: 'Comment Kledg pourrait y répondre.',
  },
}

/**
 * Prepares a GitHub issue from the repository's issue forms
 * (lib/feedback/issue-url.ts): title, description, steps or proposal, and the
 * technical context, shown before sending. Nothing leaves Kledg until the
 * user opens the link; the issue is created by them on GitHub.
 */
export function FeedbackDialog({
  open,
  onOpenChange,
  kind,
  target,
  displayMode,
  errorReference,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: FeedbackKind
  target: FeedbackTarget
  displayMode: string | null
  errorReference: string | null
}) {
  const copy = COPY[kind]
  const pathname = usePathname() ?? '/'
  const params = useParams() ?? {}
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [details, setDetails] = useState('')

  const context: FeedbackContext = useMemo(
    () => ({
      version: target.version,
      commit: target.commit,
      host: target.host,
      page: pagePattern(pathname, params as Record<string, string | string[] | undefined>),
      displayMode,
      browser: typeof navigator === 'undefined' ? null : browserLabel(navigator.userAgent),
      language: typeof navigator === 'undefined' ? null : navigator.language,
      errorReference,
    }),
    [target, pathname, params, displayMode, errorReference],
  )

  const ready = title.trim() !== '' && description.trim() !== ''
  const issueUrl = ready ? feedbackIssueUrl(target.repo, { kind, title, description, details }, context) : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.intro}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Titre" required>
            <Input value={title} maxLength={TITLE_MAX} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label={copy.description} required hint={'N\u2019incluez aucune donnée comptable réelle\u00a0: anonymisez montants, noms et SIREN.'}>
            <Textarea value={description} maxLength={TEXT_MAX} rows={4} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field label={copy.details} optional hint={copy.detailsHint}>
            <Textarea value={details} maxLength={TEXT_MAX} rows={3} onChange={(event) => setDetails(event.target.value)} />
          </Field>
          <section aria-labelledby="feedback-context-title" className="bg-muted/50 space-y-1 rounded-md border p-3">
            <h3 id="feedback-context-title" className="text-sm font-medium">
              Contexte technique ajouté
            </h3>
            <ul className="text-muted-foreground space-y-0.5 text-xs">
              {contextLines(context).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="text-muted-foreground text-xs">
              Jamais de données comptables, de nom de société, de montant ni d&apos;identifiant. Le signalement est public sur{' '}
              {target.repo}.
            </p>
          </section>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" asChild disabled={!title.trim()}>
            {title.trim() ? (
              <a href={feedbackSearchUrl(target.repo, title)} target="_blank" rel="noreferrer">
                Est-ce déjà signalé&nbsp;?
                <span className="sr-only">(nouvel onglet)</span>
              </a>
            ) : (
              <span aria-disabled>Est-ce déjà signalé&nbsp;?</span>
            )}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            {issueUrl ? (
              <Button asChild>
                <a href={issueUrl} target="_blank" rel="noreferrer" onClick={() => onOpenChange(false)}>
                  Ouvrir sur GitHub
                  <ArrowUpRight aria-hidden />
                  <span className="sr-only">(nouvel onglet)</span>
                </a>
              </Button>
            ) : (
              <Button type="button" disabled>
                Ouvrir sur GitHub
                <ArrowUpRight aria-hidden />
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
