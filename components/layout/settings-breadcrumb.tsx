'use client'

import { usePathname } from 'next/navigation'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { findSettingsEntry, type InstanceSettingsLinks, type InstanceSettingsPage } from '@/components/layout/settings-nav-config'

/**
 * Header trail of the settings area: Groupe / Page ("Compte / Mot de passe").
 * On phones only the page is shown, like the company breadcrumb.
 */
export function SettingsBreadcrumb({
  instanceLinks,
  instancePages,
}: { instanceLinks?: InstanceSettingsLinks | null; instancePages?: readonly InstanceSettingsPage[] | null } = {}) {
  const pathname = usePathname() ?? ''
  const entry = findSettingsEntry(pathname, instanceLinks, instancePages)

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {entry?.group ? (
          <>
            <BreadcrumbItem className="hidden md:inline-flex">
              <span className="text-muted-foreground">{entry.group}</span>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
          </>
        ) : null}
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbPage className="truncate">{entry?.title ?? 'Paramètres'}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}
