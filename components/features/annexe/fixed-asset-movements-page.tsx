'use client'

import * as React from 'react'
import { Download, Package } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Amount, EmptyState, HelpTip, PageHeader, StatusBadge } from '@/components/shared'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { downloadFile } from '@/components/features/reports/download-file'
import { euros, useJson } from '@/components/features/year-end/shared'
import { docsUrl } from '@/lib/docs-links'
import { COLUMN_LABELS } from '@/lib/annexe/fixed-asset-document'
import type { FixedAssetReport } from '@/lib/annexe/fixed-asset-report'
import type { FormRow } from '@/lib/annexe/movements'

/** One form as a table: a row per line, the box code under each amount. */
function FormTable<C extends string>({ rows, columns, labels, caption }: { rows: FormRow<C>[]; columns: readonly C[]; labels: Record<C, string>; caption: string }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table aria-label={caption}>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-56">Ligne</TableHead>
            {columns.map((c) => (
              <TableHead key={c} numeric className="min-w-32">
                {labels[c]}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className={r.isTotal ? 'font-medium' : undefined}>
              <TableCell>
                {r.label}
                {r.accounts.length > 0 ? <span className="text-muted-foreground block font-mono text-xs">{r.accounts.join(', ')}</span> : null}
              </TableCell>
              {columns.map((c) => (
                <TableCell key={c} numeric>
                  {r.amounts[c] === null ? <span className="text-muted-foreground">Non suivi</span> : <Amount value={euros(r.amounts[c])} />}
                  {r.codes[c] ? <span className="text-muted-foreground block font-mono text-xs">{r.codes[c]}</span> : null}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * Forms 2054-SD, 2055-SD and 2033-C-SD of a fiscal year, read from the
 * entries, with the checks against the balance sheet and the fixed asset
 * register, and the PDF and CSV exports.
 */
export function FixedAssetMovementsPage({ companyId }: { companyId: string }) {
  const [fiscalYearId, setFiscalYearId] = React.useState('')
  const [exporting, setExporting] = React.useState<'pdf' | 'csv' | null>(null)
  const url = fiscalYearId ? `/api/reports/fixed-asset-movements?${new URLSearchParams({ companyId, fiscalYearId })}` : null
  const { data, error, reload } = useJson<FixedAssetReport>(url, "Les tableaux des immobilisations ne se sont pas chargés. Réessayez dans un instant.")

  const exportAs = async (format: 'pdf' | 'csv') => {
    setExporting(format)
    try {
      await downloadFile(`/api/reports/fixed-asset-movements/export?${new URLSearchParams({ companyId, fiscalYearId, format })}`, `Immobilisations.${format}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setExporting(null)
    }
  }
  const differing = data?.checks.filter((c) => !c.ok) ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Immobilisations et amortissements"
        description="Les mouvements de l'exercice ligne par ligne des formulaires 2054, 2055 et 2033-C, lus dans les écritures validées et rapprochés du bilan et du registre des immobilisations."
        docsHref={docsUrl('depreciation')}
        actions={
          data ? (
            <>
              <Button variant="outline" loading={exporting === 'csv'} onClick={() => exportAs('csv')}>
                <Download aria-hidden />
                CSV
              </Button>
              <Button variant="outline" loading={exporting === 'pdf'} onClick={() => exportAs('pdf')}>
                <Download aria-hidden />
                PDF
              </Button>
            </>
          ) : null
        }
      />
      <FiscalYearSelector id="fixed-asset-fiscal-year" companyId={companyId} value={fiscalYearId} onValueChange={setFiscalYearId} showLabel={false} showPeriod={false} className="w-48" />

      {error ? (
        <EmptyState bordered title="Les tableaux ne se sont pas chargés" description={error} action={<Button size="sm" onClick={reload}>Réessayer</Button>} />
      ) : !data ? (
        <Skeleton className="h-96 w-full rounded-lg" aria-busy />
      ) : data.form2054.every((r) => r.amounts.closing === 0 && r.amounts.opening === 0) && data.form2055.every((r) => r.amounts.closing === 0) ? (
        <EmptyState
          bordered
          icon={Package}
          title="Aucune immobilisation dans les écritures de l'exercice"
          description="Les comptes 20 à 28 n'ont ni solde ni mouvement validé. Enregistrez les acquisitions dans Immobilisations, puis validez leurs écritures."
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Contrôles
                {differing.length === 0 ? <StatusBadge tone="success">Concordants</StatusBadge> : <StatusBadge tone="warning">{differing.length} à vérifier</StatusBadge>}
              </CardTitle>
              <CardDescription>La valeur brute à la fin doit égaler l&apos;actif immobilisé brut du bilan ; le registre des immobilisations doit expliquer les mouvements.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {differing.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5">
                  {differing.map((c) => (
                    <li key={c.id}>
                      <span className="font-medium">{c.label}</span>&nbsp;: {c.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{data.checks.length} contrôles, tous concordants.</p>
              )}
              {data.warnings.length > 0 ? (
                <ul className="text-muted-foreground list-disc space-y-1 pl-5">
                  {data.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>

          <Tabs defaultValue="2054">
            <TabsList>
              <TabsTrigger value="2054">2054</TabsTrigger>
              <TabsTrigger value="2055">2055</TabsTrigger>
              <TabsTrigger value="2033c">2033-C</TabsTrigger>
            </TabsList>
            <TabsContent value="2054" className="space-y-4">
              <p className="text-muted-foreground text-sm">
                Régime réel normal, formulaire 2054-SD.{' '}
                <HelpTip term="Virements de poste à poste">Une immobilisation en cours mise en service passe du compte 23 au compte de l&apos;immobilisation&nbsp;: elle sort d&apos;une ligne et entre dans une autre.</HelpTip>
              </p>
              <FormTable caption="2054-SD, cadre A" rows={data.form2054} columns={['opening', 'revaluation', 'increase'] as const} labels={COLUMN_LABELS.asset} />
              <FormTable caption="2054-SD, cadre B" rows={data.form2054} columns={['transferOut', 'disposal', 'closing', 'origin'] as const} labels={COLUMN_LABELS.asset} />
            </TabsContent>
            <TabsContent value="2055" className="space-y-4">
              <p className="text-muted-foreground text-sm">Régime réel normal, formulaire 2055-SD, cadre A. Les amortissements dérogatoires (cadre B) ne sont pas suivis par Kledg.</p>
              <FormTable caption="2055-SD, cadre A" rows={data.form2055} columns={['opening', 'allowance', 'decrease', 'closing'] as const} labels={COLUMN_LABELS.depreciation} />
            </TabsContent>
            <TabsContent value="2033c" className="space-y-4">
              <p className="text-muted-foreground text-sm">Régime simplifié, formulaire 2033-C-SD, cadres I et II. Le cadre III (plus et moins-values) reste à remplir.</p>
              <FormTable caption="2033-C-SD, cadre I" rows={data.form2033c.assets} columns={['opening', 'increase', 'decrease', 'closing'] as const} labels={COLUMN_LABELS.simplified} />
              <FormTable caption="2033-C-SD, cadre II" rows={data.form2033c.depreciation} columns={['opening', 'allowance', 'decrease', 'closing'] as const} labels={COLUMN_LABELS.depreciation} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
