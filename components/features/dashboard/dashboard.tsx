'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, CalendarPlus, LayoutGrid, ListChecks, Plus, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState, PageHeader } from '@/components/shared'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { useCompanyOnboarding } from '@/components/features/onboarding/use-company-onboarding'
import { GUIDE_PARAM } from '@/components/features/onboarding/guide-link'
import { docsUrl } from '@/lib/docs-links'
import { defaultLayout } from '@/lib/dashboard/layout'
import { cn } from '@/lib/utils'
import { WIDGETS, widgetPermission, type DashboardProfile, type LayoutItem, type WidgetDefinition } from '@/lib/dashboard/widgets'
import { DashboardDataProvider } from './dashboard-data'
import { DashboardGrid, EditableDashboardGrid } from './dashboard-grid'
import { WidgetCatalogue } from './widget-catalogue'
import { guideVisible } from './widgets'
import { CashForecastStatusCard, forecastPath } from '@/components/features/cash-forecast/cash-forecast-alert'

interface FiscalYearOption {
  id: string
  year: number
  startDate: string
  endDate: string
}

interface LayoutView {
  items: LayoutItem[]
  isDefault: boolean
  profile: DashboardProfile
}

type LayoutState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; view: LayoutView }

const sameItems = (a: readonly LayoutItem[], b: readonly LayoutItem[]) =>
  a.length === b.length && a.every((item, i) => item.id === b[i].id && item.size === b[i].size)

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  return body?.error || fallback
}

/** The fiscal year that contains today, else the first one listed (the most recent). */
function pickFiscalYear(years: FiscalYearOption[]): string {
  const now = Date.now()
  const current = years.find((fy) => new Date(fy.startDate).getTime() <= now && new Date(fy.endDate).getTime() >= now)
  return current?.id ?? years[0]?.id ?? ''
}

const EDIT_INSTRUCTIONS =
  'Glissez les widgets par leur poignée ou utilisez les flèches, choisissez une taille, retirez ce qui ne vous sert pas.'

/**
 * Company dashboard: widgets chosen by each user (lib/dashboard/widgets.ts),
 * each loading its own data, and an edit mode ("Personnaliser") to show,
 * hide, reorder and resize them, saved per user and per company.
 */
