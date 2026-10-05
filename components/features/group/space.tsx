'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Download, FileSpreadsheet, Info, Lock, RotateCw, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Amount, formatPercent } from '@/components/shared'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { downloadFile } from '@/components/features/reports/download-file'
import { responseError } from '@/hooks/use-cursor-list'
import { cn } from '@/lib/utils'
import type { UnreachableSubsidiary } from '@/lib/group/perimeter'

/**
 * What the pages of the group space share (docs/vue-groupe.md): the
 * holding in the URL, the holding's fiscal year chosen once for every page
 * (kept by the group layout while the user moves between pages), the
 * loading of a report with its three states, the exports and the notes on
 * the subsidiaries not read.
 */

interface GroupSpaceValue {
  /** The holding, as in the URL (slug or id): the API resolves either. */
  companyId: string
  fiscalYearId: string
  setFiscalYearId: (id: string) => void
  /** The company the Pilotage view is filtered on (its id), null for the whole group. */
  companyFilter: string | null
  setCompanyFilter: (id: string | null) => void
}

const GroupSpaceContext = React.createContext<GroupSpaceValue | null>(null)

export function GroupSpaceProvider({ companyId, children }: { companyId: string; children: React.ReactNode }) {
  const [state, setState] = React.useState<{ companyId: string; fiscalYearId: string; companyFilter: string | null }>({ companyId, fiscalYearId: '', companyFilter: null })
  // Another holding: its own fiscal year, no filter.
  const same = state.companyId === companyId
  const fiscalYearId = same ? state.fiscalYearId : ''
  const companyFilter = same ? state.companyFilter : null
  const value = React.useMemo(
    () => ({
      companyId,
      fiscalYearId,
      setFiscalYearId: (id: string) => setState((previous) => ({ companyId, fiscalYearId: id, companyFilter: previous.companyId === companyId ? previous.companyFilter : null })),
      companyFilter,
      setCompanyFilter: (id: string | null) => setState((previous) => ({ companyId, fiscalYearId: previous.companyId === companyId ? previous.fiscalYearId : '', companyFilter: id })),
    }),
    [companyId, fiscalYearId, companyFilter],
  )
  return <GroupSpaceContext.Provider value={value}>{children}</GroupSpaceContext.Provider>
}

export function useGroupSpace(): GroupSpaceValue {
  const value = React.useContext(GroupSpaceContext)
  if (!value) throw new Error('useGroupSpace outside the group space')
  return value
}

/**
 * Loads a JSON report with the three states of a client fetch. State is only
 * set when a response arrives; loading is derived (the request in flight is
 * not the one answered yet), and the previous report stays shown meanwhile.
 */
export function useGroupReport<T>(url: string | null, fallback: string) {
  const [version, setVersion] = React.useState(0)
  const [state, setState] = React.useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null })
  const key = url ? `${url}#${version}` : null
  React.useEffect(() => {
    if (!key || !url) return
    let cancelled = false
    fetch(url, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, fallback))
        return response.json() as Promise<T>
      })
      .then((data) => !cancelled && setState({ key, data, error: null }))
      .catch((e: Error) => !cancelled && setState((previous) => ({ key, data: previous.data, error: e.message })))
    return () => {
      cancelled = true
    }
  }, [key, url, fallback])
  const loading = key !== null && state.key !== key
  return { data: state.data, error: loading ? null : state.error, loading, retry: () => setVersion((v) => v + 1) }
}

/** The URL of a group report for the holding and its chosen fiscal year; null until the year is known. */
export function useReportUrl(path: string, extra: Record<string, string | undefined> = {}, needsFiscalYear = true): string | null {
  const { companyId, fiscalYearId } = useGroupSpace()
  if (needsFiscalYear && !fiscalYearId) return null
  const params = new URLSearchParams({ companyId })
  if (fiscalYearId) params.set('fiscalYearId', fiscalYearId)
  for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v)
  return `/api/group/${path}?${params}`
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3" role="alert">
        <p className="text-sm">{message}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCw aria-hidden />
          Réessayer
        </Button>
      </CardContent>
    </Card>
  )
}

/** An amount in cents, "-" when unknown; negative in red when `signed`. */
export function Cents({ value, signed = false }: { value: number | null | undefined; signed?: boolean }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">-</span>
  return <Amount value={value / 100} className={cn(signed && value < 0 && 'text-destructive')} />
}

export const ownership = (bp: number | null | undefined) => (bp === null || bp === undefined ? null : formatPercent(bp / 100))

/** The sentence and the actions (exports) at the top of a section of a view. */
export function SectionIntro({ description, actions }: { description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      {description ? <p className="text-muted-foreground max-w-prose flex-1 basis-72 text-sm">{description}</p> : null}
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/** Notice above a figure that adds companies up: what it is and what it is not. */
export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground flex items-start gap-2 text-sm" role="note">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/** Warnings of a report and the subsidiaries not read (never named when out of reach). */
export function PerimeterNotes({ warnings, unreachable }: { warnings: readonly string[]; unreachable: readonly UnreachableSubsidiary[] }) {
  const named = unreachable.filter((u) => u.name)
  if (warnings.length === 0 && named.length === 0) return null
  return (
    <Card>
      <CardContent>
        <ul className="space-y-2 text-sm">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-2">
              <TriangleAlert aria-hidden className="text-warning mt-0.5 size-4 shrink-0" />
              <span>{w}</span>
            </li>
          ))}
          {named.map((u, i) => (
            <li key={`${u.name}-${i}`} className="text-muted-foreground flex items-start gap-2">
              <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{u.name}&nbsp;: votre rôle dans cette filiale ne permet pas de lire ses états.</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/** "Exporter en CSV" and "Exporter en Excel" of a report (reports:export in the holding). */
export function ExportButtons({ report, extra = {}, disabled }: { report: string; extra?: Record<string, string | undefined>; disabled?: boolean }) {
  const { can } = useCompanyAccess()
  const { companyId, fiscalYearId } = useGroupSpace()
  const [exporting, setExporting] = React.useState<'csv' | 'xlsx' | null>(null)
  if (!can({ reports: ['export'] })) return null
  const run = async (format: 'csv' | 'xlsx') => {
    const params = new URLSearchParams({ companyId, report, format })
    if (fiscalYearId) params.set('fiscalYearId', fiscalYearId)
    for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v)
    setExporting(format)
    try {
      await downloadFile(`/api/group/export?${params}`, `${report}.${format}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setExporting(null)
    }
  }
  return (
    <>
      <Button variant="outline" onClick={() => run('csv')} disabled={disabled || exporting !== null} loading={exporting === 'csv'}>
        <Download aria-hidden />
        Exporter en CSV
      </Button>
      <Button variant="outline" onClick={() => run('xlsx')} disabled={disabled || exporting !== null} loading={exporting === 'xlsx'}>
        <FileSpreadsheet aria-hidden />
        Exporter en Excel
      </Button>
    </>
  )
}

/** A company of the group, linking into its own pages. */
export function CompanyLink({ company, to = '' }: { company: { name: string; slug: string }; to?: string }) {
  return (
    <Link href={`/${company.slug}${to}`} className="text-link pointer-coarse:-my-3 pointer-coarse:py-3 hover:underline">
      {company.name}
    </Link>
  )
}

/** The role line of a company of the group: "Holding" or "Détenue à 80 %". */
export function roleLabel(company: { role: 'holding' | 'subsidiary'; ownershipBp: number | null }) {
  return company.role === 'holding' ? 'Holding' : `Détenue à ${ownership(company.ownershipBp) ?? '?'}`
}
