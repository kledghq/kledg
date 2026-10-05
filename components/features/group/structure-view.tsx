'use client'

import { Skeleton } from '@/components/ui/skeleton'
import type { GroupStructureReport } from '@/lib/group/get-group-structure.service'
import { GroupCompaniesSection } from './companies-page'
import { GroupParticipationsSection } from './participations-page'
import { GroupPersonsSection } from './persons-page'
import { ExportButtons, LoadError, PerimeterNotes, SectionIntro, useGroupReport, useReportUrl } from './space'
import { StructureDiagram } from './structure-diagram'
import { GroupViewFrame } from './view-frame'

/** The structure of the group as a diagram (GET /api/group/structure). */
export function GroupOrganigramSection({ simple = false }: { simple?: boolean }) {
  const report = useGroupReport<GroupStructureReport>(useReportUrl('structure', {}, false), 'La structure du groupe ne s’est pas chargée. Réessayez dans un instant.')
  const data = report.data
  if (report.error) return <LoadError message={report.error} onRetry={report.retry} />
  return (
    <>
      {simple ? null : (
        <SectionIntro
          description="Les personnes et les sociétés qui détiennent le groupe, la holding et ses filiales, avec le pourcentage de chaque détention et les dirigeants. Cliquez sur une société pour l'ouvrir."
          actions={<ExportButtons report="structure" disabled={!data} />}
        />
      )}
      {data ? <PerimeterNotes warnings={data.warnings} unreachable={data.unreachable} /> : null}
      <div aria-busy={report.loading || undefined}>{data ? <StructureDiagram structure={data} simple={simple} /> : <Skeleton className="h-96 w-full rounded-md" />}</div>
    </>
  )
}

/**
 * Structure (/<holding>/group/structure): who owns what, who runs what? The
 * organigramme, the cap table with direct and indirect percentages, the
 * table of filiales et participations and the companies' legal details.
 */
export function GroupStructureView({ page }: { page?: string } = {}) {
  return (
    <GroupViewFrame
      view="structure"
      page={page}
      sections={{
        organigramme: <GroupOrganigramSection />,
        associes: <GroupPersonsSection />,
        participations: <GroupParticipationsSection />,
        societes: <GroupCompaniesSection />,
      }}
    />
  )
}
