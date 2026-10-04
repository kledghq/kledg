'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Download, FileText, Signature } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Amount, DateDisplay, EmptyState, PageHeader, StatCard, StatusBadge } from '@/components/shared'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { sendJson, useJson } from '@/components/features/year-end/shared'
import { docsUrl } from '@/lib/docs-links'
import type { ApprovalView } from '@/lib/approval/get-approval.service'
import type { ApprovalDetails } from '@/lib/approval/schemas'
import { ApprovalForm } from './approval-form'

const euros = (cents: number) => cents / 100

/** The accounts to approve are those of the latest fiscal year already ended. */
const latestEnded = (years: Array<{ id: string; endDate: string }>) => {
  const today = new Date().toISOString().slice(0, 10)
  return [...years].filter((fy) => fy.endDate.slice(0, 10) < today).sort((a, b) => b.endDate.localeCompare(a.endDate))[0]?.id
}

/**
 * Approbation des comptes: the documents to have the year's accounts
 * approved by the associés (convocation, management report, minutes or
 * decision of the associé unique, attendance sheet), then filed with the
 * greffe, driven by the company's legal form (lib/approval). Data comes
 * from the books and the company record; what only the user knows is asked
 * in the form, never guessed.
 */
export function ApprovalPage({ companyId }: { companyId: string }) {
  const [fiscalYearId, setFiscalYearId] = React.useState('')
  const url = fiscalYearId ? `/api/companies/${companyId}/fiscal-years/${fiscalYearId}/approval` : null
  const { data, error, reload } = useJson<ApprovalView>(url, "L'approbation des comptes ne s'est pas chargée. Réessayez dans un instant.")
  // The answer of a save replaces the loaded view until the next load.
  const [saved, setSaved] = React.useState<{ base: ApprovalView | null; view: ApprovalView } | null>(null)
  const view = saved && saved.base === data ? saved.view : data
  const [saving, setSaving] = React.useState(false)

  const save = async (details: ApprovalDetails) => {
    if (!url) return
    setSaving(true)
    try {
      const next = await sendJson<ApprovalView>(url, 'PUT', details, "L'enregistrement a échoué. Réessayez dans un instant.")
      if (next) setSaved({ base: data, view: next })
      toast.success('Approbation enregistrée')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const pack = view?.pack
  const regime = pack?.regime

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approbation des comptes"
        description="Les documents pour faire approuver les comptes de l'exercice par les associés, puis les déposer au greffe, selon la forme juridique de la société."
        docsHref={docsUrl('calendar')}
      />
      <FiscalYearSelector id="approval-fiscal-year" companyId={companyId} value={fiscalYearId} onValueChange={setFiscalYearId} showLabel={false} showPeriod={false} className="w-48" pickDefault={latestEnded} />

      {error ? (
        <EmptyState bordered title="L'approbation des comptes ne s'est pas chargée" description={error} action={<Button size="sm" onClick={reload}>Réessayer</Button>} />
      ) : !view || !pack ? (
        <Skeleton className="h-64 w-full rounded-lg" aria-busy />
      ) : !regime ? (
        <EmptyState
          bordered
          icon={Signature}
          title="Forme juridique non prise en charge"
          description={pack.unsupported ?? ''}
          action={
            <Button size="sm" asChild>
              <Link href={`/${companyId}/informations`}>Informations de la société</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Forme juridique" value={<span className="text-lg">{regime.form}</span>} hint={`Décide\u00a0: ${regime.decidingBody}`} />
            <StatCard label="Résultat de l'exercice" value={<Amount value={euros(pack.resultCents)} tone="signed" />} hint={view.context.fiscalYear.isClosed ? 'Exercice clôturé' : 'Exercice ouvert'} />
            <StatCard
              label="Approbation"
              value={pack.deadlines.approval ? <DateDisplay value={pack.deadlines.approval} format="short" /> : <span className="text-lg">Selon les statuts</span>}
              hint={view.details.approvedOn ? <>Approuvés le <DateDisplay value={view.details.approvedOn} format="short" /></> : 'Date limite'}
            />
            <StatCard
              label="Dépôt au greffe"
              value={pack.deadlines.filing ? <DateDisplay value={pack.deadlines.filing} format="short" /> : <span className="text-lg">Pas de dépôt</span>}
              hint={view.details.filedOn ? <>Déposés le <DateDisplay value={view.details.filedOn} format="short" /></> : pack.deadlines.filing ? 'Date limite' : undefined}
            />
          </div>

          {pack.warnings.length > 0 ? (
            <Alert>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-5">
                  {pack.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
              <CardDescription>En PDF à signer, ou en Markdown à modifier avant signature. Un document se génère quand rien ne lui manque.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y rounded-md border">
                {pack.documents.map((d) => {
                  const ready = d.missing.length === 0
                  const href = (format: 'pdf' | 'md') => `/api/companies/${companyId}/fiscal-years/${view.context.fiscalYear.id}/approval/documents/${d.id}?format=${format}`
                  return (
                    <li key={d.id} className="space-y-2 px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <FileText className="text-muted-foreground size-4" aria-hidden />
                          <span className="text-sm font-medium">{d.title}</span>
                          <StatusBadge tone={ready ? 'success' : 'warning'}>{ready ? 'Prêt' : 'À compléter'}</StatusBadge>
                          {d.required ? null : <StatusBadge tone="neutral">Facultatif</StatusBadge>}
                        </div>
                        <div className="flex gap-2">
                          {ready ? (
                            <>
                              <Button size="xs" variant="outline" asChild>
                                <a href={href('pdf')} download>
                                  <Download aria-hidden />
                                  PDF
                                </a>
                              </Button>
                              <Button size="xs" variant="outline" asChild>
                                <a href={href('md')} download>
                                  <Download aria-hidden />
                                  Markdown
                                </a>
                              </Button>
                            </>
                          ) : (
                            <Button size="xs" variant="outline" disabled>
                              PDF
                            </Button>
                          )}
                        </div>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        {d.reason} {d.sources.length > 0 ? `(${d.sources.map((s) => s.label).join(', ')})` : ''}
                      </p>
                      {!ready ? (
                        <ul className="list-disc space-y-0.5 pl-5 text-xs">
                          {d.missing.map((m) => (
                            <li key={m}>{m}</li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>

          <ApprovalForm view={view} saving={saving} onSave={save} />

          <Card>
            <CardHeader>
              <CardTitle>{pack.publication.required ? 'Dépôt des comptes au greffe' : 'Conservation des documents'}</CardTitle>
              <CardDescription>
                {pack.publication.required
                  ? 'Les pièces à déposer après l’approbation, et dans quel délai.'
                  : 'Une société civile ne dépose pas ses comptes au greffe.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {pack.publication.items.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5">
                  {pack.publication.items.map((i) => (
                    <li key={i.text}>
                      {i.text} <span className="text-muted-foreground text-xs">({i.sources.map((s) => s.label).join(', ')})</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <ul className="text-muted-foreground list-disc space-y-1 pl-5">
                {pack.publication.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sources</CardTitle>
              <CardDescription>Les textes appliqués pour la forme {regime.form}. Faites relire les documents par votre expert-comptable ou votre conseil.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {view.sources.map((s) => (
                  <li key={s.label}>
                    <a className="text-link underline-offset-4 hover:underline pointer-coarse:-my-3 pointer-coarse:py-3" href={s.url} target="_blank" rel="noreferrer">
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
