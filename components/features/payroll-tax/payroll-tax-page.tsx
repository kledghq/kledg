'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowUpRight, FilePlus2, Info, Plus, Trash2 } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AmountInput } from '@/components/ui/amount-input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Amount, DateDisplay, EmptyState, Field, PageHeader, StatCard } from '@/components/shared'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { euros, sendJson, useJson } from '@/components/features/year-end/shared'
import type { PayrollTaxView } from '@/lib/payroll-tax/load-payroll-tax.service'
import type { PayrollTaxEntryResult } from '@/lib/payroll-tax/prepare-payroll-tax-entry.service'

const LOAD_ERROR = 'La taxe sur les salaires ne s’est pas chargée. Réessayez dans un instant.'
const SAVE_ERROR = 'Les informations n’ont pas été enregistrées. Réessayez dans un instant.'

const LIABILITY: Record<PayrollTaxView['liability'], string> = {
  liable: 'Redevable',
  'not-liable': 'Non redevable',
  franchise: 'Non redevable (franchise en base)',
  unknown: 'À déterminer',
}
const FREQUENCY: Record<PayrollTaxView['frequency'], string> = {
  monthly: 'Relevés 2501 mensuels (taxe de l’année précédente au-delà de 10 000 €)',
  quarterly: 'Relevés 2501 trimestriels (taxe de l’année précédente de 4 000 € à 10 000 €)',
  annual: 'Paiement annuel avec la 2502 (taxe de l’année précédente sous 4 000 €)',
}

type Employee = PayrollTaxView['data']['employees'][number]
let nextId = 0
const newId = () => `s${Date.now().toString(36)}${(nextId++).toString(36)}`

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

