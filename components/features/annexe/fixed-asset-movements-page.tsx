'use client'

import * as React from 'react'
import { Download, Package } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Amount, EmptyState, HelpTip, PageHeader, StatusBadge } from '@/components/shared'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { downloadFile } from '@/components/features/reports/download-file'
import { euros, useJson } from '@/components/features/year-end/shared'
import { docsUrl } from '@/lib/docs-links'
import { COLUMN_LABELS } from '@/lib/annexe/fixed-asset-document'
import type { DisposalReport, FixedAssetReport } from '@/lib/annexe/fixed-asset-report'
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

const day = (iso: string) => iso.split('-').reverse().join('/')
const signed = (cents: number | null) => (cents === null ? <span className="text-muted-foreground">Non déterminé</span> : <Amount value={euros(cents)} />)

/**
 * Disposals of the year: one line per asset that left (2033-C-SD cadre III
 * and 2059-A-SD cadre I, the column numbers of 2059-A under the headings),
 * then the box totals of 2033-C.
 */
function DisposalTable({ disposals }: { disposals: DisposalReport }) {
  if (disposals.rows.length === 0) {
    return <p className="text-muted-foreground text-sm">Aucune sortie d&apos;immobilisation enregistrée dans l&apos;exercice. Enregistrez une vente ou une mise au rebut depuis la page Immobilisations.</p>
  }
  const heading = (label: string, column: string) => (
    <TableHead numeric className="min-w-32">
      {label}
      <span className="text-muted-foreground block font-mono text-xs font-normal">2059-A col. {column}</span>
    </TableHead>
  )
  return (
    <>
      <div className="overflow-x-auto rounded-md border">
        <Table aria-label="Plus et moins-values de l'exercice">
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-56">Immobilisation</TableHead>
              {heading("Valeur d'origine", '2')}
              {heading('Amortissements', '5')}
              {heading('Valeur résiduelle', '6')}
              {heading('Prix de cession', '7')}
              {heading('Plus ou moins-value', '8')}
              {heading('Court terme', '9')}
              {heading('Long terme', '10')}
            </TableRow>
          </TableHeader>
          <TableBody>
            {disposals.rows.map((r) => (
              <TableRow key={r.fixedAssetId}>
                <TableCell>
                  {r.label}
                  <span className="text-muted-foreground block text-xs">
                    {r.kindLabel}, acquise le {day(r.acquisitionDate)}, sortie le {day(r.disposalDate)} ({r.assetAccountCode})
                  </span>
                </TableCell>
                <TableCell numeric><Amount value={euros(r.grossCents)} /></TableCell>
                <TableCell numeric><Amount value={euros(r.depreciationCents)} /></TableCell>
                <TableCell numeric><Amount value={euros(r.residualCents)} /></TableCell>
                <TableCell numeric><Amount value={euros(r.priceCents)} /></TableCell>
                <TableCell numeric><Amount value={euros(r.gainCents)} /></TableCell>
                <TableCell numeric>{signed(r.shortTermCents)}</TableCell>
                <TableCell numeric>{signed(r.longTermCents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table aria-label="2033-C-SD, cadre III, totaux">
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-56">2033-C-SD, cadre III</TableHead>
              <TableHead className="w-20">Case</TableHead>
              <TableHead numeric className="min-w-32">Montant</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {disposals.form2033c.map((t) => (
              <TableRow key={t.box}>
                <TableCell>
                  {t.label}
                  {t.note ? <span className="text-muted-foreground block text-xs">{t.note}</span> : null}
                </TableCell>
                <TableCell className="font-mono">{t.box}</TableCell>
                <TableCell numeric>{t.cents === null ? <span className="text-muted-foreground">Non suivi</span> : <Amount value={euros(t.cents)} />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
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
        description="Les mouvements de l'exercice ligne par ligne des formulaires 2054, 2055 et 2033-C, lus dans les écritures validées et rapprochés du bilan et du registre des immobilisations, puis les plus et moins-values des sorties (2033-C cadre III, 2059-A)."
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
              <CardDescription>La valeur brute à la fin doit égaler l&apos;actif immobilisé brut du bilan&nbsp;; le registre des immobilisations doit expliquer les mouvements.</CardDescription>
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

          {/* The three forms stacked (no tabs): a company files 2054 and 2055 (réel normal) or 2033-C (simplifié) */}
          <section aria-labelledby="form-2054-title" className="space-y-4">
            <h2 id="form-2054-title" className="text-base font-semibold">
              2054, immobilisations
            </h2>
            <p className="text-muted-foreground text-sm">
              Régime réel normal, formulaire 2054-SD.{' '}
              <HelpTip term="Virements de poste à poste">Une immobilisation en cours mise en service passe du compte 23 au compte de l&apos;immobilisation&nbsp;: elle sort d&apos;une ligne et entre dans une autre.</HelpTip>
            </p>
            <FormTable caption="2054-SD, cadre A" rows={data.form2054} columns={['opening', 'revaluation', 'increase'] as const} labels={COLUMN_LABELS.asset} />
            <FormTable caption="2054-SD, cadre B" rows={data.form2054} columns={['transferOut', 'disposal', 'closing', 'origin'] as const} labels={COLUMN_LABELS.asset} />
          </section>
          <section aria-labelledby="form-2055-title" className="space-y-4">
            <h2 id="form-2055-title" className="text-base font-semibold">
              2055, amortissements
            </h2>
            <p className="text-muted-foreground text-sm">Régime réel normal, formulaire 2055-SD, cadre A. Les amortissements dérogatoires (cadre B) ne sont pas suivis par Kledg.</p>
            <FormTable caption="2055-SD, cadre A" rows={data.form2055} columns={['opening', 'allowance', 'decrease', 'closing'] as const} labels={COLUMN_LABELS.depreciation} />
          </section>
          <section aria-labelledby="form-2033c-title" className="space-y-4">
            <h2 id="form-2033c-title" className="text-base font-semibold">
              2033-C, régime simplifié
            </h2>
            <p className="text-muted-foreground text-sm">Régime simplifié, formulaire 2033-C-SD, cadres I et II. Le cadre III est plus bas, avec les plus et moins-values.</p>
            <FormTable caption="2033-C-SD, cadre I" rows={data.form2033c.assets} columns={['opening', 'increase', 'decrease', 'closing'] as const} labels={COLUMN_LABELS.simplified} />
            <FormTable caption="2033-C-SD, cadre II" rows={data.form2033c.depreciation} columns={['opening', 'allowance', 'decrease', 'closing'] as const} labels={COLUMN_LABELS.depreciation} />
          </section>
          <section aria-labelledby="disposals-title" className="space-y-4">
            <h2 id="disposals-title" className="text-base font-semibold">
              Plus et moins-values (2033-C cadre III, 2059-A)
            </h2>
            <p className="text-muted-foreground text-sm">
              Les sorties enregistrées au registre, amortissements arrêtés au jour de la sortie. Une ligne par immobilisation, à reporter au cadre III du 2033-C-SD
              (régime simplifié) ou au cadre I du 2059-A-SD (régime réel normal).{' '}
              <HelpTip term="Court et long terme">
                À l&apos;IS, tout est à court terme, déjà dans le résultat comptable. À l&apos;IR, un bien détenu deux ans au moins donne du long terme&nbsp;: la plus-value au-delà des amortissements, ou toute la plus ou moins-value d&apos;un bien non amortissable.
              </HelpTip>
            </p>
            <DisposalTable disposals={data.disposals} />
          </section>
        </>
      )}
    </div>
  )
}
