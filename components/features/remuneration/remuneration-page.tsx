'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { CalendarClock, Download, FileText, Info, RotateCcw, Save, Scale, Send, Trash2 } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AmountInput } from '@/components/ui/amount-input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Amount, ConfirmDialog, EmptyState, Field, PageHeader, StatCard, formatAmount, formatDisplayDate } from '@/components/shared'
import { AccessNotice, useCompanyAccess } from '@/components/features/companies/company-access'
import { compactEuros } from '@/components/features/accounting/chart-format'
import { euros, sendJson, useJson } from '@/components/features/year-end/shared'
import { docsUrl } from '@/lib/docs-links'
import { breakdownRows, DISCLAIMER, SCENARIO_ORDER, STATUS_LABELS, TAXATION_LABELS } from '@/lib/remuneration/breakdown'
import { simulate, type ScenarioId } from '@/lib/remuneration/simulate'
import type { Basis, RemunerationView } from '@/lib/remuneration/load-remuneration.service'
import type { DirectorStatus, DividendTaxation, RemunerationInputs } from '@/lib/remuneration/schemas'
import type { SavedScenario } from '@/lib/remuneration/save-remuneration-scenario.service'

const LOAD_ERROR = 'Le simulateur ne s’est pas chargé. Réessayez dans un instant.'
const SAVE_ERROR = 'Le scénario n’a pas été enregistré. Réessayez dans un instant.'

const TAXATION_CHOICES: Record<DividendTaxation, string> = {
  best: 'Le plus favorable des deux',
  pfu: 'Prélèvement forfaitaire unique',
  bareme: 'Barème progressif (option)',
}

const percentText = (bp: number) => `${(bp / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`

/** A percentage typed in French ("33,5"), as basis points; null while it is not a number between 0 and 100. */
function parsePercent(text: string): number | null {
  const value = Number(text.replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(value) || value < 0 || value > 100) return null
  return Math.round(value * 100)
}

function PercentInput({ id, valueBp, onChange, disabled }: { id: string; valueBp: number; onChange: (bp: number) => void; disabled?: boolean }) {
  const [text, setText] = React.useState((valueBp / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 }))
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value)
          const bp = parsePercent(e.target.value)
          if (bp !== null) onChange(bp)
        }}
        className="pr-8"
      />
      <span aria-hidden className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm">
        %
      </span>
    </div>
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

