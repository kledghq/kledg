'use client'

import * as React from 'react'
import Link from 'next/link'
import { Download, Files } from 'lucide-react'
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
import { SOURCE_LABELS, valueText } from '@/lib/liasse/liasse-document'
import type { LiasseTable, LiasseView } from '@/lib/liasse/build-liasse'
import type { LiasseCell, LiasseForm, LiasseSection } from '@/lib/liasse/cells'

/** One box: its value (or "À remplir" with the reason), its code and where the value comes from. */
function CellView({ cell, showLabel = false }: { cell: LiasseCell; showLabel?: boolean }) {
  return (
    <div className="space-y-0.5">
      {showLabel ? <span className="text-muted-foreground block text-xs">{cell.label}</span> : null}
      {cell.value === null ? (
        <span className="text-muted-foreground">À remplir</span>
      ) : cell.value.kind === 'amount' ? (
        <Amount value={euros(cell.value.cents)} />
      ) : (
        <span>{valueText(cell.value)}</span>
      )}
      {cell.box ? <span className="text-muted-foreground block font-mono text-xs">{cell.box}</span> : null}
      {cell.pending?.length ? <span className="text-muted-foreground block text-xs">Sans les cases à remplir&nbsp;: {cell.pending.join(', ')}</span> : null}
      {cell.value === null && cell.hint ? <span className="text-muted-foreground block text-xs">Repère&nbsp;: {valueText(cell.hint)}</span> : null}
      {cell.value === null && cell.note ? <span className="text-muted-foreground block text-xs">{cell.note}</span> : null}
    </div>
  )
}

