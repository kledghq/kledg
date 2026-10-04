'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ClipboardCheck, FilePlus2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Amount, EmptyState, PageHeader, StatCard, formatAmount, formatDisplayDate } from '@/components/shared'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { docsUrl } from '@/lib/docs-links'
import type { YearEndInventory } from '@/lib/year-end/get-year-end-inventory.service'
import type { PrepareResult } from '@/lib/year-end/prepare-year-end-entries.service'
import type { AdjustmentStatus } from '@/lib/year-end/inventory'
import { movementText } from './provisions-page'
import { AdjustmentBadge, euros, sendJson, useJson } from './shared'

interface Row {
  id: string
  kind: 'provision' | 'grant'
  label: string
  account: string
  movement: string
  status: AdjustmentStatus
  entry: { id: string; entryNumber: string } | null
}

/**
 * Year-end work (inventaire de clôture): every provision, impairment and
 * investment grant of the fiscal year with the entry it needs, and one
 * action that prepares the missing ones as drafts. Validating them stays
 * the user's act, on the Écritures page.
 */
export function YearEndPage({ companyId }: { companyId: string }) {
  const { can } = useCompanyAccess()
  const canPrepare = can({ entries: ['create'] })
  const [fiscalYearId, setFiscalYearId] = React.useState('')
  const [preparing, setPreparing] = React.useState(false)
  const [skipped, setSkipped] = React.useState<PrepareResult['skipped']>([])
  const url = fiscalYearId ? `/api/year-end?${new URLSearchParams({ companyId, fiscalYearId })}` : null
  const { data, error, reload } = useJson<YearEndInventory>(url, "L'inventaire de clôture ne s'est pas chargé. Réessayez dans un instant.")

  const rows: Row[] = data
    ? [
        ...data.provisions
          .filter((p) => p.status !== 'not_in_year')
          .map((p) => ({
            id: p.id,
            kind: 'provision' as const,
            label: p.label,
            account: p.accountCode,
            movement: p.status === 'to_assess' ? 'À évaluer' : p.reversalRefused ? 'Reprise interdite' : movementText(p.proposedCents + p.bookedCents),
            status: p.status,
            entry: p.entry,
          })),
        ...data.grants
          .filter((g) => g.status !== 'not_in_year')
          .map((g) => ({
            id: g.id,
            kind: 'grant' as const,
            label: g.label,
            account: g.transferAccountCode,
            movement: `Quote-part ${formatAmount((g.bookedCents + g.proposedCents) / 100)}`,
            status: g.status,
            entry: g.entry,
          })),
      ]
    : []
  const toPrepare = rows.filter((r) => r.status === 'to_post' || (r.status === 'to_correct' && r.entry !== null)).length

  const prepare = async () => {
    if (!data) return
    setPreparing(true)
    try {
      const result = await sendJson<PrepareResult>('/api/year-end/entries', 'POST', { companyId, fiscalYearId: data.fiscalYear.id }, "Les écritures n'ont pas été préparées. Réessayez dans un instant.")
      const count = result?.created.length ?? 0
      setSkipped(result?.skipped ?? [])
      toast.success(count === 0 ? 'Rien à préparer' : count === 1 ? '1 écriture préparée en brouillon' : `${count} écritures préparées en brouillon`)
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setPreparing(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Travaux de clôture"
        description="Les dotations, reprises et quotes-parts de subventions de l'exercice. Kledg les prépare en brouillon, vous les vérifiez et les validez avant de clôturer."
        docsHref={docsUrl('fiscalYear')}
        actions={
          canPrepare && data && !data.fiscalYear.isClosed ? (
            <Button onClick={prepare} loading={preparing} disabled={toPrepare === 0}>
              <FilePlus2 aria-hidden />
              Préparer les écritures
            </Button>
          ) : null
        }
      />
      <FiscalYearSelector id="year-end-fiscal-year" companyId={companyId} value={fiscalYearId} onValueChange={setFiscalYearId} showLabel={false} showPeriod={false} className="w-48" />

      {error ? (
        <EmptyState bordered title="L'inventaire ne s'est pas chargé" description={error} action={<Button size="sm" onClick={reload}>Réessayer</Button>} />
      ) : !data ? (
        <div className="space-y-6" aria-busy>
          <div className="grid gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Dotations à comptabiliser" value={<Amount value={euros(data.totals.dotationsCents)} />} hint="Provisions et dépréciations en hausse" />
            <StatCard label="Reprises à comptabiliser" value={<Amount value={euros(data.totals.reprisesCents)} />} hint="Risques réduits ou disparus" />
            <StatCard label="Quotes-parts de subventions" value={<Amount value={euros(data.totals.transfersCents)} />} hint="Du compte 139 au compte 747" />
          </div>
          {data.totals.toAssess > 0 ? (
            <p className="text-sm" role="status">
              {data.totals.toAssess === 1 ? '1 provision ou dépréciation attend' : `${data.totals.toAssess} provisions ou dépréciations attendent`} son montant à la clôture&nbsp;:{' '}
              <Link className="text-link underline-offset-4 hover:underline" href={`/${companyId}/provisions`}>
                évaluez-les
              </Link>
              .
            </p>
          ) : null}
          {skipped.length > 0 ? (
            <ul className="text-sm" role="alert">
              {skipped.map((s) => (
                <li key={s.itemId}>
                  <span className="font-medium">{s.label}</span>&nbsp;: {s.reason}
                </li>
              ))}
            </ul>
          ) : null}
          {rows.length === 0 ? (
            <EmptyState
              bordered
              icon={ClipboardCheck}
              title="Rien à comptabiliser pour cet exercice"
              description="Aucune provision, dépréciation ni subvention ne concerne cet exercice. Enregistrez-les sur leurs pages si la clôture en demande."
              action={
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/${companyId}/provisions`}>Provisions et dépréciations</Link>
                </Button>
              }
              secondaryAction={
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/${companyId}/investment-grants`}>Subventions d&apos;investissement</Link>
                </Button>
              }
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Écritures d&apos;inventaire {data.fiscalYear.year}</CardTitle>
                <CardDescription>
                  Au journal OD, datées du {formatDisplayDate(data.fiscalYear.endDate, 'short')}. Une écriture modifiée ou contre-passée est relue&nbsp;: Kledg propose ce qui
                  manque encore.
                </CardDescription>
              </CardHeader>
              <CardContent className="@container/list">
                <ul className="divide-y rounded-md border @min-[56rem]/list:hidden" aria-label="Écritures d'inventaire">
                  {rows.map((r) => (
                    <li key={`${r.kind}-${r.id}`} className="space-y-1 px-3 py-3">
                      <p className="text-sm font-medium">{r.label}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <AdjustmentBadge status={r.status} />
                        <span className="text-sm">{r.movement}</span>
                      </div>
                      {r.entry ? <EntryLink companyId={companyId} entry={r.entry} /> : null}
                    </li>
                  ))}
                </ul>
                <div className="hidden rounded-md border @min-[56rem]/list:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Élément</TableHead>
                        <TableHead>Compte</TableHead>
                        <TableHead numeric>Mouvement</TableHead>
                        <TableHead>Statut</TableHead>
                        <TableHead>Écriture</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={`${r.kind}-${r.id}`}>
                          <TableCell className="max-w-md font-medium">{r.label}</TableCell>
                          <TableCell className="font-mono text-xs">{r.account}</TableCell>
                          <TableCell numeric>{r.movement}</TableCell>
                          <TableCell>
                            <AdjustmentBadge status={r.status} />
                          </TableCell>
                          <TableCell>{r.entry ? <EntryLink companyId={companyId} entry={r.entry} /> : <span className="text-muted-foreground">-</span>}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function EntryLink({ companyId, entry }: { companyId: string; entry: { id: string; entryNumber: string } }) {
  return (
    <Link className="text-link font-mono text-xs underline-offset-4 hover:underline" href={`/${companyId}/entries/${entry.id}`}>
      {entry.entryNumber}
    </Link>
  )
}
