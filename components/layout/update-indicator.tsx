'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CircleArrowUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const DISMISS_KEY = 'kledg:update-dismissed'

function dismissedVersion(): string | null {
  try {
    return window.localStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
}

/**
 * "Mise à jour disponible" for instance administrators (rendered by the
 * layouts for admins only; the API answers 403 to anyone else). Dismissing
 * hides it until the next version. Below 1024px the header has room for one
 * icon only: a menu holds the link and the dismiss action.
 */
export function UpdateIndicator() {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/updates?light=1', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { state?: string; latest?: { version?: string } | null } | null) => {
        const latest = data?.state === 'available' ? data.latest?.version : null
        if (!cancelled && latest && dismissedVersion() !== latest) setVersion(latest)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (!version) return null

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, version)
    } catch {
      // Storage unavailable: hidden for this page only.
    }
    setVersion(null)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="relative lg:hidden" aria-label={`Kledg ${version} est disponible`}>
            <CircleArrowUp aria-hidden />
            <span aria-hidden className="bg-highlight absolute top-1.5 right-1.5 size-2 rounded-full" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Kledg {version} est disponible</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <Link href="/settings/updates">
              <CircleArrowUp aria-hidden />
              Voir la mise à jour
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={dismiss}>
            <X aria-hidden />
            Masquer jusqu&apos;à la prochaine version
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex items-center rounded-md border max-lg:hidden">
        <Button variant="ghost" size="sm" asChild className="rounded-r-none">
          <Link href="/settings/updates" title={`Kledg ${version} est disponible`}>
            <CircleArrowUp />
            Mise à jour disponible
          </Link>
        </Button>
        <Button variant="ghost" size="icon-sm" className="rounded-l-none" onClick={dismiss} title="Masquer jusqu'à la prochaine version">
          <X />
          <span className="sr-only">Masquer</span>
        </Button>
      </div>
    </>
  )
}
