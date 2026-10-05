"use client"

import * as React from "react"
import { ChevronsUpDown, Building2, Plus, Check, Loader2, Network } from "lucide-react"
import { useRouter, useParams, usePathname } from "next/navigation"
import Link from "next/link"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { logger } from '@/lib/logger'
import { lastCompanyCookie } from '@/lib/last-company'
import { companyInitials, displayCompanyName } from '@/lib/companies/legal-forms'
import { CompanyNameWithForm } from '@/components/features/companies/legal-form-tag'

function CompanyMark({ name, legalType, size = "md" }: { name?: string | null; legalType?: string | null; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={
        size === "sm"
          ? "bg-background flex size-6 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold"
          : "bg-foreground text-background flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold"
      }
    >
      {companyInitials(name, legalType) || <Building2 className="size-4" />}
    </span>
  )
}

export interface SwitcherCompany {
  id: string
  slug: string
  name: string
  siret?: string | null
  logo?: string | null
  legalType?: string | null
}

const findCompany = (companies: SwitcherCompany[], ref: string | undefined) =>
  ref ? companies.find((c) => c.slug === ref || c.id === ref) ?? null : null

/**
 * The company switcher. The layout passes the user's companies
 * (`initialCompanies`), so it renders the current company at once; the list
 * is fetched again on navigation and on the "companies:refresh" event.
 */
/**
 * The company switcher of the sidebar. Below the companies, "Groupes" lists
 * the holdings of the user (one definition: a company recorded among the
 * shareholders of another, lib/management-fees/holding.ts, passed as
 * `holdingRefs`, ids or slugs); each opens the group view of its holding
 * (docs/vue-groupe.md).
 */