function InputsCard({ view, inputs, onChange, onReset, changed }: { view: RemunerationView; inputs: RemunerationInputs; onChange: (patch: Partial<RemunerationInputs>) => void; onReset: () => void; changed: boolean }) {
  const [partsText, setPartsText] = React.useState(inputs.householdParts.toLocaleString('fr-FR'))
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Hypothèses</h2>
        </CardTitle>
        <CardDescription>Préremplies depuis les comptes et la composition du capital. Modifiez-les librement&nbsp;: rien n’est enregistré tant que vous n’enregistrez pas un scénario.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Résultat avant rémunération du dirigeant et avant impôt" htmlFor="rem-result" hint="Le budget à partager entre rémunération, impôt sur les sociétés et dividendes.">
            <AmountInput id="rem-result" allowNegative value={inputs.resultBeforePayCents} onValueChange={(v) => onChange({ resultBeforePayCents: v ?? 0 })} />
          </Field>
          <Field label="Statut du dirigeant" htmlFor="rem-status" hint={view.statusReason ?? undefined}>
            <Select value={inputs.status} onValueChange={(v) => onChange({ status: v as DirectorStatus })}>
              <SelectTrigger id="rem-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_LABELS) as DirectorStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Taux réduit de 15 % de l’impôt sur les sociétés"
            htmlFor="rem-reduced"
            hint={view.reducedRateEligible === null ? 'Conditions à confirmer sur la page Impôt sur les sociétés.' : `Jusqu’à ${formatAmount((inputs.reducedRateCeilingCents) / 100)} de bénéfice (CGI, art. 219, I, b).`}
          >
            <Select value={inputs.reducedRate ? 'yes' : 'no'} onValueChange={(v) => onChange({ reducedRate: v === 'yes' })}>
              <SelectTrigger id="rem-reduced" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Oui</SelectItem>
                <SelectItem value="no">Non</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Part du capital détenue par le dirigeant" htmlFor="rem-share" hint={view.shareholders.length ? 'D’après les associés enregistrés.' : 'Aucun associé enregistré.'}>
            <PercentInput id="rem-share" valueBp={inputs.shareBp} onChange={(shareBp) => onChange({ shareBp })} />
          </Field>
          <Field label="Part du bénéfice distribuable versée en dividendes" htmlFor="rem-distribution" hint="Le reste demeure dans la société (réserves, report à nouveau).">
            <PercentInput id="rem-distribution" valueBp={inputs.distributionBp} onChange={(distributionBp) => onChange({ distributionBp })} />
          </Field>
          <Field label="Imposition des dividendes" htmlFor="rem-taxation" hint="Flat tax de 31,4 %, ou barème après abattement de 40 % (option globale du foyer).">
            <Select value={inputs.dividendTaxation} onValueChange={(v) => onChange({ dividendTaxation: v as DividendTaxation })}>
              <SelectTrigger id="rem-taxation" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TAXATION_CHOICES) as DividendTaxation[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {TAXATION_CHOICES[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Parts du foyer fiscal" htmlFor="rem-parts" hint="1 pour une personne seule, 2 pour un couple, une demi-part par enfant pour les deux premiers.">
            <Input
              id="rem-parts"
              inputMode="decimal"
              autoComplete="off"
              value={partsText}
              onChange={(e) => {
                setPartsText(e.target.value)
                const parts = Number(e.target.value.replace(',', '.'))
                if (Number.isFinite(parts) && parts >= 1 && parts <= 20 && Number.isInteger(parts * 4)) onChange({ householdParts: parts })
              }}
            />
          </Field>
          <Field label="Autres revenus imposables du foyer" htmlFor="rem-other" hint="Revenu net imposable hors cette rémunération et ces dividendes (salaires du conjoint après 10 %, pensions...).">
            <AmountInput id="rem-other" value={inputs.otherIncomeCents} onValueChange={(v) => onChange({ otherIncomeCents: v ?? 0 })} />
          </Field>
          {inputs.status === 'tns' ? (
            <>
              <Field label="Primes d’émission détenues" htmlFor="rem-premiums" hint="Comptent dans le seuil de 10 % des dividendes (CSS, art. L131-6).">
                <AmountInput id="rem-premiums" value={inputs.premiumsCents} onValueChange={(v) => onChange({ premiumsCents: v ?? 0 })} />
              </Field>
              <Field
                label="Compte courant d’associé (solde moyen)"
                htmlFor="rem-current-account"
                hint={view.currentAccountsCents > 0 ? `Comptes 455 de l’exercice, tous associés : ${formatAmount(view.currentAccountsCents / 100)}.` : 'Compte aussi dans le seuil de 10 %.'}
              >
                <AmountInput id="rem-current-account" value={inputs.currentAccountCents} onValueChange={(v) => onChange({ currentAccountCents: v ?? 0 })} />
              </Field>
            </>
          ) : null}
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Capital, réserve légale et pertes antérieures</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <Field label="Capital social" htmlFor="rem-capital">
              <AmountInput id="rem-capital" value={inputs.capitalCents} onValueChange={(v) => onChange({ capitalCents: v ?? 0 })} />
            </Field>
            <Field label="Réserve légale déjà constituée" htmlFor="rem-reserve" hint="Dotée d’un vingtième du bénéfice jusqu’au dixième du capital (C. com., art. L232-10).">
              <AmountInput id="rem-reserve" value={inputs.legalReserveCents} onValueChange={(v) => onChange({ legalReserveCents: v ?? 0 })} />
            </Field>
            <Field label="Pertes antérieures (report à nouveau débiteur)" htmlFor="rem-losses">
              <AmountInput id="rem-losses" value={inputs.priorLossesCents} onValueChange={(v) => onChange({ priorLossesCents: v ?? 0 })} />
            </Field>
          </div>
        </details>
        {changed ? (
          <Button type="button" variant="outline" size="sm" onClick={onReset}>
            <RotateCcw aria-hidden />
            Revenir aux chiffres des comptes
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

const barsConfig = {
  net: { label: 'Net pour vous', color: 'var(--chart-revenue)' },
  levies: { label: 'Impôts et cotisations', color: 'var(--chart-expenses)' },
} satisfies ChartConfig

const curveConfig = { net: { label: 'Net pour vous', color: 'var(--chart-revenue)' } } satisfies ChartConfig

function Charts({ sim }: { sim: ReturnType<typeof simulate> }) {
  const bars = SCENARIO_ORDER.map((id) => ({ name: sim.scenarios[id].label, net: sim.scenarios[id].person.netIncomeCents / 100, levies: sim.scenarios[id].leviesCents / 100 }))
  const curve = sim.curve.map((p) => ({ share: `${Math.round(p.remunerationShareBp / 100)} %`, net: p.netIncomeCents / 100 }))
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Ce que devient le résultat</h2>
          </CardTitle>
          <CardDescription>Net pour vous et total des impôts et cotisations, par scénario.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={barsConfig} className="aspect-auto h-64 w-full">
            <BarChart data={bars} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} interval={0} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} width={56} tickFormatter={(v) => compactEuros(Number(v))} />
              <ChartTooltip cursor={{ fill: 'var(--muted)', opacity: 0.6 }} content={<ChartTooltipContent formatter={(value, name) => <span className="flex w-full justify-between gap-4"><span className="text-muted-foreground">{barsConfig[name as keyof typeof barsConfig]?.label}</span><span className="num font-medium">{formatAmount(Number(value))}</span></span>} />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="net" stackId="a" fill="var(--color-net)" maxBarSize={40} />
              <Bar dataKey="levies" stackId="a" fill="var(--color-levies)" radius={[3, 3, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Net selon la part en rémunération</h2>
          </CardTitle>
          <CardDescription>De tout en dividendes (0&nbsp;%) à tout en rémunération (100&nbsp;%).</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={curveConfig} className="aspect-auto h-64 w-full">
            <LineChart data={curve} accessibilityLayer margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="share" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} width={56} tickFormatter={(v) => compactEuros(Number(v))} />
              <ChartTooltip content={<ChartTooltipContent formatter={(value) => <span className="num font-medium">{formatAmount(Number(value))}</span>} />} />
              <Line dataKey="net" type="linear" stroke="var(--color-net)" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  )
}

function ComparisonCard({ sim, mixBp, onMix }: { sim: ReturnType<typeof simulate>; mixBp: number; onMix: (bp: number) => void }) {
  const rows = breakdownRows(sim)
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Scénarios comparés</h2>
        </CardTitle>
        <CardDescription>Tout en rémunération, tout en dividendes, le mixte du curseur et l’optimum, qui maximise votre revenu net dans le bénéfice distribuable.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="rem-mix">Mixte&nbsp;: part du résultat versée en rémunération, {percentText(mixBp)}</Label>
          <input
            id="rem-mix"
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(mixBp / 100)}
            onChange={(e) => onMix(Number(e.target.value) * 100)}
            className="accent-primary h-2 w-full cursor-pointer"
            aria-valuetext={percentText(mixBp)}
          />
        </div>
        <div className="hidden lg:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead> </TableHead>
                {SCENARIO_ORDER.map((id) => (
                  <TableHead key={id} numeric>
                    {sim.scenarios[id].label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="text-muted-foreground">Part du résultat en rémunération</TableCell>
                {SCENARIO_ORDER.map((id) => (
                  <TableCell key={id} numeric>
                    {percentText(sim.scenarios[id].remunerationShareBp)}
                  </TableCell>
                ))}
              </TableRow>
              {rows.map((r) => (
                <TableRow key={r.id} className={r.strong ? 'font-medium' : undefined}>
                  <TableCell className="whitespace-normal">{r.label}</TableCell>
                  {SCENARIO_ORDER.map((id) => (
                    <TableCell key={id} numeric>
                      <Amount value={euros(r.values[id])} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="text-muted-foreground">Imposition des dividendes</TableCell>
                {SCENARIO_ORDER.map((id) => (
                  <TableCell key={id} numeric className="text-xs">
                    {sim.scenarios[id].dividends.receivedCents > 0 ? (sim.scenarios[id].dividends.taxation === 'pfu' ? 'PFU' : 'Barème') : ''}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:hidden">
          {SCENARIO_ORDER.map((id) => (
            <section key={id} aria-label={sim.scenarios[id].label} className="rounded-lg border p-4">
              <h3 className="text-sm font-medium">
                {sim.scenarios[id].label} <span className="text-muted-foreground font-normal">({percentText(sim.scenarios[id].remunerationShareBp)} en rémunération)</span>
              </h3>
              <dl className="mt-2 space-y-1 text-sm">
                {rows.map((r) => (
                  <div key={r.id} className={`flex justify-between gap-3 ${r.strong ? 'font-medium' : ''}`}>
                    <dt className={r.strong ? undefined : 'text-muted-foreground'}>{r.label}</dt>
                    <dd className="num shrink-0">
                      <Amount value={euros(r.values[id])} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          PFU&nbsp;: {TAXATION_LABELS.pfu}. Barème&nbsp;: {TAXATION_LABELS.bareme}.
        </p>
      </CardContent>
    </Card>
  )
}

function ScenariosCard({
  companyId,
  view,
  inputs,
  canWrite,
  onSaved,
  onOpen,
}: {
  companyId: string
  view: RemunerationView
  inputs: RemunerationInputs
  canWrite: boolean
  onSaved: () => void
  onOpen: (scenario: SavedScenario) => void
}) {
  const [name, setName] = React.useState(view.scenario?.name ?? '')
  const [pick, setPick] = React.useState<ScenarioId>('optimum')
  const [busy, setBusy] = React.useState<string | null>(null)
  const [toDelete, setToDelete] = React.useState<SavedScenario | null>(null)
  const { denied } = useCompanyAccess()
  const base = `/api/companies/${encodeURIComponent(companyId)}/remuneration`
  const fy = view.fiscalYear

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!fy || !name.trim()) {
      toast.error('Donnez un nom au scénario.')
      return
    }
    setBusy('save')
    try {
      await sendJson(`${base}/scenarios`, 'PUT', { fiscalYearId: fy.id, name: name.trim(), inputs, pick }, SAVE_ERROR)
      toast.success('Scénario enregistré')
      onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const propose = async (scenario: SavedScenario) => {
    setBusy(scenario.id)
    try {
      await sendJson(`${base}/propose-dividends`, 'POST', { scenarioId: scenario.id }, 'Les dividendes n’ont pas été proposés. Réessayez dans un instant.')
      toast.success('Dividendes proposés dans l’approbation des comptes')
      onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const remove = async (scenario: SavedScenario) => {
    setBusy(scenario.id)
    try {
      await sendJson(`${base}/scenarios?scenarioId=${encodeURIComponent(scenario.id)}`, 'DELETE', undefined, 'Le scénario n’a pas été supprimé. Réessayez dans un instant.')
      toast.success('Scénario supprimé')
      onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
      setToDelete(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Scénarios enregistrés</h2>
        </CardTitle>
        <CardDescription>
          Gardez les hypothèses d’un scénario pour l’exercice {fy?.year}, puis proposez ses dividendes dans l’approbation des comptes, où les associés les votent.
          {view.approval.proposedDividendsCents !== null ? (
            <>
              {' '}Dividendes proposés aujourd’hui&nbsp;: <Amount value={euros(view.approval.proposedDividendsCents)} />.
            </>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canWrite ? <AccessNotice>{denied('enregistrer un scénario')}</AccessNotice> : null}
        {view.scenarios.length === 0 ? (
          <p className="text-muted-foreground text-sm">Aucun scénario enregistré pour cet exercice.</p>
        ) : (
          <ul className="divide-y">
            {view.scenarios.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-muted-foreground text-xs">
                    Net <Amount value={euros(s.netIncomeCents)} />, dividendes <Amount value={euros(s.dividendsCents)} />, rémunération <Amount value={euros(s.remunerationCostCents)} />, règles {s.rulesYear}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="xs" onClick={() => onOpen(s)}>
                    Ouvrir
                  </Button>
                  {canWrite ? (
                    <>
                      <Button variant="outline" size="xs" onClick={() => void propose(s)} loading={busy === s.id}>
                        <Send aria-hidden />
                        Proposer à l’approbation
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Supprimer le scénario ${s.name}`} title="Supprimer" onClick={() => setToDelete(s)} disabled={busy !== null}>
                        <Trash2 aria-hidden />
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
          <Field label="Nom du scénario" htmlFor="rem-name">
            <Input id="rem-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Mixte 40 %" maxLength={80} disabled={!canWrite} />
          </Field>
          <Field label="Scénario à garder" htmlFor="rem-pick">
            <Select value={pick} onValueChange={(v) => setPick(v as ScenarioId)} disabled={!canWrite}>
              <SelectTrigger id="rem-pick" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCENARIO_ORDER.map((id) => (
                  <SelectItem key={id} value={id}>
                    {{ allPay: 'Tout en rémunération', allDividends: 'Tout en dividendes', mix: 'Mixte', optimum: 'Optimum calculé' }[id]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Button type="submit" loading={busy === 'save'} disabled={!canWrite}>
            <Save aria-hidden />
            Enregistrer le scénario
          </Button>
        </form>
        <ConfirmDialog
          open={toDelete !== null}
          onOpenChange={(open) => !open && setToDelete(null)}
          title={`Supprimer le scénario ${toDelete?.name ?? ''}\u00a0?`}
          description="Ses hypothèses seront perdues. Les dividendes déjà proposés dans l’approbation des comptes ne changent pas."
          confirmLabel="Supprimer"
          loading={toDelete !== null && busy === toDelete.id}
          onConfirm={() => (toDelete ? remove(toDelete) : undefined)}
        />
      </CardContent>
    </Card>
  )
}

/**
 * Rémunération et dividendes (docs/remuneration-dividendes.md): what the
 * director-shareholder keeps from the year's result, paid as remuneration,
 * dividends or a mix, and the optimum. The service gives the defaults from
 * the books; the page simulates in the browser with the same pure module as
 * the server (lib/remuneration/simulate.ts), so the figures match the
 * exports, the simple home card and the MCP tool. Indicative, never advice.
 */
export function RemunerationPage({ companyId }: { companyId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { can } = useCompanyAccess()
  const canWrite = can({ closing: ['execute'] })
  const canExport = can({ reports: ['export'] })
  const fiscalYearId = searchParams?.get('exercice') ?? ''
  const scenarioId = searchParams?.get('scenario') ?? ''
  const basis = (searchParams?.get('base') ?? '') as Basis | ''
  const query = new URLSearchParams({ ...(fiscalYearId ? { fiscalYearId } : {}), ...(scenarioId ? { scenarioId } : {}), ...(basis ? { basis } : {}) })
  const base = `/api/companies/${encodeURIComponent(companyId)}/remuneration`
  const { data, error, loading, reload } = useJson<RemunerationView>(`${base}${query.size ? `?${query}` : ''}`, LOAD_ERROR)
  const [overrides, setOverrides] = React.useState<Partial<RemunerationInputs>>({})

  const view = data
  const loaded = view?.inputs ?? null
  const inputs = React.useMemo<RemunerationInputs | null>(() => (loaded ? { ...loaded, ...overrides } : null), [loaded, overrides])
  const sim = React.useMemo(() => (inputs ? simulate(inputs) : null), [inputs])

  const navigate = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) params.delete(k)
      else params.set(k, v)
    }
    setOverrides({})
    router.replace(`${pathname}?${params.toString()}`)
  }
  const fy = view?.fiscalYear
  const exportUrl = (format: 'pdf' | 'csv') =>
    `${base}/export?${new URLSearchParams({ ...(fy ? { fiscalYearId: fy.id } : {}), ...(scenarioId ? { scenarioId } : {}), ...(Object.keys(overrides).length ? { inputs: JSON.stringify(overrides) } : {}), ...(view?.basis ? { basis: view.basis } : {}), format })}`
  const key = `${fy?.id ?? ''}:${view?.scenario?.id ?? ''}:${view?.basis ?? ''}`

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rémunération et dividendes"
        description="Combien vous verser, et sous quelle forme&nbsp;? Comparez rémunération, dividendes et un mixte, avec l’impôt sur les sociétés, les cotisations et votre impôt sur le revenu."
        docsHref={docsUrl('equity')}
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
        <EmptyState bordered title="Le simulateur ne s’est pas chargé" description={error} action={<Button size="sm" onClick={reload}>Réessayer</Button>} />
      ) : !view || loading ? (
        <PageSkeleton />
      ) : view.status === 'no-fiscal-year' ? (
        <EmptyState
          bordered
          icon={CalendarClock}
          title="Aucun exercice"
          description="La simulation part du résultat d’un exercice. Créez le premier exercice de la société."
          action={
            <Button asChild size="sm">
              <Link href={`/${companyId}/fiscal-years`}>Créer un exercice</Link>
            </Button>
          }
        />
      ) : view.status === 'not-subject' || view.status === 'missing-regime' || view.status === 'unsupported-form' ? (
        <EmptyState
          bordered
          icon={Scale}
          title={view.status === 'unsupported-form' ? 'Forme juridique non couverte' : view.status === 'missing-regime' ? 'Régime d’impôt sur les sociétés non renseigné' : 'Société à l’impôt sur le revenu'}
          description={
            view.status === 'unsupported-form'
              ? (view.statusReason ?? 'Le simulateur couvre les sociétés à l’impôt sur les sociétés.')
              : view.status === 'missing-regime'
                ? 'Le simulateur compare rémunération et dividendes d’une société à l’impôt sur les sociétés. Renseignez son régime.'
                : 'Son bénéfice est imposé chez les associés : il n’y a pas de choix entre rémunération et dividendes à simuler.'
          }
          action={
            <Button asChild size="sm" variant="outline">
              <Link href={`/${companyId}/informations#regimes-fiscaux`}>Voir les informations de la société</Link>
            </Button>
          }
        />
      ) : inputs && sim && fy ? (
        <React.Fragment key={key}>
          <Alert role="note">
            <Info aria-hidden />
            <AlertTitle>Simulation indicative, pas un conseil</AlertTitle>
            <AlertDescription>
              <p>{DISCLAIMER}</p>
            </AlertDescription>
          </Alert>

          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full space-y-2 sm:w-60">
              <Label htmlFor="rem-year">Exercice</Label>
              <Select value={fy.id} onValueChange={(id) => navigate({ exercice: id, scenario: null })}>
                <SelectTrigger id="rem-year" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {view.fiscalYears.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      Exercice {y.year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full space-y-2 sm:w-80">
              <Label htmlFor="rem-basis">Résultat repris des comptes</Label>
              <Select value={view.basis ?? 'current'} onValueChange={(b) => navigate({ base: b, scenario: null })}>
                <SelectTrigger id="rem-basis" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {view.bases.map((b) => (
                    <SelectItem key={b.basis} value={b.basis}>
                      {b.label}, {formatAmount(b.resultBeforePayCents / 100)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-muted-foreground text-sm">
              Du {formatDisplayDate(fy.startDate)} au {formatDisplayDate(fy.endDate)}. {view.scenario ? `Scénario « ${view.scenario.name} ».` : ''}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Net pour vous, à l’optimum"
              value={<Amount value={euros(sim.scenarios.optimum.person.netIncomeCents)} />}
              hint={`${percentText(sim.scenarios.optimum.remunerationShareBp)} du résultat en rémunération, le reste en dividendes`}
            />
            <StatCard label="Tout en dividendes" value={<Amount value={euros(sim.scenarios.allDividends.person.netIncomeCents)} />} hint={`Dividendes reçus : ${formatAmount(sim.scenarios.allDividends.dividends.receivedCents / 100)}`} />
            <StatCard label="Tout en rémunération" value={<Amount value={euros(sim.scenarios.allPay.person.netIncomeCents)} />} hint={`Coût pour la société : ${formatAmount(sim.scenarios.allPay.company.remunerationCostCents / 100)}`} />
          </div>

          <InputsCard view={view} inputs={inputs} onChange={(patch) => setOverrides((o) => ({ ...o, ...patch }))} onReset={() => setOverrides({})} changed={Object.keys(overrides).length > 0} />

          <ComparisonCard sim={sim} mixBp={inputs.mixBp} onMix={(mixBp) => setOverrides((o) => ({ ...o, mixBp }))} />

          <Charts sim={sim} />

          <ScenariosCard companyId={companyId} view={view} inputs={inputs} canWrite={canWrite} onSaved={reload} onOpen={(s) => navigate({ scenario: s.id, exercice: s.fiscalYearId })} />

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>À savoir</h2>
              </CardTitle>
              <CardDescription>Ce que les chiffres supposent ou laissent de côté.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {[...view.checks, ...sim.notes].map((text) => (
                  <li key={text}>{text}</li>
                ))}
                <li>
                  Cotisations approchées avec les taux {view.rulesYear} et le plafond de la sécurité sociale de {formatAmount(view.passCents / 100)}&nbsp;: cadre sans assurance chômage pour un assimilé salarié, assiette unique après abattement de 26&nbsp;% pour un non salarié, sans mutuelle ni régularisations.
                </li>
                <li>Impôt sur le revenu au barème voté pour les revenus 2025, le dernier connu&nbsp;; ni réductions, ni crédits d’impôt, ni contribution sur les hauts revenus.</li>
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
                  <li key={source.label}>
                    <a href={source.url} target="_blank" rel="noreferrer" className="text-link inline-flex items-center gap-1 underline-offset-4 hover:underline">
                      <FileText aria-hidden className="size-3.5" />
                      {source.label}
                    </a>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </React.Fragment>
      ) : null}
    </div>
  )
}
