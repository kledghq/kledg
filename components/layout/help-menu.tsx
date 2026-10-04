'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowUpRight, BookOpen, CircleHelp, History, ListChecks, Share } from 'lucide-react'

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

/**
 * Help of the header. On company pages, a menu: the documentation, the
 * "Démarrer" checklist of the company (shown again on its dashboard) and the
 * opening balance sheet, for a company that existed before Kledg. On iOS
 * outside the installed app, how to add Kledg to the home screen (Safari
 * has no install prompt to offer from the user menu). With neither, a
 * direct link to the documentation.
 */
export function HelpMenu({ onboardingEnabled }: { onboardingEnabled: boolean }) {
  const params = useParams()
  const companyId = params?.companyId as string | undefined
  const showIosInstall = useIosInstallHint()

  // When the documentation is the only help entry, open it directly rather
  // than a menu with a single link.
  if (!companyId && !showIosInstall) {
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
