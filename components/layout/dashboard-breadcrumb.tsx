'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { findNavEntry, findSubPageTitle, navGroupsFor } from '@/components/layout/nav-config'
import { findGroupNavEntry, groupRelativePath } from '@/components/layout/group-nav-config'
import { SIMPLE_HOME_PATH, type DisplayMode } from '@/lib/appearance/display-mode'
import { logger } from '@/lib/logger'
import { displayCompanyName } from '@/lib/companies/legal-forms'
import { LegalFormTag } from '@/components/features/companies/legal-form-tag'

/**
 * Header trail: Société / Section / Page. On phones only the current page is
 * shown (the company is in the menu), so the trail never wraps. Sections
 * and titles come from the navigation of the user's display mode.
 */
export function DashboardBreadcrumb({ mode = 'expert' }: { mode?: DisplayMode } = {}) {
  const pathname = usePathname()
  const params = useParams()
  const companyId = params?.companyId as string | undefined
  const [company, setCompany] = useState<{ name: string; legalType: string | null } | null>(null)
  const companyName = company ? displayCompanyName(company.name, company.legalType) : null

  useEffect(() => {
    if (!companyId) {
      setCompany(null)
      return
    }
    let cancelled = false
    fetch(`/api/companies/${companyId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((company) => {
        if (!cancelled) setCompany(company?.name ? { name: company.name, legalType: company.legalType ?? null } : null)
      })
      .catch((error) => logger.error('Error loading company name:', error))
    return () => {
      cancelled = true
    }
  }, [companyId])

  const relativePath = companyId ? pathname.replace(`/${companyId}`, '') || '/' : '/'
  // The group space: "Groupe <holding> > <page>", its own navigation.
  const groupPath = companyId ? groupRelativePath(relativePath) : null
  const groupEntry = groupPath ? findGroupNavEntry(groupPath) : null
  const groupName = companyName ? `Groupe ${companyName}` : null
  const entry = findNavEntry(relativePath, navGroupsFor(mode))
  const isEntryPage = entry && relativePath === entry.url
  // The company's home: the dashboard, or the simple home in simple mode
  const homePath = mode === 'simple' ? SIMPLE_HOME_PATH : '/'
  const isHome = relativePath === homePath
  // Pages reached from another page (Connecter une banque, Configuration du bilan) have their own title.
  const subPage = isEntryPage || isHome ? null : findSubPageTitle(relativePath)
  const pageTitle = groupPath ? (groupEntry?.title ?? "Vue d'ensemble") : isHome ? (mode === 'simple' ? 'Accueil' : 'Tableau de bord') : (subPage?.title ?? entry?.title)

  // Tab titles name the page and the company: "Journaux · Atelier Lumen · Kledg" ("Trésorerie · Groupe Atelier Lumen · Kledg").
  useEffect(() => {
    if (!companyId) return
    const title = [pageTitle, groupPath ? groupName : companyName, 'Kledg'].filter(Boolean).join(' · ')
    document.title = title
    // Next applies the root metadata title after a client navigation: set it again.
    const timeout = setTimeout(() => {
      document.title = title
    }, 300)
    return () => clearTimeout(timeout)
  }, [companyId, companyName, groupName, groupPath, pageTitle, pathname])

  if (!companyId) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>Kledg</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    )
  }

  if (groupPath) {
    const isOverview = groupPath === '/'
    return (
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem className={isOverview ? 'min-w-0' : 'hidden min-w-0 md:inline-flex'}>
            {isOverview ? (
              <BreadcrumbPage className="truncate">{groupName ?? <NamePlaceholder />}</BreadcrumbPage>
            ) : (
              <BreadcrumbLink asChild>
                <Link href={`/${companyId}/group`} className="max-w-56 truncate">
                  {groupName ?? <NamePlaceholder />}
                </Link>
              </BreadcrumbLink>
            )}
          </BreadcrumbItem>
          {!isOverview && groupEntry ? (
            <>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage className="truncate">{groupEntry.title}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          ) : null}
        </BreadcrumbList>
      </Breadcrumb>
    )
  }

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        <BreadcrumbItem className={isHome ? 'min-w-0' : 'hidden min-w-0 md:inline-flex'}>
          {isHome ? (
            <BreadcrumbPage className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{companyName ?? <NamePlaceholder />}</span>
              <LegalFormTag legalType={company?.legalType} />
            </BreadcrumbPage>
          ) : (
            <BreadcrumbLink asChild>
              <Link href={`/${companyId}`} className="flex max-w-56 min-w-0 items-center gap-1.5">
                <span className="truncate">{companyName ?? <NamePlaceholder />}</span>
                <LegalFormTag legalType={company?.legalType} />
              </Link>
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>
        {entry && entry.url !== homePath && (
          <>
            {entry.group ? (
              <>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem className="hidden md:inline-flex">
                  <span className="text-muted-foreground">{entry.group}</span>
                </BreadcrumbItem>
              </>
            ) : null}
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem className="min-w-0">
              {isEntryPage ? (
                <BreadcrumbPage className="truncate">{entry.title}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link href={`/${companyId}${entry.url}`} className="truncate">
                    {entry.title}
                  </Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </>
        )}
        {entry && !isEntryPage && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="truncate">{subPage?.title ?? 'Détail'}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
        {!entry && subPage && (
          <>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="truncate">{subPage.title}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function NamePlaceholder() {
  return (
    <span aria-label="Chargement" className="bg-muted inline-block h-4 w-28 animate-pulse rounded-md align-middle" />
  )
}
