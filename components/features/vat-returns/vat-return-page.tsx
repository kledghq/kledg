'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowRight, CalendarClock, Download, FilePlus2, FileText, Info, Landmark } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AmountInput } from '@/components/ui/amount-input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DateInput } from '@/components/ui/date-input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Amount, ConfirmDialog, DateDisplay, EmptyState, Field, PageHeader, StatCard, StatusBadge, formatDisplayDate, type StatusTone } from '@/components/shared'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { euros, sendJson, useJson } from '@/components/features/year-end/shared'
import { plural } from '@/lib/utils/plural'
import { docsUrl } from '@/lib/docs-links'
import type { VatReturnView } from '@/lib/vat-returns/load-vat-return.service'
import type { VatReturnLine } from '@/lib/vat-returns/compute'
import type { CheckSeverity } from '@/lib/vat-returns/checks'
import type { VatSettlementResult } from '@/lib/vat-returns/prepare-vat-settlement.service'

const SEVERITY: Record<CheckSeverity, { tone: StatusTone; label: string }> = {
  blocking: { tone: 'danger', label: 'À corriger' },
  warning: { tone: 'warning', label: 'À vérifier' },
  info: { tone: 'info', label: 'Information' },
  ok: { tone: 'success', label: 'OK' },
}

const ORIGIN: Record<VatReturnLine['status'], { tone: StatusTone; label: string }> = {
  computed: { tone: 'success', label: 'Calculé' },
  manual: { tone: 'warning', label: 'À remplir' },
  total: { tone: 'neutral', label: 'Total' },
}

const LOAD_ERROR = 'La déclaration de TVA ne s’est pas chargée. Réessayez dans un instant.'

/** Whole euros as the form wants them ("1 234 €"), empty for a column the line does not have. */
function FormEuros({ value }: { value: number | null }) {
  if (value === null) return null
  return <Amount value={value} decimals={0} />
}

/** The amount of the books under the figure to type, when they differ (rounding to the euro). */
function BooksAmount({ cents, formEuros }: { cents: number | null; formEuros: number | null }) {
  if (cents === null || formEuros === null || cents === formEuros * 100) return null
  return (
    <span className="text-muted-foreground block text-xs">
      comptes&nbsp;: <Amount value={euros(cents)} />
    </span>
  )
}

function LinesTable({ lines }: { lines: VatReturnLine[] }) {
  return (
    <>
      <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">Ligne</TableHead>
              <TableHead className="w-16">Case</TableHead>
              <TableHead>Libellé</TableHead>
              <TableHead numeric className="w-36">
                Base hors taxe
              </TableHead>
              <TableHead numeric className="w-36">
                Taxe ou montant
              </TableHead>
              <TableHead className="w-28">Origine</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={`${line.code}-${line.box}`} className={line.status === 'total' ? 'font-medium' : undefined}>
                <TableCell className="font-mono text-xs">{line.code}</TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">{line.box ?? ''}</TableCell>
                <TableCell className="whitespace-normal">
                  <span className="block">{line.label}</span>
                  <span className="text-muted-foreground block text-xs">{line.hint}</span>
                </TableCell>
                <TableCell numeric>
                  <FormEuros value={line.base} />
                  <BooksAmount cents={line.baseCents} formEuros={line.base} />
                </TableCell>
                <TableCell numeric>
                  <FormEuros value={line.amount} />
                  <BooksAmount cents={line.amountCents} formEuros={line.amount} />
                </TableCell>
                <TableCell>
                  <StatusBadge tone={ORIGIN[line.status].tone}>{ORIGIN[line.status].label}</StatusBadge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="divide-y lg:hidden" aria-label="Lignes de la déclaration">
        {lines.map((line) => (
          <li key={`${line.code}-${line.box}`} className="space-y-1 py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm">
                <span className="font-mono text-xs">{line.code}</span> {line.label}
              </p>
              <StatusBadge tone={ORIGIN[line.status].tone} className="shrink-0">
                {ORIGIN[line.status].label}
              </StatusBadge>
            </div>
            <dl className="text-sm">
              {line.base !== null ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Base</dt>
                  <dd className="num">
                    <FormEuros value={line.base} />
                  </dd>
                </div>
              ) : null}
              {line.amount !== null ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{line.columns === 'base-tax' ? 'Taxe' : 'Montant'}</dt>
                  <dd className="num">
                    <FormEuros value={line.amount} />
                  </dd>
                </div>
              ) : null}
            </dl>
            <p className="text-muted-foreground text-xs">
              {line.box ? `Case ${line.box}. ` : ''}
              {line.hint}
            </p>
          </li>
        ))}
      </ul>
    </>
  )
}

