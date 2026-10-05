'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowUpRight, FilePlus2, Info } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AmountInput } from '@/components/ui/amount-input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Amount, DateDisplay, EmptyState, Field, PageHeader, StatCard, StatusBadge } from '@/components/shared'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { euros, sendJson, useJson } from '@/components/features/year-end/shared'
import type { VatDeductionView } from '@/lib/vat-deduction/load-vat-deduction.service'
import type { VatRegularisationResult } from '@/lib/vat-deduction/prepare-regularisation.service'
import type { VatTreatment } from '@/lib/vat-deduction/revenue'

const LOAD_ERROR = 'Le coefficient de déduction ne s’est pas chargé. Réessayez dans un instant.'
const SAVE_ERROR = 'Les réglages n’ont pas été enregistrés. Réessayez dans un instant.'

const SOURCE_LABELS: Record<VatDeductionView['provisional']['source'], string> = {
  'previous-year': 'D’après le chiffre d’affaires de l’année précédente',
  estimate: 'D’après votre estimation (première année)',
  'books-to-date': 'D’après les comptes de l’année à ce jour, faute d’estimation',
}

const TREATMENT_OPTIONS: Array<{ value: VatTreatment | 'auto'; label: string }> = [
  { value: 'auto', label: 'Automatique' },
  { value: 'taxable', label: 'Ouvre droit à déduction' },
  { value: 'exempt', label: 'Exonérée' },
  { value: 'excluded', label: 'Exclue du calcul' },
]

const ORIGIN_LABELS: Record<string, string> = {
  setting: 'Votre réglage',
  books: 'TVA collectée et factures exonérées',
  'default-excluded': 'Hors chiffre d’affaires (71 à 79)',
}

const percentText = (value: number | null) => (value === null ? 'Sans chiffre d’affaires' : `${value} %`)
const parsePercent = (text: string): number | null | 'invalid' => {
  if (text.trim() === '') return null
  const n = Number(text.replace(',', '.'))
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : 'invalid'
}

function PageSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function SettingsCard({ companyId, view, canWrite, onSaved }: { companyId: string; view: VatDeductionView; canWrite: boolean; onSaved: () => void }) {
  const [estimate, setEstimate] = React.useState(view.settings.estimatedTaxationPercent === null ? '' : String(view.settings.estimatedTaxationPercent))
  const [assujettissement, setAssujettissement] = React.useState(String(view.settings.assujettissementPercent))
  const [incurred, setIncurred] = React.useState<number | null>(view.settings.incurredVatCents)
  const [saving, setSaving] = React.useState(false)

  const save = async (body: Record<string, unknown>, success: string) => {
    setSaving(true)
    try {
      await sendJson(`/api/companies/${encodeURIComponent(companyId)}/vat-deduction`, 'PUT', body, SAVE_ERROR)
      toast.success(success)
      onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const estimated = parsePercent(estimate)
    const assujetti = parsePercent(assujettissement)
    if (estimated === 'invalid' || assujetti === 'invalid' || assujetti === null) {
      toast.error('Les coefficients sont des pourcentages entiers de 0 à 100.')
      return
    }
    void save({ year: view.year, estimatedTaxationPercent: estimated, assujettissementPercent: assujetti, incurredVatCents: incurred }, `Coefficients ${view.year} enregistrés`)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Réglages</h2>
        </CardTitle>
        <CardDescription>Ce que les comptes ne disent pas. Le coefficient d’admission (véhicules, cadeaux, carburant) reste appliqué dépense par dépense.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {view.isVatExempt ? (
          <p className="text-sm">La société est exonérée de TVA (informations de la société)&nbsp;: elle déduit sa TVA par coefficient.</p>
        ) : (
          <div className="flex items-start gap-3">
            <Switch
              id="partial-vat"
              checked={view.partialVatDeduction}
              disabled={!canWrite || saving}
              onCheckedChange={(checked) => void save({ partialVatDeduction: checked }, checked ? 'Déduction par coefficient activée' : 'Déduction complète rétablie')}
            />
            <div className="space-y-1">
              <Label htmlFor="partial-vat">Assujetti partiel&nbsp;: déduction par coefficient</Label>
              <p className="text-muted-foreground text-xs">
                À activer quand la société réalise des opérations taxées et des opérations exonérées, comme la formation professionnelle continue (CGI, art. 261, 4, 4° a). Les écritures déjà passées ne changent pas.
              </p>
            </div>
          </div>
        )}
        {canWrite ? (
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <Field label={`Coefficient de taxation estimé ${view.year}`} htmlFor="vat-estimate" optional hint="Première année, sans chiffre d’affaires l’année précédente.">
              <Input id="vat-estimate" inputMode="numeric" value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="Ex. 60" />
            </Field>
            <Field label="Coefficient d’assujettissement" htmlFor="vat-assujettissement" hint="Part d’utilisation pour des opérations dans le champ de la TVA.">
              <Input id="vat-assujettissement" inputMode="numeric" value={assujettissement} onChange={(e) => setAssujettissement(e.target.value)} />
            </Field>
            <Field label={`TVA supportée en ${view.year}`} htmlFor="vat-incurred" optional hint="Sinon retrouvée depuis la TVA déduite (44562 et 44566).">
              <AmountInput id="vat-incurred" value={incurred} onValueChange={setIncurred} />
            </Field>
            <Button type="submit" variant="outline" loading={saving}>
              Enregistrer
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  )
}

function RevenueCard({ companyId, view, canWrite, onSaved }: { companyId: string; view: VatDeductionView; canWrite: boolean; onSaved: () => void }) {
  const [busy, setBusy] = React.useState<string | null>(null)
  const { revenue } = view

  const change = async (accountCode: string, value: VatTreatment | 'auto') => {
    setBusy(accountCode)
    try {
      await sendJson(`/api/companies/${encodeURIComponent(companyId)}/vat-deduction`, 'PUT', { accounts: [{ accountCode, vatTreatment: value === 'auto' ? null : value }] }, SAVE_ERROR)
      toast.success(`Compte ${accountCode} enregistré`)
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
          <h2>D’où viennent les recettes {view.year}</h2>
        </CardTitle>
        <CardDescription>
          Une vente qui collecte de la TVA ouvre droit à déduction&nbsp;; une ligne de facture marquée exonérée (formation) n’y ouvre pas droit. Les ventes sans TVA ni exonération sont à classer&nbsp;: une exportation ou une livraison intracommunautaire ouvre droit à déduction.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {revenue.accounts.length === 0 ? (
          <EmptyState title="Aucune recette cette année" description="Le coefficient se calcule sur les écritures validées des comptes de produits (classe 7)." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Compte</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Ouvre droit</TableHead>
                  <TableHead className="text-right">Exonéré</TableHead>
                  <TableHead className="text-right">À classer</TableHead>
                  <TableHead className="text-right">Exclu</TableHead>
                  <TableHead>Lecture</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revenue.accounts.map((account) => (
                  <TableRow key={account.code}>
                    <TableCell>
                      <span className="num">{account.code}</span> <span className="text-muted-foreground">{account.label}</span>
                    </TableCell>
                    <TableCell className="text-right"><Amount value={euros(account.totalCents)} /></TableCell>
                    <TableCell className="text-right"><Amount value={euros(account.taxableCents)} /></TableCell>
                    <TableCell className="text-right"><Amount value={euros(account.exemptCents)} /></TableCell>
                    <TableCell className="text-right">{account.toClassifyCents > 0 ? <StatusBadge tone="warning"><Amount value={euros(account.toClassifyCents)} /></StatusBadge> : <Amount value={0} />}</TableCell>
                    <TableCell className="text-right"><Amount value={euros(account.excludedCents)} /></TableCell>
                    <TableCell className="min-w-56">
                      {canWrite ? (
                        <Select value={account.setting && account.setting.accountCode === account.code ? account.setting.treatment : 'auto'} onValueChange={(v) => void change(account.code, v as VatTreatment | 'auto')} disabled={busy === account.code}>
                          <SelectTrigger aria-label={`Traitement du compte ${account.code}`} className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TREATMENT_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}
                      <p className="text-muted-foreground mt-1 text-xs">
                        {account.setting && account.setting.accountCode !== account.code ? `Réglage du compte ${account.setting.accountCode}` : ORIGIN_LABELS[account.source]}
                      </p>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-medium">Total</TableCell>
                  <TableCell />
                  <TableCell className="text-right font-medium"><Amount value={euros(revenue.taxableCents)} /></TableCell>
                  <TableCell className="text-right font-medium"><Amount value={euros(revenue.exemptCents)} /></TableCell>
                  <TableCell className="text-right font-medium"><Amount value={euros(revenue.toClassifyCents)} /></TableCell>
                  <TableCell className="text-right font-medium"><Amount value={euros(revenue.excludedCents)} /></TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-muted-foreground mt-3 text-xs">
          Coefficient de taxation = recettes qui ouvrent droit à déduction / (recettes qui ouvrent droit + exonérées + à classer), arrondi par excès au pourcentage entier (CGI, ann. II, art. 206, III et V).
        </p>
      </CardContent>
    </Card>
  )
}

function RegularisationCard({ companyId, view, canWrite, onDone }: { companyId: string; view: VatDeductionView; canWrite: boolean; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false)
  const r = view.regularisation
  const prepare = async () => {
    setBusy(true)
    try {
      const result = await sendJson<VatRegularisationResult>(`/api/companies/${encodeURIComponent(companyId)}/vat-deduction/regularisation`, 'POST', { year: view.year }, 'L’écriture n’a pas été préparée. Réessayez dans un instant.')
      if (result) toast.success(result.message)
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Régularisation {view.year}</h2>
        </CardTitle>
        <CardDescription>
          Le coefficient définitif est arrêté avant le <DateDisplay value={`${r.deadline.slice(0, 4)}-04-25`} />&nbsp;: la différence avec le coefficient provisoire se régularise quelle que soit son importance, sur la déclaration déposée en avril.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="TVA déduite dans l’année" value={<Amount value={euros(r.deductedCents)} />} hint="Comptes 44562 et 44566" />
          <StatCard
            label="TVA supportée"
            value={r.incurredCents === null ? 'À saisir' : <Amount value={euros(r.incurredCents)} />}
            hint={r.incurredSource === 'entered' ? 'Saisie dans les réglages' : r.incurredSource === 'books' ? `TVA déduite / ${view.provisional.deductionPercent} %` : undefined}
          />
          <StatCard
            label={r.amountCents !== null && r.amountCents < 0 ? 'TVA à reverser' : 'Complément de déduction'}
            value={r.amountCents === null ? 'Non calculée' : <Amount value={euros(Math.abs(r.amountCents))} />}
            hint={r.line && r.form ? `Ligne ${r.line.code} de la ${r.form} (case ${r.line.box})` : undefined}
          />
        </div>
        {!view.yearClosed ? <p className="text-muted-foreground text-sm">L’année {view.year} n’est pas terminée&nbsp;: les montants sont une estimation.</p> : null}
        {canWrite && view.mode === 'coefficient' ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void prepare()} loading={busy} disabled={!view.yearClosed || r.amountCents === null || r.amountCents === 0}>
              <FilePlus2 aria-hidden />
              Préparer l’écriture
            </Button>
            <span className="text-muted-foreground text-xs">
              Brouillon au <DateDisplay value={r.entryDate} />, journal OD (44566 et 758, ou 658 et 44566), jamais validé par Kledg.
              {r.draft.entryId ? (
                <>
                  {' '}
                  <Link href={`/${companyId}/entries/${r.draft.entryId}`} className="text-link underline-offset-4 hover:underline">
                    {r.draft.reference} ({r.draft.status === 'validated' ? 'validée' : 'brouillon'} {r.draft.entryNumber})
                  </Link>
                </>
              ) : null}
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

/**
 * Coefficient de déduction de TVA (docs/organisme-de-formation.md): for a
 * company with taxed and exempt operations (training of CGI art. 261, 4,
 * 4° a), where the revenue of a year comes from, the coefficient de
 * taxation, the provisional coefficient applied during the year, the
 * definitive one and the regularisation before 25 April.
 */
export function VatDeductionPage({ companyId }: { companyId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { can } = useCompanyAccess()
  const canWrite = can({ entries: ['create'] })
  const yearParam = searchParams?.get('annee') ?? ''
  const base = `/api/companies/${encodeURIComponent(companyId)}/vat-deduction`
  const { data, error, loading, reload } = useJson<VatDeductionView>(`${base}${/^\d{4}$/.test(yearParam) ? `?year=${yearParam}` : ''}`, LOAD_ERROR)
  const view = data && (!yearParam || String(data.year) === yearParam) ? data : null

  const chooseYear = (year: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('annee', year)
    router.replace(`${pathname}?${params.toString()}`)
  }
  const key = view ? `${view.year}:${JSON.stringify(view.settings)}:${view.partialVatDeduction}` : ''

  return (
    <div className="space-y-6">
      <PageHeader
        title="Coefficient de déduction de TVA"
        description="Pour une société qui réalise des opérations taxées et des opérations exonérées, comme un organisme de formation : la part de TVA déductible, provisoire pendant l’année, définitive avant le 25 avril suivant."
      />

      {error ? (
        <EmptyState bordered title="Le coefficient ne s’est pas chargé" description={error} action={<Button size="sm" onClick={reload}>Réessayer</Button>} />
      ) : !view || loading ? (
        <div aria-busy>
          <PageSkeleton />
        </div>
      ) : (
        <>
          <div className="w-full space-y-2 sm:w-48">
            <Label htmlFor="vat-deduction-year">Année</Label>
            <Select value={String(view.year)} onValueChange={chooseYear}>
              <SelectTrigger id="vat-deduction-year" className="w-full">
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

          {view.mode === 'full' ? (
            <Alert role="note">
              <Info aria-hidden />
              <AlertTitle>Déduction complète</AlertTitle>
              <AlertDescription>
                <p>La société déduit toute sa TVA. Activez la déduction par coefficient dans les réglages si elle réalise aussi des opérations exonérées.</p>
              </AlertDescription>
            </Alert>
          ) : null}
          {view.hints.map((hint) => (
            <Alert key={hint} role="note">
              <Info aria-hidden />
              <AlertDescription>
                <p>{hint}</p>
              </AlertDescription>
            </Alert>
          ))}

          <section className="grid gap-3 sm:grid-cols-3" aria-label="En bref">
            <StatCard
              label={`Coefficient provisoire ${view.year}`}
              value={view.mode === 'full' ? '100 %' : `${view.provisional.deductionPercent} %`}
              hint={view.mode === 'coefficient' ? `Taxation ${view.provisional.taxationPercent} %, assujettissement ${view.provisional.assujettissementPercent} %. ${SOURCE_LABELS[view.provisional.source]}.` : undefined}
            />
            <StatCard
              label={view.yearClosed ? `Coefficient définitif ${view.year}` : `Coefficient ${view.year} à ce jour`}
              value={percentText(view.definitiveDeductionPercent)}
              hint={`Coefficient de taxation ${percentText(view.taxationPercent)}${view.coefficientLine ? `, ligne ${view.coefficientLine} de la déclaration` : ''}`}
            />
            <StatCard
              label="Régularisation"
              value={view.regularisation.amountCents === null ? 'Non calculée' : <Amount value={euros(view.regularisation.amountCents)} />}
              hint={view.regularisation.line ? `Ligne ${view.regularisation.line.code} : ${view.regularisation.line.label}` : undefined}
            />
          </section>

          <SettingsCard key={`settings-${key}`} companyId={companyId} view={view} canWrite={canWrite} onSaved={reload} />
          <RevenueCard key={`revenue-${key}`} companyId={companyId} view={view} canWrite={canWrite} onSaved={reload} />
          {view.mode === 'coefficient' ? <RegularisationCard key={`regul-${key}`} companyId={companyId} view={view} canWrite={canWrite} onDone={reload} /> : null}

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
                <StatusBadge tone="info">Non couvert</StatusBadge> un coefficient par dépense (dépense utilisée seulement pour des opérations taxées ou seulement exonérées), les secteurs distincts d’activité (CGI, ann. II, art. 209) et les régularisations annuelles des immobilisations sur cinq ou vingt ans (art. 207)&nbsp;: à passer à la main.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
