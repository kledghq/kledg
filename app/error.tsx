'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { logger } from '@/lib/logger'
import { FALLBACK_FEEDBACK_TARGET, useFeedback } from '@/components/features/feedback/feedback-context'
import { FeedbackDialog } from '@/components/features/feedback/feedback-dialog'

/**
 * Unexpected error inside a page. The layout (sidebar, header) stays in place
 * so the user can retry or go elsewhere; nothing typed elsewhere is lost.
 * "Signaler le problème" prepares a GitHub issue with the error's reference
 * (docs/signaler-un-probleme.md).
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    logger.error(error)
  }, [error])
  const feedback = useFeedback()
  // Above the app frame there is no feedback provider: the dialog is rendered here.
  const [ownDialog, setOwnDialog] = useState(false)
  const report = () => (feedback ? feedback.open('bug', { errorReference: error.digest }) : setOwnDialog(true))

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 py-12">
      <div className="space-y-1.5">
        <p className="text-muted-foreground text-sm">Erreur inattendue</p>
        <h1 className="text-xl font-semibold tracking-tight">Cette page n&apos;a pas pu s&apos;afficher</h1>
        <p className="text-muted-foreground text-sm">
          Réessayez dans un instant. Si le problème continue, signalez-le avec la référence
          ci-dessous&nbsp;: elle permet de retrouver l&apos;erreur dans les journaux du serveur.
        </p>
      </div>
      {error.digest ? (
        <p className="bg-muted w-fit rounded-md px-2 py-1 font-mono text-xs">Référence&nbsp;: {error.digest}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => reset()}>Réessayer</Button>
        <Button variant="outline" asChild>
          <Link href="/companies">Mes sociétés</Link>
        </Button>
        <Button variant="ghost" onClick={report}>
          Signaler le problème
        </Button>
      </div>
      {ownDialog ? (
        <FeedbackDialog
          open
          onOpenChange={setOwnDialog}
          kind="bug"
          target={FALLBACK_FEEDBACK_TARGET}
          displayMode={null}
          errorReference={error.digest ?? null}
        />
      ) : null}
    </div>
  )
}
