'use client'

import { useEffect } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { REPO_URL } from '@/lib/config'
import { logger } from '@/lib/logger'

/**
 * Unexpected error inside a page. The layout (sidebar, header) stays in place
 * so the user can retry or go elsewhere; nothing typed elsewhere is lost.
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
        <Button variant="ghost" asChild>
          <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">
            Signaler le problème
          </a>
        </Button>
      </div>
    </div>
  )
}