export function Dashboard({ companyId }: { companyId: string }) {
  const access = useCompanyAccess()
  // The invitation to set a cash threshold goes to who may set it (company settings).
  const canSetForecastThreshold = access.can({ settings: ['update'] })
  const router = useRouter()
  const searchParams = useSearchParams()
  const onboarding = useCompanyOnboarding(companyId)
  const { setDismissed } = onboarding
  const guide = onboarding.data

  const [fiscalYears, setFiscalYears] = React.useState<FiscalYearOption[] | null>(null)
  const [fiscalYearId, setFiscalYearId] = React.useState('')
  const [layout, setLayout] = React.useState<LayoutState>({ status: 'loading' })
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<LayoutItem[]>([])
  const [catalogueOpen, setCatalogueOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState('')

  const isAllowed = React.useCallback((widget: WidgetDefinition) => access.can(widgetPermission(widget)), [access])

  // "Guide de démarrage" from the help menu: show the checklist again.
  const guideRequested = searchParams?.get(GUIDE_PARAM) === '1'
  React.useEffect(() => {
    if (!guideRequested || !guide) return
    if (guide.dismissed && guide.canManage && guide.enabled) void setDismissed(false)
    router.replace(`/${companyId}`, { scroll: false })
  }, [guideRequested, guide, setDismissed, router, companyId])

  React.useEffect(() => {
    let cancelled = false
    fetch(`/api/companies/${companyId}/fiscal-years`)
      .then((response) => (response.ok ? (response.json() as Promise<FiscalYearOption[]>) : []))
      .catch(() => [] as FiscalYearOption[])
      .then((years) => {
        if (cancelled) return
        setFiscalYears(years)
        setFiscalYearId((current) => current || pickFiscalYear(years))
      })
    return () => {
      cancelled = true
    }
  }, [companyId])

  const [layoutAttempt, setLayoutAttempt] = React.useState(0)
  React.useEffect(() => {
    let cancelled = false
    fetch(`/api/dashboard/layout?companyId=${encodeURIComponent(companyId)}`)
      .then((response) => (response.ok ? (response.json() as Promise<LayoutView>) : Promise.reject(new Error('layout'))))
      .then(
        (view) => {
          if (!cancelled) setLayout({ status: 'ready', view })
        },
        () => {
          if (!cancelled) setLayout({ status: 'error' })
        },
      )
    return () => {
      cancelled = true
    }
  }, [companyId, layoutAttempt])

  const reloadLayout = () => {
    setLayout({ status: 'loading' })
    setLayoutAttempt((n) => n + 1)
  }

  const view = layout.status === 'ready' ? layout.view : null
  const dirty = editing && view !== null && !sameItems(draft, view.items)

  // Edits are kept until saved: leaving the page asks first.
  React.useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const announce = (message: string) => setAnnouncement(message)

  const startEditing = () => {
    if (!view) return
    setDraft(view.items)
    setEditing(true)
    announce('Mode personnalisation. Déplacez, redimensionnez, retirez ou ajoutez des widgets, puis enregistrez.')
  }

  const cancelEditing = () => {
    setEditing(false)
    setCatalogueOpen(false)
    announce('Modifications annulées.')
  }

  const save = async () => {
    if (!view) return
    setSaving(true)
    try {
      // Back to the default: remove the saved layout, so later improvements of the default reach this user.
      const toDefault = sameItems(draft, defaultLayout(view.profile, isAllowed))
      const response = await fetch(`/api/dashboard/layout?companyId=${encodeURIComponent(companyId)}`, {
        method: toDefault ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        ...(toDefault ? {} : { body: JSON.stringify({ items: draft }) }),
      })
      if (!response.ok) {
        const message = await responseError(response, "La disposition n'a pas été enregistrée. Réessayez dans un instant.")
        toast.error(message)
        announce(message)
        return
      }
      setLayout({ status: 'ready', view: (await response.json()) as LayoutView })
      setEditing(false)
      setCatalogueOpen(false)
      toast.success('Disposition enregistrée')
      announce('Disposition enregistrée.')
    } finally {
      setSaving(false)
    }
  }

  const resetToDefault = () => {
    if (!view) return
    setDraft(defaultLayout(view.profile, isAllowed))
    announce('Disposition par défaut rétablie. Enregistrez pour la garder.')
  }

  const addWidget = (widget: WidgetDefinition) => {
    setDraft((current) => [...current, { id: widget.id as LayoutItem['id'], size: widget.defaultSize }])
    announce(`« ${widget.title} » ajouté à la fin du tableau de bord.`)
  }

  const available = WIDGETS.filter((w) => isAllowed(w) && !draft.some((item) => item.id === w.id))
  const noFiscalYear = fiscalYears !== null && fiscalYears.length === 0
  const canReopenGuide = Boolean(guide?.enabled && guide.canManage && guide.dismissed)
  // The checklist steps aside once done or hidden: no empty cell in its place.
  const shown = (view?.items ?? []).filter((item) => item.id !== 'guide-demarrer' || guideVisible(guide))

  return (
    <div className={cn('flex flex-1 flex-col gap-6', editing && 'max-sm:pb-32')}>
      <PageHeader
        title="Tableau de bord"
        description="Les chiffres de l'exercice et ce qui attend votre attention. Choisissez ce qui s'affiche avec Personnaliser."
        docsHref={docsUrl('firstSteps')}
        actions={
          editing ? null : (
            <>
              {canReopenGuide ? (
                <Button variant="outline" onClick={() => void setDismissed(false)}>
                  <ListChecks aria-hidden />
                  Démarrer
                </Button>
              ) : null}
              {fiscalYears && fiscalYears.length > 0 ? (
                <Select value={fiscalYearId} onValueChange={setFiscalYearId}>
                  <SelectTrigger className="w-auto" aria-label="Exercice">
                    <SelectValue placeholder="Exercice" />
                  </SelectTrigger>
                  <SelectContent>
                    {fiscalYears.map((fy) => (
                      <SelectItem key={fy.id} value={fy.id}>
                        Exercice {fy.year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {view && !noFiscalYear ? (
                <Button variant="outline" onClick={startEditing}>
                  <LayoutGrid aria-hidden />
                  Personnaliser
                </Button>
              ) : null}
            </>
          )
        }
      />

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/* The cash forecast status (docs/prevision-tresorerie.md): above the widgets, whatever the layout, loaded after the page. */}
      {editing ? null : <CashForecastStatusCard companyId={companyId} mode="expert" href={forecastPath(companyId)} invite={canSetForecastThreshold} />}

      {editing ? (
        // Phones: the actions sit in a bar at the bottom of the screen (above
        // the home indicator) and the instructions stay above the widgets, so
        // the bar does not cover a third of the screen while widgets move.
        <>
          <p className="text-muted-foreground text-sm sm:hidden">{EDIT_INSTRUCTIONS}</p>
          <div className="bg-background fixed inset-x-0 bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-sm sm:sticky sm:top-16 sm:bottom-auto sm:z-10 sm:rounded-lg sm:border sm:p-3">
            <p className="text-muted-foreground min-w-0 flex-1 basis-64 text-sm max-sm:hidden">{EDIT_INSTRUCTIONS}</p>
            <div className="grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto sm:flex-wrap">
              <Button size="sm" variant="outline" onClick={() => setCatalogueOpen(true)}>
                <Plus aria-hidden />
                Ajouter un widget
              </Button>
              <Button size="sm" variant="ghost" onClick={resetToDefault} aria-label="Rétablir la disposition par défaut">
                <RotateCcw aria-hidden />
                <span className="sm:hidden">Par défaut</span>
                <span className="max-sm:hidden">Rétablir la disposition par défaut</span>
              </Button>
              <Button size="sm" variant="outline" onClick={cancelEditing} disabled={saving}>
                Annuler
              </Button>
              <Button size="sm" onClick={() => void save()} loading={saving}>
                Enregistrer
              </Button>
            </div>
          </div>
        </>
      ) : null}

      {noFiscalYear ? (
        <>
          {guide && guideVisible(guide) ? (
            <DashboardDataProvider companyId={companyId} fiscalYearId="" onboarding={onboarding}>
              <DashboardGrid items={[{ id: 'guide-demarrer', size: 'L' }]} />
            </DashboardDataProvider>
          ) : null}
          <EmptyState
            bordered
            icon={CalendarPlus}
            title="Aucun exercice pour cette société"
            description="Créez le premier exercice comptable (en général du 1er janvier au 31 décembre) pour commencer à saisir des écritures et suivre vos chiffres ici."
            action={
              <Button size="sm" asChild>
                <Link href={`/${companyId}/fiscal-years`}>Créer un exercice</Link>
              </Button>
            }
            docsHref={docsUrl('fiscalYear')}
            docsLabel="Qu'est-ce qu'un exercice ?"
          />
        </>
      ) : layout.status === 'error' ? (
        <EmptyState
          bordered
          icon={AlertCircle}
          title="Impossible de charger le tableau de bord"
          description="Le serveur n'a pas répondu. Vérifiez votre connexion puis réessayez."
          action={
            <Button size="sm" variant="outline" onClick={reloadLayout}>
              Réessayer
            </Button>
          }
        />
      ) : !view || fiscalYears === null ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-4" aria-busy="true" aria-label="Chargement du tableau de bord">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      ) : (
        <DashboardDataProvider companyId={companyId} fiscalYearId={fiscalYearId} onboarding={onboarding}>
          {editing ? (
            <EditableDashboardGrid
              items={draft}
              onChange={(items, message) => {
                setDraft(items)
                announce(message)
              }}
            />
          ) : shown.length === 0 ? (
            <EmptyState
              bordered
              icon={LayoutGrid}
              title="Aucun widget sur votre tableau de bord"
              description="Ajoutez les chiffres et les listes qui vous servent, ou rétablissez la disposition par défaut."
              action={
                <Button size="sm" onClick={startEditing}>
                  Personnaliser
                </Button>
              }
            />
          ) : (
            <DashboardGrid items={shown} />
          )}
        </DashboardDataProvider>
      )}

      <WidgetCatalogue
        open={catalogueOpen}
        onOpenChange={setCatalogueOpen}
        available={available}
        onAdd={(widget) => {
          addWidget(widget)
          if (available.length <= 1) setCatalogueOpen(false)
        }}
      />
    </div>
  )
}
