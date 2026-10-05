'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowUpRight, CircleCheck, Download, FilePlus2, Info, Plus, Trash2 } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AmountInput } from '@/components/ui/amount-input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DateInput } from '@/components/ui/date-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Amount, DateDisplay, EmptyState, Field, PageHeader, StatCard, StatusBadge } from '@/components/shared'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { euros, sendJson, useJson } from '@/components/features/year-end/shared'
import { DeadlineStatusBadge } from '@/components/features/deadlines/deadline-status-badge'
import { MarkDeclarationDialog } from '@/components/features/deadlines/mark-declaration-dialog'
import type { TrackedDeadline } from '@/lib/declarations/status'
import type { CvaeAdjustment, LocalTaxesView } from '@/lib/local-taxes/load-local-taxes.service'
import type { CfeEntryResult } from '@/lib/local-taxes/prepare-cfe-entry.service'

const LOAD_ERROR = 'Les impôts locaux ne se sont pas chargés. Réessayez dans un instant.'
const SAVE_ERROR = 'Les informations n’ont pas été enregistrées. Réessayez dans un instant.'

const SITUATION: Record<LocalTaxesView['cfe']['situation'], string> = {
  'creation-year': 'Année de création de la société : pas de CFE cette année (CGI, art. 1478, II). Déposez la déclaration initiale 1447-C-SD au plus tard le 31 décembre.',
  'half-base': 'Première année d’imposition : la base est réduite de moitié (CGI, art. 1478, II). Pas d’acompte, puisqu’il n’y avait pas de CFE l’année précédente.',
  normal: 'La CFE se calcule sur la valeur locative des locaux utilisés et le taux voté par la commune : seul l’avis d’imposition, dans votre espace professionnel, donne le montant.',
  unknown: 'La date de création de la société n’est pas renseignée : Kledg ne peut pas dire si l’exonération de l’année de création s’applique.',
}

const ACOMPTE_FROM: Record<LocalTaxesView['cfe']['schedule']['acompteFrom'], string> = {
  avis: 'D’après l’avis d’acompte saisi.',
  'previous-year': '50 % de la CFE de l’année précédente, qui atteignait 3 000 € (CGI, art. 1679 quinquies).',
  none: 'Pas d’acompte : la CFE de l’année précédente était inférieure à 3 000 €, ou il n’y en avait pas.',
  unknown: 'Saisissez l’avis de l’année précédente pour savoir si un acompte est dû (3 000 € ou plus).',
}

function PageSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function useSave(companyId: string, year: number, onSaved: () => void) {
  const [saving, setSaving] = React.useState(false)
  const save = async (fields: Record<string, unknown>, success: string) => {
    setSaving(true)
    try {
      await sendJson(`/api/companies/${encodeURIComponent(companyId)}/local-taxes`, 'PUT', { year, ...fields }, SAVE_ERROR)
      toast.success(success)
      onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return { saving, save }
}

function Line({ label, value, hint, strong }: { label: string; value: React.ReactNode; hint?: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className={strong ? 'text-sm font-medium' : 'text-sm'}>{label}</p>
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      </div>
      <span className={strong ? 'num shrink-0 text-sm font-medium' : 'num shrink-0 text-sm'}>{value}</span>
    </div>
  )
}

function CfeCard({ companyId, view, canWrite, onSaved }: { companyId: string; view: LocalTaxesView; canWrite: boolean; onSaved: () => void }) {
  const { cfe, year } = view
  const [total, setTotal] = React.useState<number | null>(cfe.avis?.totalCents ?? null)
  const [acompte, setAcompte] = React.useState<number | null>(cfe.avis?.acompteCents ?? null)
  const [noticeOn, setNoticeOn] = React.useState(cfe.avis?.noticeOn ?? '')
  const [counterpart, setCounterpart] = React.useState<'bank' | 'payable'>('bank')
  const [busy, setBusy] = React.useState<string | null>(null)
  const { saving, save } = useSave(companyId, year, onSaved)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (total === null) {
      toast.error('Indiquez le montant total de l’avis.')
      return
    }
    void save({ cfe: { totalCents: total, acompteCents: acompte, noticeOn: noticeOn || null } }, 'Avis de CFE enregistré')
  }

  const prepare = async (kind: 'acompte' | 'solde') => {
    setBusy(kind)
    try {
      const result = await sendJson<CfeEntryResult>(`/api/companies/${encodeURIComponent(companyId)}/local-taxes/entries`, 'POST', { year, kind, counterpart }, 'L’écriture n’a pas été préparée. Réessayez dans un instant.')
      if (result) toast.success(result.message)
      onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Cotisation foncière des entreprises {year}</h2>
        </CardTitle>
        <CardDescription>{SITUATION[cfe.situation]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="divide-y">
          <Line label="Avis d’imposition" value={cfe.avis ? <Amount value={euros(cfe.avis.totalCents)} /> : 'Non saisi'} hint={cfe.avis?.noticeOn ? `Avis du ${cfe.avis.noticeOn.split('-').reverse().join('/')}` : undefined} />
          <Line label="Acompte du 15 juin" value={<Amount value={euros(cfe.schedule.acompteCents)} />} hint={ACOMPTE_FROM[cfe.schedule.acompteFrom]} />
          <Line label="Solde du 15 décembre" value={cfe.schedule.balanceCents === null ? 'Avec l’avis' : <Amount value={euros(cfe.schedule.balanceCents)} />} strong />
          <Line
            label={`Charge prévue au compte ${cfe.expected.account.code}`}
            value={cfe.expected.cents === null ? 'Non connue' : <Amount value={euros(cfe.expected.cents)} />}
            hint={
              cfe.expected.source === 'previous-year'
                ? `Estimation d’après la CFE ${year - 1}, pour le budget, en attendant l’avis.`
                : cfe.expected.months.length > 0
                  ? `Pour le budget : ${cfe.expected.months.map((m) => `${m.month.slice(5) === '06' ? 'juin' : 'décembre'} ${(m.cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`).join(', ')}.`
                  : undefined
            }
          />
          {cfe.minimum.exempt !== null ? (
            <Line
              label="Cotisation minimum"
              value={cfe.minimum.exempt ? 'Exonérée' : 'Applicable'}
              hint={`Chiffre d’affaires ${cfe.minimum.referenceYear} : ${((cfe.minimum.turnoverCents ?? 0) / 100).toLocaleString('fr-FR')} €. Pas de cotisation minimum jusqu’à 5 000 € (CGI, art. 1647 D).`}
            />
          ) : null}
        </div>

        {canWrite ? (
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <Field label="Montant de l’avis" htmlFor="cfe-total">
              <AmountInput id="cfe-total" value={total} onValueChange={setTotal} />
            </Field>
            <Field label="Acompte demandé" htmlFor="cfe-acompte" optional>
              <AmountInput id="cfe-acompte" value={acompte} onValueChange={setAcompte} />
            </Field>
            <Field label="Date de l’avis" htmlFor="cfe-notice" optional>
              <DateInput id="cfe-notice" value={noticeOn} onValueChange={setNoticeOn} />
            </Field>
            <Button type="submit" variant="outline" loading={saving}>
              Enregistrer l’avis
            </Button>
          </form>
        ) : null}

        {canWrite && cfe.situation !== 'creation-year' ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Écritures en brouillon</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-full space-y-2 sm:w-64">
                <Label htmlFor="cfe-counterpart">Contrepartie</Label>
                <Select value={counterpart} onValueChange={(v) => setCounterpart(v as 'bank' | 'payable')}>
                  <SelectTrigger id="cfe-counterpart" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank">Paiement (63511 / 512)</SelectItem>
                    <SelectItem value="payable">Charge à payer (63511 / 447)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {cfe.schedule.acompteCents > 0 ? (
                <Button variant="outline" onClick={() => void prepare('acompte')} loading={busy === 'acompte'}>
                  <FilePlus2 aria-hidden />
                  Préparer l’acompte
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => void prepare('solde')} loading={busy === 'solde'} disabled={cfe.schedule.balanceCents === null}>
                <FilePlus2 aria-hidden />
                Préparer le solde
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Datées du paiement enregistré dans le suivi des échéances, sinon de l’échéance. Kledg ne valide jamais ces écritures.
              {[cfe.drafts.acompte, cfe.drafts.solde]
                .filter((d) => d.entryId)
                .map((d) => (
                  <span key={d.reference}>
                    {' '}
                    <Link href={`/${companyId}/entries/${d.entryId}`} className="text-link underline-offset-4 hover:underline">
                      {d.reference} ({d.status === 'validated' ? 'validée' : 'brouillon'} {d.entryNumber})
                    </Link>
                  </span>
                ))}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function AdjustmentsEditor({ companyId, view, canWrite, onSaved }: { companyId: string; view: LocalTaxesView; canWrite: boolean; onSaved: () => void }) {
  const adjustments = view.cvae.adjustments
  const [label, setLabel] = React.useState('')
  const [amount, setAmount] = React.useState<number | null>(null)
  const { saving, save } = useSave(companyId, view.year, onSaved)
  const add = (event: React.FormEvent) => {
    event.preventDefault()
    if (!label.trim() || amount === null) {
      toast.error('Indiquez un libellé et un montant.')
      return
    }
    const next: CvaeAdjustment = { id: `adj-${Date.now().toString(36)}`, label: label.trim(), amountCents: amount }
    void save({ cvaeAdjustments: [...adjustments, next] }, 'Ajustement enregistré').then(() => {
      setLabel('')
      setAmount(null)
    })
  }
  const remove = (id: string) => void save({ cvaeAdjustments: adjustments.filter((a) => a.id !== id) }, 'Ajustement retiré')
  return (
    <div className="space-y-2">
      {adjustments.map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-3 text-sm">
          <span>{a.label}</span>
          <span className="flex items-center gap-2">
            <Amount value={euros(a.amountCents)} tone="signed" />
            {canWrite ? (
              <Button variant="ghost" size="icon-sm" aria-label={`Retirer l’ajustement ${a.label}`} title="Retirer" onClick={() => remove(a.id)} disabled={saving}>
                <Trash2 aria-hidden />
              </Button>
            ) : null}
          </span>
        </div>
      ))}
      {canWrite ? (
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
          <Field label="Ajustement de la valeur ajoutée" htmlFor="cvae-adj-label" hint="Loyers de plus de six mois ou de crédit-bail (à ajouter), production immobilisée, régimes particuliers...">
            <Input id="cvae-adj-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} placeholder="ex. loyers de crédit-bail" />
          </Field>
          <Field label="Montant" htmlFor="cvae-adj-amount" hint="Négatif pour déduire.">
            <AmountInput id="cvae-adj-amount" value={amount} onValueChange={setAmount} allowNegative />
          </Field>
          <Button type="submit" variant="outline" loading={saving}>
            <Plus aria-hidden />
            Ajouter
          </Button>
        </form>
      ) : null}
    </div>
  )
}

function CvaeCard({ companyId, view, canWrite, onSaved }: { companyId: string; view: LocalTaxesView; canWrite: boolean; onSaved: () => void }) {
  const { cvae, year } = view
  const c = cvae.computation
  const title = <h2>Cotisation sur la valeur ajoutée des entreprises {year}</h2>
  if (cvae.status !== 'in-force') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>
            {cvae.status === 'abolished'
              ? `La CVAE est supprimée à partir de 2030 (loi n° 2025-127 du 14 février 2025, art. 62) : rien à déclarer ni à payer pour ${year}. La dernière année imposée est 2029, déclarée en mai 2030.`
              : `Kledg calcule la CVAE à partir de 2024. Pour ${year}, reportez-vous à vos déclarations 1330-CVAE et 1329-DEF de l’époque.`}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          Taux maximal de {cvae.maxRate} en {year}, au-delà de 50 millions d’euros de chiffre d’affaires. La CVAE est supprimée à partir de 2030. Déclaration 1330-CVAE au-delà de 152&nbsp;500&nbsp;€ de chiffre d’affaires, CVAE due au-delà de 500&nbsp;000&nbsp;€.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {cvae.hints.map((hint) => (
          <Alert key={hint} role="note">
            <Info aria-hidden />
            <AlertDescription>
              <p>
                {hint}{' '}
                <Link href={`/${companyId}/informations#echeances`} className="text-link underline-offset-4 hover:underline">
                  Paramètres des échéances
                </Link>
              </p>
            </AlertDescription>
          </Alert>
        ))}
        {!cvae.period || !cvae.books || !c ? (
          <p className="text-muted-foreground text-sm">Aucun exercice ne se termine en {year}&nbsp;: la CVAE de cette année se calcule sur l’exercice clos au cours de l’année.</p>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              {cvae.period.fiscalYears.map((fy) => `Exercice du ${fy.startDate.split('-').reverse().join('/')} au ${fy.endDate.split('-').reverse().join('/')}`).join(', ')}
              {cvae.period.estimate ? ', en cours : estimation sur les écritures passées.' : '.'}
            </p>
            <div className="divide-y">
              <Line label="Chiffre d’affaires (comptes 70)" value={<Amount value={euros(cvae.books.turnoverCents)} />} hint={cvae.turnoverAnnualCents !== cvae.books.turnoverCents ? `Ramené à douze mois : ${((cvae.turnoverAnnualCents ?? 0) / 100).toLocaleString('fr-FR')} €` : undefined} />
              <Line label="Valeur ajoutée des soldes intermédiaires de gestion" value={<Amount value={euros(cvae.books.sigValueAddedCents)} />} />
              <Line label="Plus subventions d’exploitation, autres produits de gestion, transferts de charges" value={<Amount value={euros(cvae.books.subsidiesCents + cvae.books.otherProductsCents + cvae.books.chargeTransfersCents)} />} />
              <Line label="Moins autres charges de gestion courante (65)" value={<Amount value={euros(-cvae.books.otherChargesCents)} />} />
              <Line label="Ajustements saisis" value={<Amount value={euros(cvae.adjustmentsCents)} tone="signed" />} />
              <Line
                label="Valeur ajoutée retenue"
                value={<Amount value={euros(c.valueAdded.cents)} />}
                hint={c.valueAdded.capped ? 'Plafonnée à 80 % du chiffre d’affaires, 85 % au-delà de 7,6 millions d’euros (CGI, art. 1586 sexies).' : undefined}
                strong
              />
            </div>
            <AdjustmentsEditor companyId={companyId} view={view} canWrite={canWrite} onSaved={onSaved} />
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Taux effectif" value={c.taxable ? c.rateLabel : 'Non imposable'} hint={c.taxable ? 'Arrondi au centième (CGI, art. 1586 quater)' : 'Chiffre d’affaires jusqu’à 500 000 €'} />
              <StatCard label="CVAE" value={<Amount value={euros(c.cvaeCents)} />} hint={c.franchise ? 'Non due : 63 € ou moins' : c.degrevementCents > 0 ? `Après un dégrèvement de ${(c.degrevementCents / 100).toLocaleString('fr-FR')} €` : 'Après dégrèvement'} />
              <StatCard label="Déclaration 1330-CVAE" value={c.declarationRequired ? 'Obligatoire' : 'Non requise'} hint="Au-delà de 152 500 € de chiffre d’affaires" />
            </div>
            {c.complementaryCents > 0 ? <Line label="Contribution complémentaire de 2025 (47,4 %)" value={<Amount value={euros(c.complementaryCents)} />} /> : null}
            {cvae.acomptes.due ? (
              <p className="text-sm">
                Acomptes 1329-AC des 15 juin et 15 septembre&nbsp;: {cvae.acomptes.eachCents === null ? 'à calculer' : <Amount value={euros(cvae.acomptes.eachCents)} />} chacun, la CVAE {year - 1} dépassant 1&nbsp;500&nbsp;€.
              </p>
            ) : cvae.acomptes.due === false ? (
              <p className="text-muted-foreground text-sm">Pas d’acompte de CVAE en {year}&nbsp;: la CVAE {year - 1} ne dépassait pas 1&nbsp;500&nbsp;€.</p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function DeadlinesCard({ companyId, view, canWrite, canListReceipts }: { companyId: string; view: LocalTaxesView; canWrite: boolean; canListReceipts: boolean }) {
  const [marking, setMarking] = React.useState<TrackedDeadline | null>(null)
  const [saved, setSaved] = React.useState<Record<string, TrackedDeadline>>({})
  const deadlines = view.deadlines.map((d) => saved[d.id] ?? d)
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Échéances et paiements</h2>
        </CardTitle>
        <CardDescription>
          Les échéances de CFE et de CVAE de {view.year}. Enregistrez ce que vous avez déposé ou payé&nbsp;: le calendrier des{' '}
          <Link href={`/${companyId}/echeances`} className="text-link underline-offset-4 hover:underline">
            échéances
          </Link>{' '}
          et l’accueil le montrent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {deadlines.length === 0 ? (
          <p className="text-muted-foreground text-sm">Aucune échéance de CFE ou de CVAE pour {view.year} avec les paramètres actuels.</p>
        ) : (
          <ul className="divide-y" aria-label="Échéances des impôts locaux">
            {deadlines.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="w-24 text-sm">
                  <DateDisplay value={d.date} />
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  {d.label}
                  <span className="text-muted-foreground block font-mono text-xs">{d.form}</span>
                </span>
                <DeadlineStatusBadge deadline={d} today={view.today} />
                {canWrite ? (
                  <Button variant="outline" size="xs" onClick={() => setMarking(d)} aria-label={`Enregistrer le dépôt ou le paiement : ${d.label}`}>
                    <CircleCheck aria-hidden />
                    {d.status.record ? 'Modifier' : 'Enregistrer'}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {marking ? (
        <MarkDeclarationDialog
          key={marking.id}
          companyId={companyId}
          deadline={marking}
          open
          onOpenChange={(open) => !open && setMarking(null)}
          onSaved={(updated) => setSaved((current) => ({ ...current, [updated.id]: updated }))}
          canListReceipts={canListReceipts}
        />
      ) : null}
    </Card>
  )
}

/**
 * Impôts locaux (docs/impots-locaux.md): the CFE of a year from the avis the
 * user enters (acompte, balance, expected charge, draft entries) and the
 * CVAE from the value added of the books (rates of the law in force,
 * abolished from 2030), the plafonnement estimate and the deadlines of both
 * taxes with their status. Kledg prepares; the user pays on impots.gouv.fr.
 */
export function LocalTaxesPage({ companyId }: { companyId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { can } = useCompanyAccess()
  const canWrite = can({ entries: ['create'] })
  const canExport = can({ reports: ['export'] })
  const canListReceipts = can({ expenses: ['submit'], banking: ['read'] })
  const yearParam = searchParams?.get('annee') ?? ''
  const base = `/api/companies/${encodeURIComponent(companyId)}/local-taxes`
  const { data, error, loading, reload } = useJson<LocalTaxesView>(`${base}${/^\d{4}$/.test(yearParam) ? `?year=${yearParam}` : ''}`, LOAD_ERROR)
  const view = data && (!yearParam || String(data.year) === yearParam) ? data : null

  const chooseYear = (year: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('annee', year)
    router.replace(`${pathname}?${params.toString()}`)
  }
  const exportUrl = (format: 'pdf' | 'csv') => `${base}/export?${new URLSearchParams({ ...(view ? { year: String(view.year) } : {}), format })}`
  const key = view ? `${view.year}:${JSON.stringify([view.cfe.avis, view.cvae.adjustments])}` : ''

  return (
    <div className="space-y-6">
      <PageHeader
        title="Impôts locaux (CFE, CVAE)"
        description="La cotisation foncière des entreprises d’après votre avis d’imposition, la CVAE calculée sur la valeur ajoutée des comptes, leurs échéances et leurs paiements. Vous déclarez et payez sur impots.gouv.fr."
        actions={
          canExport && view ? (
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

      <Alert role="note">
        <Info aria-hidden />
        <AlertTitle>Kledg prépare, vous payez</AlertTitle>
        <AlertDescription>
          <p>
            L’avis de CFE et les déclarations de CVAE sont dans votre espace professionnel sur{' '}
            <a href="https://www.impots.gouv.fr/professionnel" target="_blank" rel="noreferrer" className="text-link inline-flex items-center gap-1 underline-offset-4 hover:underline">
              impots.gouv.fr
              <ArrowUpRight aria-hidden className="size-3.5" />
            </a>
            . Kledg ne dépose et ne paie rien.
          </p>
        </AlertDescription>
      </Alert>

      {error ? (
        <EmptyState bordered title="Les impôts locaux ne se sont pas chargés" description={error} action={<Button size="sm" onClick={reload}>Réessayer</Button>} />
      ) : !view || loading ? (
        <div aria-busy>
          <PageSkeleton />
        </div>
      ) : (
        <>
          <div className="w-full space-y-2 sm:w-48">
            <Label htmlFor="local-taxes-year">Année</Label>
            <Select value={String(view.year)} onValueChange={chooseYear}>
              <SelectTrigger id="local-taxes-year" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {view.years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                    {y > 2029 ? ' (sans CVAE)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <section className="grid gap-3 sm:grid-cols-3" aria-label="En bref">
            <StatCard label={`CFE ${view.year}`} value={view.cfe.avis ? <Amount value={euros(view.cfe.avis.totalCents)} /> : view.cfe.situation === 'creation-year' ? 'Exonérée' : 'Avis à saisir'} hint={view.cfe.expected.source === 'previous-year' ? `Prévue : ${((view.cfe.expected.cents ?? 0) / 100).toLocaleString('fr-FR')} € (CFE ${view.year - 1})` : undefined} />
            <StatCard
              label={`CVAE ${view.year}`}
              value={view.cvae.status === 'abolished' ? 'Supprimée' : view.cvae.computation ? <Amount value={euros(view.cvae.computation.totalCents)} /> : 'Non calculée'}
              hint={view.cvae.status === 'in-force' && view.cvae.period?.estimate ? 'Estimation, exercice en cours' : undefined}
            />
            <StatCard
              label="Plafonnement (estimation)"
              value={view.plafonnement ? <Amount value={euros(view.plafonnement.excessCents)} /> : 'Avis à saisir'}
              hint={view.plafonnement ? `Au-delà de ${(view.plafonnement.rate / 1000).toFixed(3).replace('.', ',')} % de la valeur ajoutée, à demander avec le 1327-CET-SD` : 'CGI, art. 1647 B sexies'}
            />
          </section>

          <CfeCard key={`cfe-${key}`} companyId={companyId} view={view} canWrite={canWrite} onSaved={reload} />
          <CvaeCard key={`cvae-${key}`} companyId={companyId} view={view} canWrite={canWrite} onSaved={reload} />
          <DeadlinesCard key={`deadlines-${key}`} companyId={companyId} view={view} canWrite={canWrite} canListReceipts={canListReceipts} />

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Sources</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {view.sources.map((s) => (
                  <li key={s.url + s.label}>
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-link inline-flex items-center gap-1 underline-offset-4 hover:underline">
                      {s.label}
                      <ArrowUpRight aria-hidden className="size-3.5" />
                    </a>
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-3 text-xs">
                <StatusBadge tone="info">Non couvert</StatusBadge> la mensualisation de la CFE, la taxe additionnelle de CVAE pour les chambres de commerce, les frais de gestion, les régimes particuliers de valeur ajoutée (banques, holdings, location), les groupes et la répartition par établissement.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