function FilingCard({ companyId, view, canWrite, onSaved }: { companyId: string; view: VatReturnView; canWrite: boolean; onSaved: () => void }) {
  const result = view.computation?.result
  const [filedOn, setFiledOn] = React.useState(view.today)
  const [due, setDue] = React.useState<number | null>((result?.dueEuros ?? 0) * 100)
  const [credit, setCredit] = React.useState<number | null>((result?.creditEuros ?? 0) * 100)
  const [saving, setSaving] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const period = view.period
  if (!period) return null
  const url = `/api/companies/${encodeURIComponent(companyId)}/vat-returns/filing`

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await sendJson(url, 'PUT', { period: period.id, filedOn, amountDueCents: due ?? 0, creditCents: credit ?? 0 }, 'Le dépôt n’a pas été enregistré. Réessayez dans un instant.')
      toast.success('Dépôt enregistré')
      onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setSaving(true)
    try {
      await sendJson(`${url}?period=${encodeURIComponent(period.id)}`, 'DELETE', undefined, 'Le dépôt n’a pas été retiré. Réessayez dans un instant.')
      toast.success('Dépôt retiré')
      setConfirmOpen(false)
      onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Dépôt sur impots.gouv.fr</h2>
        </CardTitle>
        <CardDescription>
          Kledg ne dépose pas la déclaration. Une fois déposée dans votre espace professionnel, indiquez-le ici&nbsp;: la période suivante vérifiera le paiement et le crédit reporté.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {view.filing ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              Déposée le <DateDisplay value={view.filing.filedOn} format="long" />
              {view.filing.amountDueCents > 0 ? (
                <>
                  , <Amount value={euros(view.filing.amountDueCents)} /> payés
                </>
              ) : view.filing.creditCents > 0 ? (
                <>
                  , crédit de <Amount value={euros(view.filing.creditCents)} /> reporté
                </>
              ) : null}
              .
            </p>
            {canWrite ? (
              <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
                Retirer le dépôt
              </Button>
            ) : null}
          </div>
        ) : canWrite ? (
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-3">
            <Field label="Date de dépôt" htmlFor="vat-filed-on" required>
              <DateInput id="vat-filed-on" value={filedOn} onValueChange={setFiledOn} />
            </Field>
            <Field label="Montant payé" htmlFor="vat-filed-due" hint="Ligne 28 de la CA3, ligne 33 de la CA12">
              <AmountInput id="vat-filed-due" value={due} onValueChange={setDue} />
            </Field>
            <Field label="Crédit reporté" htmlFor="vat-filed-credit" hint="Ligne 27 de la CA3, ligne 35 de la CA12">
              <AmountInput id="vat-filed-credit" value={credit} onValueChange={setCredit} />
            </Field>
            <div className="sm:col-span-3">
              <Button type="submit" loading={saving}>
                Enregistrer le dépôt
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-muted-foreground text-sm">Pas encore de dépôt enregistré pour cette période.</p>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Retirer le dépôt de ${period.label} ?`}
        description="Kledg oublie la date et les montants déposés. La déclaration reste déposée sur impots.gouv.fr."
        confirmLabel="Retirer"
        loading={saving}
        onConfirm={remove}
      />
    </Card>
  )
}

function SettlementCard({ companyId, view, canWrite, onDone }: { companyId: string; view: VatReturnView; canWrite: boolean; onDone: () => void }) {
  const [preparing, setPreparing] = React.useState(false)
  const period = view.period
  if (!period) return null
  const settlement = view.settlement

  const prepare = async () => {
    setPreparing(true)
    try {
      const result = await sendJson<VatSettlementResult>(
        `/api/companies/${encodeURIComponent(companyId)}/vat-returns/settlement`,
        'POST',
        { period: period.id },
        'L’écriture de liquidation n’a pas été préparée. Réessayez dans un instant.',
      )
      if (result) toast.success(result.message)
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setPreparing(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Écriture de liquidation</h2>
        </CardTitle>
        <CardDescription>
          Elle solde les comptes de TVA de la période et constate la TVA à décaisser (44551) ou le crédit à reporter (44567). Kledg la prépare en brouillon&nbsp;: vous la validez une fois la déclaration déposée.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        {settlement.status === 'none' ? (
          <p className="text-muted-foreground text-sm">Pas encore préparée.</p>
        ) : (
          <p className="text-sm">
            {settlement.status === 'validated' ? 'Validée' : 'Brouillon'}{' '}
            <Link href={`/${companyId}/entries/${settlement.entryId}`} className="text-link font-mono underline-offset-4 hover:underline">
              {settlement.entryNumber}
            </Link>
            , référence <span className="font-mono text-xs">{settlement.reference}</span>.
          </p>
        )}
        {canWrite && settlement.status !== 'validated' ? (
          <Button size="sm" variant="outline" onClick={prepare} loading={preparing}>
            <FilePlus2 aria-hidden />
            {settlement.status === 'draft' ? 'Mettre à jour le brouillon' : 'Préparer l’écriture'}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-96 w-full rounded-lg" />
    </div>
  )
}

/**
 * Déclarations de TVA (docs/declarations-tva.md): the CA3 or the CA12 of a
 * period computed from the validated entries, with the form line numbers,
 * the checks, the settlement draft and the record of the filing. Kledg
 * prepares; the user files on impots.gouv.fr.
 */
export function VatReturnPage({ companyId }: { companyId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { can } = useCompanyAccess()
  const canWrite = can({ entries: ['create'] })
  const canExport = can({ reports: ['export'] })
  const period = searchParams?.get('periode') ?? ''
  const query = new URLSearchParams(period ? { period } : {})
  const base = `/api/companies/${encodeURIComponent(companyId)}/vat-returns`
  const { data, error, loading, reload } = useJson<VatReturnView>(`${base}${period ? `?${query}` : ''}`, LOAD_ERROR)

  const choosePeriod = (key: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('periode', key)
    router.replace(`${pathname}?${params.toString()}`)
  }

  const view = data && (!period || data.period?.id === period || data.status !== 'ready') ? data : null
  const computation = view?.computation
  const result = computation?.result
  const exportUrl = (format: 'pdf' | 'csv') => `${base}/export?${new URLSearchParams({ ...(view?.period ? { period: view.period.id } : {}), format })}`

  return (
    <div className="space-y-6">
      <PageHeader
        title="Déclarations de TVA"
        description="Kledg prépare la déclaration de TVA de chaque période à partir des écritures validées, ligne par ligne. Vous la vérifiez, puis vous la déposez sur impots.gouv.fr."
        docsHref={docsUrl('vat')}
        actions={
          canExport && view?.status === 'ready' ? (
            <>
              <Button asChild variant="outline">
                <a href={exportUrl('pdf')} download>
                  <Download aria-hidden />
                  PDF
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href={exportUrl('csv')} download>
                  <Download aria-hidden />
                  CSV
                </a>
              </Button>
            </>
          ) : null
        }
      />

      {error ? (
        <EmptyState bordered title="La déclaration ne s’est pas chargée" description={error} action={<Button size="sm" onClick={reload}>Réessayer</Button>} />
      ) : !view || loading ? (
        <PageSkeleton />
      ) : view.status === 'exempt' ? (
        <EmptyState
          bordered
          icon={Landmark}
          title="Aucune déclaration de TVA à déposer"
          description="La société relève de la franchise en base de TVA (CGI, art. 293 B) ou est exonérée : elle ne facture pas de TVA, ne la déduit pas et n’a pas de déclaration de TVA à déposer. Si elle dépasse les seuils ou opte pour le paiement de la TVA, changez son régime dans les informations de la société."
          action={
            <Button asChild size="sm" variant="outline">
              <Link href={`/${companyId}/informations#regimes-fiscaux`}>Voir les régimes fiscaux</Link>
            </Button>
          }
        />
      ) : view.status === 'missing-regime' ? (
        <EmptyState
          bordered
          icon={Info}
          title="Régime de TVA non renseigné"
          description="Kledg choisit la déclaration (CA3 mensuelle ou trimestrielle, CA12 annuelle) d’après le régime de TVA de la société. Renseignez-le pour préparer les déclarations."
          action={
            <Button asChild size="sm">
              <Link href={`/${companyId}/informations#regimes-fiscaux`}>Renseigner le régime</Link>
            </Button>
          }
        />
      ) : view.status === 'no-period' || !view.period || !computation || !result ? (
        <EmptyState
          bordered
          icon={CalendarClock}
          title="Aucune période à déclarer"
          description="Les déclarations se calculent à partir des exercices. Créez le premier exercice de la société pour les voir."
          action={
            <Button asChild size="sm">
              <Link href={`/${companyId}/fiscal-years`}>Créer un exercice</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full space-y-2 sm:w-72">
              <Label htmlFor="vat-period">Période</Label>
              <Select value={view.period.id} onValueChange={choosePeriod}>
                <SelectTrigger id="vat-period" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {view.periods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.form} {p.label}
                      {p.filed ? ', déposée' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-muted-foreground text-sm">{view.formTitle}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label={result.kind === 'credit' ? 'Crédit de TVA' : 'TVA à payer'}
              value={<Amount value={result.kind === 'credit' ? result.creditEuros : result.dueEuros} decimals={0} />}
              hint={view.reliable ? `Montant de la déclaration de ${view.period.label}` : 'Estimation : des contrôles sont à corriger'}
            />
            <StatCard
              label="À déposer et payer avant le"
              value={view.deadline ? <DateDisplay value={view.deadline.date} format="long" /> : 'Non calculée'}
              hint={view.deadline?.estimated ? 'Jour indicatif : indiquez votre jour dans les paramètres des échéances' : view.deadline ? `Date légale le ${formatDisplayDate(view.deadline.legalDate)}` : undefined}
            />
            <StatCard
              label="Préparation"
              value={<StatusBadge tone={view.reliable ? 'success' : 'danger'}>{view.reliable ? 'Chiffres complets' : 'À corriger'}</StatusBadge>}
              hint={`${plural(view.movements?.entries ?? 0, 'écriture validée lue', 'écritures validées lues')}${view.filing ? ', déclaration déposée' : ''}`}
            />
          </div>

          <Alert role="note">
            <Info aria-hidden />
            <AlertTitle>Kledg prépare, vous déclarez</AlertTitle>
            <AlertDescription>
              <p>
                Les montants à reporter sont arrondis à l’euro, comme le formulaire le demande. Kledg ne dépose rien&nbsp;: saisissez ces montants dans votre espace professionnel sur{' '}
                <a href="https://www.impots.gouv.fr/professionnel" target="_blank" rel="noreferrer" className="text-link underline-offset-4 hover:underline">
                  impots.gouv.fr
                </a>
                , en complétant les lignes marquées «&nbsp;À remplir&nbsp;».
              </p>
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Contrôles</h2>
              </CardTitle>
              <CardDescription>Ce qu’il faut corriger ou vérifier dans les comptes avant de déclarer.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {view.checks.map((check) => (
                  <li key={check.id} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-start sm:gap-4">
                    <StatusBadge tone={SEVERITY[check.severity].tone} className="w-fit shrink-0">
                      {SEVERITY[check.severity].label}
                    </StatusBadge>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-medium">{check.title}</p>
                      <p className="text-muted-foreground text-sm">{check.detail}</p>
                      {check.items?.length ? (
                        <ul className="text-muted-foreground list-disc space-y-0.5 pl-5 text-xs">
                          {check.items.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      ) : null}
                      {check.link ? (
                        <Link href={`/${companyId}/${check.link.page}`} className="text-link inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline">
                          {check.link.label}
                          <ArrowRight aria-hidden className="size-3.5" />
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>{view.period.form === 'CA3' ? 'Lignes de la CA3' : 'Lignes de la CA12'}</h2>
              </CardTitle>
              <CardDescription>
                Du {formatDisplayDate(view.period.start)} au {formatDisplayDate(view.period.end)}. Chaque ligne porte son numéro et sa case sur le formulaire&nbsp;; sous un montant arrondi, le montant exact des comptes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LinesTable lines={computation.lines} />
            </CardContent>
          </Card>

          {computation.acomptes ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Acomptes</h2>
                </CardTitle>
                <CardDescription>Au régime simplifié, la TVA de l’année suivante se paie par deux acomptes, en juillet (55&nbsp;%) et en décembre (40&nbsp;%) de la base de la ligne 57.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <StatCard label="Acomptes payés dans l’année" value={<Amount value={euros(computation.acomptes.paidCents)} />} hint="Compte 44581, ligne 30" />
                <StatCard label="Acompte de juillet" value={<Amount value={computation.acomptes.nextJulyEuros} decimals={0} />} hint={computation.acomptes.nextDue ? '55 % de la ligne 57' : 'Pas d’acompte : base sous 1 000 €'} />
                <StatCard label="Acompte de décembre" value={<Amount value={computation.acomptes.nextDecemberEuros} decimals={0} />} hint={computation.acomptes.nextDue ? '40 % de la ligne 57' : 'Pas d’acompte : base sous 1 000 €'} />
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <SettlementCard companyId={companyId} view={view} canWrite={canWrite} onDone={reload} />
            <FilingCard key={view.period.id} companyId={companyId} view={view} canWrite={canWrite} onSaved={reload} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Ce que Kledg ne peut pas savoir</h2>
              </CardTitle>
              <CardDescription>À vérifier et compléter à la main sur la déclaration.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {view.notFromTheBooks.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Sources</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {view.sources.map((source) => (
                  <li key={source.url}>
                    <a href={source.url} target="_blank" rel="noreferrer" className="text-link inline-flex items-center gap-1 underline-offset-4 hover:underline">
                      <FileText aria-hidden className="size-3.5" />
                      {source.label}
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