function InputsCard({ companyId, view, canWrite, onSaved }: { companyId: string; view: PayrollTaxView; canWrite: boolean; onSaved: () => void }) {
  const [employees, setEmployees] = React.useState<Employee[]>(view.data.employees)
  const [association, setAssociation] = React.useState(view.data.association)
  const [ratio, setRatio] = React.useState(view.data.ratioPercent === null ? '' : String(view.data.ratioPercent))
  const [previous, setPrevious] = React.useState<number | null>(view.data.previousYearTaxCents)
  const [saving, setSaving] = React.useState(false)

  const save = async () => {
    const ratioPercent = ratio.trim() === '' ? null : Number(ratio)
    if (ratioPercent !== null && !(Number.isInteger(ratioPercent) && ratioPercent >= 0 && ratioPercent <= 100)) {
      toast.error('Le rapport est un pourcentage entier de 0 à 100.')
      return
    }
    setSaving(true)
    try {
      await sendJson(
        `/api/companies/${encodeURIComponent(companyId)}/payroll-tax`,
        'PUT',
        { year: view.year, data: { employees, association, ratioPercent, previousYearTaxCents: previous, note: view.data.note } },
        SAVE_ERROR,
      )
      toast.success(`Taxe sur les salaires ${view.year} enregistrée`)
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
          <h2>Rémunérations {view.year}</h2>
        </CardTitle>
        <CardDescription>
          Les comptes donnent le total des salaires, pas la base de chaque salarié&nbsp;: saisissez la base annuelle de chacun (rémunérations retenues pour la CSG, avantages en nature compris, sans l’abattement de 1,75&nbsp;%). Les tranches s’appliquent salarié par salarié.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {employees.map((e, i) => (
          <div key={e.id} className="grid gap-2 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
            <Field label="Salarié" htmlFor={`ts-label-${e.id}`}>
              <Input id={`ts-label-${e.id}`} value={e.label} onChange={(ev) => setEmployees(employees.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)))} disabled={!canWrite} />
            </Field>
            <Field label="Base annuelle" htmlFor={`ts-base-${e.id}`}>
              <AmountInput id={`ts-base-${e.id}`} value={e.baseCents} onValueChange={(v) => setEmployees(employees.map((x, j) => (j === i ? { ...x, baseCents: v ?? 0 } : x)))} disabled={!canWrite} />
            </Field>
            <Button variant="ghost" size="icon" aria-label={`Retirer ${e.label || 'le salarié'}`} onClick={() => setEmployees(employees.filter((_, j) => j !== i))} disabled={!canWrite}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        {canWrite ? (
          <Button variant="outline" size="sm" onClick={() => setEmployees([...employees, { id: newId(), label: `Salarié ${employees.length + 1}`, baseCents: 0 }])}>
            <Plus aria-hidden />
            Ajouter un salarié
          </Button>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Rapport d’assujettissement saisi" htmlFor="ts-ratio" optional hint="En pourcentage entier, pour une première année ou des recettes hors du champ de la TVA. Vide : d’après les comptes de l’année précédente.">
            <Input id="ts-ratio" inputMode="numeric" value={ratio} onChange={(e) => setRatio(e.target.value)} disabled={!canWrite} />
          </Field>
          <Field label="Taxe de l’année précédente" htmlFor="ts-previous" optional hint="Si Kledg ne la calcule pas : elle fixe la fréquence des relevés.">
            <AmountInput id="ts-previous" value={previous} onValueChange={setPrevious} disabled={!canWrite} />
          </Field>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="ts-association" checked={association} onCheckedChange={(c) => setAssociation(c === true)} disabled={!canWrite} />
          <Label htmlFor="ts-association" className="font-normal">
            Association, fondation, syndicat ou mutuelle&nbsp;: abattement de l’article 1679 A du CGI
          </Label>
        </div>
        {canWrite ? (
          <div className="flex justify-end">
            <Button onClick={() => void save()} loading={saving}>
              Enregistrer
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

/**
 * Taxe sur les salaires (docs/organisme-de-formation.md): liability and
 * rapport from the revenue of the year before, the computation of the 2502
 * from the annual base of each employee, the schedule of the relevés, the
 * draft entry. Kledg prepares; the employer files and pays on impots.gouv.fr.
 */
export function PayrollTaxPage({ companyId }: { companyId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { can } = useCompanyAccess()
  const canWrite = can({ entries: ['create'] })
  const yearParam = searchParams?.get('annee') ?? ''
  const base = `/api/companies/${encodeURIComponent(companyId)}/payroll-tax`
  const { data, error, loading, reload } = useJson<PayrollTaxView>(`${base}${/^\d{4}$/.test(yearParam) ? `?year=${yearParam}` : ''}`, LOAD_ERROR)
  const view = data && (!yearParam || String(data.year) === yearParam) ? data : null
  const [busy, setBusy] = React.useState(false)

  const chooseYear = (year: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('annee', year)
    router.replace(`${pathname}?${params.toString()}`)
  }
  const prepare = async () => {
    if (!view) return
    setBusy(true)
    try {
      const result = await sendJson<PayrollTaxEntryResult>(`${base}/entries`, 'POST', { year: view.year }, 'L’écriture n’a pas été préparée. Réessayez dans un instant.')
      if (result) toast.success(result.message)
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const c = view?.computation ?? null
  const key = view ? `${view.year}:${JSON.stringify(view.data)}` : ''

  return (
    <div className="space-y-6">
      <PageHeader
        title="Taxe sur les salaires"
        description="Due par les employeurs qui ne sont pas soumis à la TVA sur au moins 90 % de leur chiffre d’affaires de l’année précédente, comme un organisme de formation exonéré. Vous déclarez et payez sur impots.gouv.fr."
      />
      <Alert role="note">
        <Info aria-hidden />
        <AlertTitle>Kledg prépare, vous payez</AlertTitle>
        <AlertDescription>
          <p>Les relevés 2501 et la déclaration 2502 se déposent et se paient en ligne dans votre espace professionnel. Kledg ne dépose et ne paie rien.</p>
        </AlertDescription>
      </Alert>

      {error ? (
        <EmptyState bordered title="La taxe ne s’est pas chargée" description={error} action={<Button size="sm" onClick={reload}>Réessayer</Button>} />
      ) : !view || loading ? (
        <div aria-busy className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <div className="w-full space-y-2 sm:w-48">
            <Label htmlFor="payroll-tax-year">Année</Label>
            <Select value={String(view.year)} onValueChange={chooseYear}>
              <SelectTrigger id="payroll-tax-year" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {view.years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <section className="grid gap-3 sm:grid-cols-3" aria-label="En bref">
            <StatCard
              label={`Situation ${view.year}`}
              value={LIABILITY[view.liability]}
              hint={view.ratio.exactBasisPoints !== null ? `Recettes ${view.reference.year} sans droit à déduction : ${(view.ratio.exactBasisPoints / 100).toLocaleString('fr-FR')} %` : undefined}
            />
            <StatCard label="Rapport appliqué" value={`${view.ratio.appliedPercent} %`} hint={view.ratio.source === 'entered' ? 'Saisi' : view.ratio.source === 'books' ? `Arrondi à l’unité inférieure : ${view.ratio.truncatedPercent} %` : undefined} />
            <StatCard label={`Taxe due ${view.year}`} value={c ? <Amount value={euros(c.dueCents)} decimals={0} /> : 'Non calculée'} hint={view.liability === 'liable' ? FREQUENCY[view.frequency] : undefined} />
          </section>

          {view.hints.map((hint) => (
            <Alert key={hint} role="note">
              <Info aria-hidden />
              <AlertDescription>
                <p>{hint}</p>
              </AlertDescription>
            </Alert>
          ))}

          <InputsCard key={`inputs-${key}`} companyId={companyId} view={view} canWrite={canWrite} onSaved={reload} />

          {c ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Calcul de la déclaration 2502</h2>
                </CardTitle>
                <CardDescription>Bases additionnées par tranche puis arrondies à l’euro, chaque taxe arrondie à l’euro, rapport appliqué au total (notice 2502).</CardDescription>
              </CardHeader>
              <CardContent className="divide-y">
                <Line label="A. Rémunérations imposables" value={<Amount value={euros(c.baseCents)} decimals={0} />} />
                <Line label="A1. Fraction entre le premier et le second seuil" value={<Amount value={euros(c.firstBracketCents)} decimals={0} />} />
                <Line label="A2. Fraction au-delà du second seuil" value={<Amount value={euros(c.secondBracketCents)} decimals={0} />} />
                <Line label="Taxe à 4,25 % sur A" value={<Amount value={euros(c.taxBaseCents)} decimals={0} />} />
                <Line label="Majoration de 4,25 % sur A1 (taux de 8,50 %)" value={<Amount value={euros(c.taxFirstCents)} decimals={0} />} />
                <Line label="Majoration de 9,35 % sur A2 (taux de 13,60 %)" value={<Amount value={euros(c.taxSecondCents)} decimals={0} />} />
                <Line label="Total" value={<Amount value={euros(c.grossCents)} decimals={0} />} />
                <Line label={`Après le rapport de ${c.ratioPercent} %`} value={<Amount value={euros(c.afterRatioCents)} decimals={0} />} />
                <Line label={c.franchise ? 'Franchise (1 200 € ou moins)' : 'Décote'} value={<Amount value={euros(c.decoteCents)} decimals={0} />} hint="CGI, art. 1679" />
                {view.data.association ? <Line label="Abattement des associations" value={<Amount value={euros(c.abatementCents)} decimals={0} />} hint="CGI, art. 1679 A, après franchise et décote" /> : null}
                <Line label="Taxe due" value={<Amount value={euros(c.dueCents)} decimals={0} />} strong />
                <Line label="Salaires bruts des comptes 641 et 644" value={<Amount value={euros(view.booksSalariesCents)} />} hint={`Bases saisies : ${(view.enteredBasesCents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`} />
              </CardContent>
            </Card>
          ) : null}

          {view.schedule.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Échéances</h2>
                </CardTitle>
                <CardDescription>{FREQUENCY[view.frequency]}. Elles figurent aussi dans le calendrier des échéances une fois les rémunérations enregistrées.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {view.schedule.map((d) => (
                    <li key={d.key} className="flex justify-between gap-4 py-2">
                      <span>{d.label}</span>
                      <span>
                        <DateDisplay value={d.date} />
                        {d.extendedDate ? <span className="text-muted-foreground"> (admis jusqu’au <DateDisplay value={d.extendedDate} />)</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {canWrite && c && c.dueCents > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => void prepare()} loading={busy}>
                <FilePlus2 aria-hidden />
                Préparer l’écriture
              </Button>
              <span className="text-muted-foreground text-xs">
                Brouillon au 31/12/{view.year}, journal OD, 6311 au débit et 447 au crédit, jamais validé par Kledg.
                {view.draft.entryId ? (
                  <>
                    {' '}
                    <Link href={`/${companyId}/entries/${view.draft.entryId}`} className="text-link underline-offset-4 hover:underline">
                      {view.draft.reference} ({view.draft.status === 'validated' ? 'validée' : 'brouillon'} {view.draft.entryNumber})
                    </Link>
                  </>
                ) : null}
              </span>
            </div>
          ) : null}

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
                Non couverts&nbsp;: les taux des DOM, les exonérations particulières (CGI, art. 231 bis), les secteurs distincts, le calcul mois par mois des relevés (seuils au douzième ou au quart) et la régularisation de fin d’année.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
