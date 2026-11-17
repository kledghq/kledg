'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowUpRight, BookOpen, Bug, CircleHelp, History, Lightbulb, ListChecks, Share } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DOCS_URL } from '@/lib/config'
import { guideHref } from '@/components/features/onboarding/guide-link'
import { useIosInstallHint } from '@/components/pwa/install'
import { useFeedback } from '@/components/features/feedback/feedback-context'

/**
 * Help of the header. On company pages, a menu: the documentation, the
 * "Démarrer" checklist of the company (shown again on its dashboard) and the
 * opening balance sheet, for a company that existed before Kledg. Then
 * "Signaler un problème" and "Proposer une idée", which prepare a GitHub
 * issue (docs/signaler-un-probleme.md). On iOS outside the installed app,
 * how to add Kledg to the home screen (Safari has no install prompt to
 * offer from the user menu). With none of these, a direct link to the
 * documentation.
 */
export function HelpMenu({ onboardingEnabled }: { onboardingEnabled: boolean }) {
  const params = useParams()
  const companyId = params?.companyId as string | undefined
  const showIosInstall = useIosInstallHint()
  const feedback = useFeedback()

  // When the documentation is the only help entry, open it directly rather
  // than a menu with a single link.
  if (!companyId && !showIosInstall && !feedback) {
    return (
      <Button variant="ghost" size="icon-sm" asChild>
        <a href={DOCS_URL} target="_blank" rel="noreferrer" aria-label="Documentation (nouvel onglet)" title="Documentation">
          <CircleHelp aria-hidden />
        </a>
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Aide" title="Aide">
          <CircleHelp aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Aide</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <a href={DOCS_URL} target="_blank" rel="noreferrer">
            <BookOpen aria-hidden className="size-4" />
            Documentation
            <ArrowUpRight aria-hidden className="text-muted-foreground ml-auto size-3.5" />
            <span className="sr-only">(nouvel onglet)</span>
          </a>
        </DropdownMenuItem>
        {onboardingEnabled && companyId ? (
          <DropdownMenuItem asChild>
            <Link href={guideHref(companyId)}>
              <ListChecks aria-hidden className="size-4" />
              Guide de démarrage
            </Link>
          </DropdownMenuItem>
        ) : null}
        {companyId ? (
          <DropdownMenuItem asChild>
            <Link href={`/${companyId}/fiscal-years/opening-balances`}>
              <History aria-hidden className="size-4" />
              Bilan d&apos;ouverture
            </Link>
          </DropdownMenuItem>
        ) : null}
        {feedback ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => feedback.open('bug')}>
              <Bug aria-hidden className="size-4" />
              Signaler un problème
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => feedback.open('idea')}>
              <Lightbulb aria-hidden className="size-4" />
              Proposer une idée
            </DropdownMenuItem>
          </>
        ) : null}
        {showIosInstall ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex gap-2 font-normal">
              <Share aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <p>
                <span className="font-medium">Installer l&apos;application</span>
                <span className="text-muted-foreground block text-xs">Partager puis Sur l&apos;écran d&apos;accueil</span>
              </p>
            </DropdownMenuLabel>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