function SectionTable({ section }: { section: LiasseSection }) {
  if (section.rows.length === 0) {
    return (
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{section.title}</h3>
        {section.note ? <p className="text-muted-foreground text-sm">{section.note}</p> : null}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{section.title}</h3>
      <div className="overflow-x-auto rounded-md border">
        {section.columns ? (
          <Table aria-label={section.title}>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-56">Ligne</TableHead>
                {section.columns.map((c) => (
                  <TableHead key={c} numeric className="min-w-32">
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {section.rows.map((r) => (
                <TableRow key={r.id} className={r.total ? 'font-medium' : undefined}>
                  <TableCell>{r.label}</TableCell>
                  {r.cells.map((c, i) => (
                    <TableCell key={`${r.id}-${i}`} numeric>
                      <CellView cell={c} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Table aria-label={section.title}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Case</TableHead>
                <TableHead className="min-w-56">Libellé</TableHead>
                <TableHead numeric className="min-w-40">
                  Valeur
                </TableHead>
                <TableHead className="min-w-28">Origine</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {section.rows.flatMap((r) =>
                r.cells.map((c, i) => (
                  <TableRow key={`${r.id}-${i}`} className={r.total ? 'font-medium' : undefined}>
                    <TableCell className="font-mono text-xs">{c.box ?? ''}</TableCell>
                    <TableCell>
                      {c.label}
                      {c.value !== null && c.note ? <span className="text-muted-foreground block text-xs">{c.note}</span> : null}
                    </TableCell>
                    <TableCell numeric>
                      <CellView cell={{ ...c, box: null }} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{SOURCE_LABELS[c.source]}</TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}

function FormView({ form }: { form: LiasseForm }) {
  const toReview = form.checks.filter((c) => !c.ok)
  const titleId = `form-${form.id}`
  return (
    <section aria-labelledby={titleId} className="space-y-4">
      <div className="space-y-1">
        <h2 id={titleId} className="text-base font-semibold">
          {form.number}, {form.title.charAt(0).toLowerCase() + form.title.slice(1)}
        </h2>
        {form.required.reason ? <p className="text-muted-foreground text-sm">{form.required.reason}</p> : null}
      </div>
      {form.checks.length > 0 || form.warnings.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Contrôles
              {toReview.length === 0 ? <StatusBadge tone="success">Concordants</StatusBadge> : <StatusBadge tone="warning">{toReview.length} à vérifier</StatusBadge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {toReview.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5">
                {toReview.map((c) => (
                  <li key={c.id}>
                    <span className="font-medium">{c.label}</span>&nbsp;: {c.message}
                  </li>
                ))}
              </ul>
            ) : form.checks.length > 0 ? (
              <p className="text-muted-foreground">
                {form.checks.length} contrôle{form.checks.length > 1 ? 's' : ''}, tous concordants.
              </p>
            ) : null}
            {form.warnings.length > 0 ? (
              <ul className="text-muted-foreground list-disc space-y-1 pl-5">
                {form.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {form.sections.map((s) => (
        <SectionTable key={s.id} section={s} />
      ))}
    </section>
  )
}

function TableStatus({ table, companyId }: { table: LiasseTable; companyId: string }) {
  if (table.status === 'here') {
    const c = table.coverage
    return (
      <div className="space-y-1">
        <a className="text-link underline-offset-4 hover:underline" href={`#form-${table.id}`}>
          Plus bas
        </a>
        {c ? (
          <span className="text-muted-foreground block text-xs">
            {c.computed} case{c.computed > 1 ? 's' : ''} préparée{c.computed > 1 ? 's' : ''}, {c.manual} à remplir
            {c.checksToReview > 0 ? `, ${c.checksToReview} contrôle${c.checksToReview > 1 ? 's' : ''} à vérifier` : ''}
          </span>
        ) : null}
      </div>
    )
  }
  if (table.status === 'page' && table.href) {
    return (
      <Link className="text-link underline-offset-4 hover:underline" href={`/${companyId}${table.href}`}>
        Ouvrir la page
      </Link>
    )
  }
  return <StatusBadge tone="neutral">À remplir à la main</StatusBadge>
}

/**
 * The liasse fiscale of a fiscal year: every table of the company's regime
 * with where Kledg prepares it, then the tables prepared here box by box,
 * with their checks, and the PDF and CSV exports.
 */
export function LiassePage({ companyId }: { companyId: string }) {
  const [fiscalYearId, setFiscalYearId] = React.useState('')
  const [exporting, setExporting] = React.useState<'pdf' | 'csv' | null>(null)
  const url = fiscalYearId ? `/api/reports/liasse?${new URLSearchParams({ companyId, fiscalYearId })}` : null
  const { data, error, reload } = useJson<LiasseView>(url, "La liasse fiscale ne s'est pas chargée. Réessayez dans un instant.")

  const exportAs = async (format: 'pdf' | 'csv') => {
    setExporting(format)
    try {
      await downloadFile(`/api/reports/liasse/export?${new URLSearchParams({ companyId, fiscalYearId, format })}`, `Liasse_fiscale.${format}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Liasse fiscale"
        description="Les tableaux de la déclaration de résultat de votre régime, case par case : ce que les écritures et les fiches de la société donnent, et ce qui reste à remplir à la main."
        docsHref={docsUrl('liasseFiscale')}
        actions={
          data?.status === 'ready' ? (
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
      <FiscalYearSelector id="liasse-fiscal-year" companyId={companyId} value={fiscalYearId} onValueChange={setFiscalYearId} showLabel={false} showPeriod={false} className="w-48" />

      {error ? (
        <EmptyState bordered title="La liasse ne s'est pas chargée" description={error} action={<Button size="sm" onClick={reload}>Réessayer</Button>} />
      ) : !data ? (
        <Skeleton className="h-96 w-full rounded-lg" aria-busy />
      ) : data.status !== 'ready' ? (
        <EmptyState
          bordered
          icon={Files}
          title={data.status === 'missing-regime' ? "Le régime d'impôt sur les sociétés n'est pas renseigné" : "La société n'est pas soumise à l'impôt sur les sociétés"}
          description={
            data.status === 'missing-regime'
              ? 'Choisissez le régime simplifié ou le régime réel normal dans les informations de la société : la liasse en dépend.'
              : "Kledg prépare la liasse des sociétés à l'impôt sur les sociétés (déclaration 2065-SD)."
          }
          action={
            data.status === 'missing-regime' ? (
              <Button size="sm" asChild>
                <Link href={`/${companyId}/informations`}>Renseigner le régime</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Tableaux de la liasse
                <StatusBadge tone="info">{data.regime === 'simplified' ? 'Régime simplifié' : 'Régime réel normal'}</StatusBadge>
              </CardTitle>
              <CardDescription>
                {data.filing}{' '}
                <HelpTip term="Liasse fiscale">
                  L&apos;ensemble des tableaux joints à la déclaration de résultat&nbsp;: bilan, compte de résultat, résultat fiscal, immobilisations, provisions, capital et filiales.
                </HelpTip>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="overflow-x-auto rounded-md border">
                <Table aria-label="Tableaux de la liasse">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Tableau</TableHead>
                      <TableHead className="min-w-56">Intitulé</TableHead>
                      <TableHead className="min-w-48">Où le préparer</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.tables.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-mono text-xs">{t.number}</TableCell>
                        <TableCell>
                          {t.title}
                          {t.note ? <span className="text-muted-foreground block text-xs">{t.note}</span> : null}
                        </TableCell>
                        <TableCell>
                          <TableStatus table={t} companyId={companyId} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {data.warnings.length > 0 ? (
                <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
                  {data.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>

          {/* The tables stacked (no tabs), in the order of the liasse */}
          {data.forms.map((form) => (
            <FormView key={form.id} form={form} />
          ))}

          <p className="text-muted-foreground text-xs">
            Formulaires officiels&nbsp;:{' '}
            {data.sources.map((s, i) => (
              <React.Fragment key={s.url}>
                {i > 0 ? ' ; ' : null}
                <a className="text-link underline-offset-4 hover:underline" href={s.url} target="_blank" rel="noreferrer">
                  {s.label}
                </a>
              </React.Fragment>
            ))}
          </p>
        </>
      )}
    </div>
  )
}