export function TeamSwitcher({ initialCompanies, holdingRefs = [] }: { initialCompanies?: SwitcherCompany[]; holdingRefs?: readonly string[] }) {
  const { isMobile, state } = useSidebar()
  const params = useParams()
  const pathname = usePathname()
  // URL segment: the company slug (an id is redirected to the slug by the company layout)
  const currentCompanyId = params?.companyId as string | undefined
  const isCollapsed = state === "collapsed"
  const [companies, setCompanies] = React.useState<SwitcherCompany[]>(initialCompanies ?? [])
  const [currentCompany, setCurrentCompany] = React.useState<SwitcherCompany | null>(() =>
    findCompany(initialCompanies ?? [], currentCompanyId),
  )
  const [loading, setLoading] = React.useState(!initialCompanies)
  const groups = companies.filter((c) => holdingRefs.includes(c.id) || holdingRefs.includes(c.slug))
  const isGroupView = (holding: SwitcherCompany) =>
    (currentCompanyId === holding.slug || currentCompanyId === holding.id) && /\/group(\/|$)/.test(pathname ?? "")
  const [navigating, setNavigating] = React.useState(false)
  const [pendingCompanyId, setPendingCompanyId] = React.useState<string | null>(null)
  const router = useRouter()


  const loadCompanies = React.useCallback(async () => {
    try {
      const response = await fetch('/api/companies', { cache: 'no-store' })
      if (response.ok) {
        const data = await response.json()
        setCompanies(data)

        // Trouver la société actuelle depuis l'URL
        if (currentCompanyId) {
          const activeCompany = data.find(
            (c: { id: string; slug: string }) => c.slug === currentCompanyId || c.id === currentCompanyId
          )
          if (activeCompany) {
            setCurrentCompany(activeCompany)
          }
        } else {
          setCurrentCompany(null)
        }
      }
    } catch (error) {
      logger.error('Error loading companies:', error)
    } finally {
      setLoading(false)
    }
  }, [currentCompanyId])

  // The server layout sends a fresh list after router.refresh() (a new logo or
  // name): follow it instead of keeping the list from the first render.
  React.useEffect(() => {
    if (!initialCompanies) return
    setCompanies(initialCompanies)
    setCurrentCompany((current) => findCompany(initialCompanies, currentCompanyId) ?? current)
  }, [initialCompanies, currentCompanyId])

  React.useEffect(() => {
    loadCompanies()

    const handleRefresh = () => {
      loadCompanies()
    }

    window.addEventListener('companies:refresh', handleRefresh)
    return () => {
      window.removeEventListener('companies:refresh', handleRefresh)
    }
  }, [loadCompanies])

  // Remembered for "Retour à <société>" in the settings area.
  React.useEffect(() => {
    if (currentCompany?.slug && currentCompany.slug === currentCompanyId) {
      document.cookie = lastCompanyCookie(currentCompany.slug)
    }
  }, [currentCompany?.slug, currentCompanyId])

  // `companyId` here is the target company's slug (used in URLs)
  const handleSelect = (companyId: string) => {
    // Ne pas naviguer si on sélectionne la même société
    if (companyId === currentCompanyId) {
      return
    }
    
    setNavigating(true)
    setPendingCompanyId(companyId)
    
    // Immediately update displayed company from the list we already have
    const selectedCompany = companies.find(c => c.slug === companyId)
    if (selectedCompany) {
      setCurrentCompany(selectedCompany)
    }
    
    // Preserve current path by only replacing companyId
    if (currentCompanyId && pathname) {
      // Extract path after companyId
      const pathAfterCompany = pathname.replace(`/${currentCompanyId}`, '') || '/'
      // Construire le nouveau chemin avec le nouveau companyId
      const newPath = `/${companyId}${pathAfterCompany}`
      router.push(newPath)
    } else {
      // If not on a company page, go to home page
      router.push(`/${companyId}`)
    }
  }

  // Reset navigation state when pathname changes AND company is loaded
  React.useEffect(() => {
    if (navigating && pathname) {
      // Check if navigation is complete by comparing companyId in URL
      const urlCompanyId = pathname.split('/')[1]
      const expectedCompanyId = pendingCompanyId
      
      // If navigating to a company, verify that:
      // 1. URL matches expected companyId
      // 2. currentCompanyId in params matches
      // 3. currentCompany is properly updated with the correct company
      if (expectedCompanyId && urlCompanyId === expectedCompanyId && currentCompanyId === expectedCompanyId) {
        // Verify that displayed company matches
        if (currentCompany?.slug === expectedCompanyId) {
          // Navigation is complete
          setNavigating(false)
          setPendingCompanyId(null)
        }
      } 
      // Si l'URL a changé mais ne correspond pas exactement, réinitialiser quand même après un délai
      else if (urlCompanyId !== currentCompanyId) {
        // L'URL a changé, donc la navigation est probablement terminée
        const timeout = setTimeout(() => {
          setNavigating(false)
          setPendingCompanyId(null)
        }, 500)
        return () => clearTimeout(timeout)
      }
    }
  }, [pathname, navigating, pendingCompanyId, currentCompanyId, currentCompany])

  // Safety timeout to reset navigation state after 2 seconds
  React.useEffect(() => {
    if (navigating) {
      const timeout = setTimeout(() => {
        setNavigating(false)
        setPendingCompanyId(null)
      }, 2000)
      return () => clearTimeout(timeout)
    }
  }, [navigating])

  if (loading) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" disabled>
            <span aria-hidden className="bg-muted size-8 shrink-0 animate-pulse rounded-md" />
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="text-muted-foreground truncate">Chargement...</span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              tooltip={isCollapsed ? (currentCompany ? displayCompanyName(currentCompany.name, currentCompany.legalType) : "Choisir une société") : undefined}
            >
              {navigating ? (
                <span className="flex size-8 shrink-0 items-center justify-center">
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                </span>
              ) : currentCompany?.logo ? (
                <span className="bg-background flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border">
                  <img
                    src={currentCompany.logo}
                    alt=""
                    className="size-8 object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                </span>
              ) : (
                <CompanyMark name={currentCompany?.name} legalType={currentCompany?.legalType} />
              )}
              {!isCollapsed && (
                <>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    {navigating ? (
                      <>
                        <span className="truncate font-medium">Chargement...</span>
                        <span className="truncate text-xs text-sidebar-foreground/70">
                          Changement de société
                        </span>
                      </>
                    ) : (
                      <>
                        {currentCompany ? (
                          <CompanyNameWithForm
                            name={currentCompany.name}
                            legalType={currentCompany.legalType}
                            nameClassName="font-medium"
                          />
                        ) : (
                          <span className="truncate font-medium">Choisir une société</span>
                        )}
                        {currentCompany?.siret && (
                          <span className="truncate text-xs text-sidebar-foreground/70">
                            {currentCompany.siret}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  {!navigating && <ChevronsUpDown className="ml-auto" />}
                </>
              )}
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Sociétés
            </DropdownMenuLabel>
            {companies.map((comp) => (
              <DropdownMenuItem
                key={comp.id}
                onClick={() => handleSelect(comp.slug)}
                className="gap-2 p-2"
              >
                {comp.logo ? (
                  <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md border">
                    <img
                      src={comp.logo}
                      alt=""
                      className="size-6 object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  </span>
                ) : (
                  <CompanyMark name={comp.name} legalType={comp.legalType} size="sm" />
                )}
                <div className="flex min-w-0 flex-col">
                  <CompanyNameWithForm name={comp.name} legalType={comp.legalType} />
                  {comp.siret && (
                    <span className="num text-xs text-muted-foreground">{comp.siret}</span>
                  )}
                </div>
                {(comp.slug === currentCompanyId || comp.id === currentCompanyId) && !isGroupView(comp) && (
                  <Check className="ml-auto h-4 w-4" />
                )}
              </DropdownMenuItem>
            ))}
            {groups.length > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-muted-foreground text-xs">
                  Groupes
                </DropdownMenuLabel>
                {groups.map((holding) => (
                  <DropdownMenuItem key={holding.id} className="gap-2 p-2" asChild>
                    <Link href={`/${holding.slug}/group`}>
                      <span aria-hidden className="bg-background flex size-6 shrink-0 items-center justify-center rounded-md border">
                        <Network className="size-3.5" />
                      </span>
                      <span className="min-w-0 truncate">{displayCompanyName(holding.name, holding.legalType)}</span>
                      {isGroupView(holding) && <Check className="ml-auto h-4 w-4" />}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 p-2" asChild>
              <Link href="/companies">
                <span className="flex size-6 items-center justify-center rounded-md border">
                  <Plus aria-hidden className="size-3.5" />
                </span>
                <span className="text-muted-foreground">Gérer les sociétés</span>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
