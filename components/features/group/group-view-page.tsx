'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { Download, FileSpreadsheet, Info, Lock, RotateCw, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Amount, EmptyState, HelpTip, PageHeader, StatCard, StatusBadge, formatAmount, formatDisplayDate, formatPercent } from '@/components/shared'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { compactEuros } from '@/components/features/accounting/chart-format'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { downloadFile } from '@/components/features/reports/download-file'
import { responseError } from '@/hooks/use-cursor-list'
import { cn } from '@/lib/utils'
import { FIGURE_ROWS, FLOW_CATEGORY_LABELS, INDICATIVE_NOTICE, PARTICIPATION_KIND_LABELS } from '@/lib/group/labels'
import type { GroupView } from '@/lib/group/get-group-view.service'
import type { ParticipationsReport } from '@/lib/group/get-participations.service'

type Tab = 'combined' | 'flows' | 'participations'

/**
 * Loads a JSON report with the three states of a client fetch. State is only
 * set when a response arrives; loading is derived (the request in flight is
 * not the one answered yet), and the previous report stays shown meanwhile.
 */
function useReport<T>(url: string | null, fallback: string) {
  const [version, setVersion] = React.useState(0)
  const [state, setState] = React.useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null })
  const key = url ? `${url}#${version}` : null
  React.useEffect(() => {
    if (!key || !url) return
    let cancelled = false
    fetch(url, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, fallback))
        return response.json() as Promise<T>
      })
      .then((data) => !cancelled && setState({ key, data, error: null }))
      .catch((e: Error) => !cancelled && setState((previous) => ({ key, data: previous.data, error: e.message })))
    return () => {
      cancelled = true
    }
  }, [key, url, fallback])
  const loading = key !== null && state.key !== key
  return { data: state.data, error: loading ? null : state.error, loading, retry: () => setVersion((v) => v + 1) }
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3" role="alert">
        <p className="text-sm">{message}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCw aria-hidden />
          Réessayer
        </Button>
      </CardContent>
    </Card>
  )
}

const cents = (value: number | null | undefined, signed = false) =>
  value === null || value === undefined ? <span className="text-muted-foreground">-</span> : <Amount value={value / 100} className={cn(signed && value < 0 && 'text-destructive')} />

const ownership = (bp: number | null) => (bp === null ? null : formatPercent(bp / 100))

/** /group: the group view of a holding. */
export function GroupViewPage({ companyId }: { companyId: string }) {
  const { can } = useCompanyAccess()
  const [fiscalYearId, setFiscalYearId] = React.useState('')
  const [tab, setTab] = React.useState<Tab>('combined')
  const [exporting, setExporting] = React.useState<'csv' | 'xlsx' | null>(null)
  const params = fiscalYearId ? new URLSearchParams({ companyId, fiscalYearId }).toString() : null
  const view = useReport<GroupView>(params ? `/api/group/view?${params}` : null, "La vue groupe ne s'est pas chargée. Réessayez dans un instant.")
  const participations = useReport<ParticipationsReport>(
    params && tab === 'participations' ? `/api/group/participations?${params}` : null,
    "Les participations ne se sont pas chargées. Réessayez dans un instant.",
  )

  const report: 'combined' | 'participations' = tab === 'participations' ? 'participations' : 'combined'
  const exportFile = async (format: 'csv' | 'xlsx') => {
    if (!params) return
    setExporting(format)
    try {
      await downloadFile(`/api/group/export?${params}&${new URLSearchParams({ report, format })}`, `${report === 'combined' ? 'Vue_groupe' : 'Participations'}.${format}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setExporting(null)
    }
  }

  const data = view.data
  const noGroup = data !== null && data.members.length === 1 && data.unreachable.length === 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vue groupe"
        description="Les chiffres de la holding et de ses filiales côte à côte et additionnés, les flux entre les sociétés du groupe, et les participations de la holding."
        actions={
          can({ reports: ['export'] }) && !noGroup ? (
            <>
              <Button variant="outline" onClick={() => exportFile('csv')} disabled={!data || exporting !== null} loading={exporting === 'csv'}>
                <Download aria-hidden />
                Exporter en CSV
              </Button>
              <Button variant="outline" onClick={() => exportFile('xlsx')} disabled={!data || exporting !== null} loading={exporting === 'xlsx'}>
                <FileSpreadsheet aria-hidden />
                Exporter en Excel
              </Button>
            </>
          ) : null
        }
      />

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="group-fiscal-year">Exercice de la holding</Label>
            <FiscalYearSelector companyId={companyId} value={fiscalYearId} onValueChange={setFiscalYearId} showLabel={false} showPeriod={false} id="group-fiscal-year" />
          </div>
          {data ? (
            <p className="text-muted-foreground text-sm sm:col-span-2 sm:self-end">
              Du <DateText value={data.fiscalYear.startDate} /> au <DateText value={data.fiscalYear.endDate} />, écritures validées de chaque société, écriture de clôture exclue.
              Chaque filiale est lue avec vos droits dans cette filiale.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {view.error ? (
        <LoadError message={view.error} onRetry={view.retry} />
      ) : noGroup ? (
        <EmptyState
          bordered
          title="Aucune filiale pour cette société"
          description="Une société est la holding d'une autre quand elle figure parmi ses actionnaires. Enregistrez la holding comme actionnaire « Société » sur la page Informations de chaque filiale."
        />
      ) : (
        <>
          <p className="text-muted-foreground flex items-start gap-2 text-sm" role="note">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{INDICATIVE_NOTICE}</span>
          </p>
          {data && data.warnings.length > 0 ? (
            <Card>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {data.warnings.map((w) => (
                    <li key={w} className="flex items-start gap-2">
                      <TriangleAlert aria-hidden className="text-warning mt-0.5 size-4 shrink-0" />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <div className="overflow-x-auto">
              <TabsList>
                <TabsTrigger value="combined">Vue combinée</TabsTrigger>
                <TabsTrigger value="flows">Flux intragroupe</TabsTrigger>
                <TabsTrigger value="participations">Participations</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="combined" className="space-y-6">
              <CombinedTab view={data} loading={view.loading || !data} />
            </TabsContent>
            <TabsContent value="flows" className="space-y-6">
              <FlowsTab view={data} loading={view.loading || !data} />
            </TabsContent>
            <TabsContent value="participations" className="space-y-6">
              {participations.error ? (
                <LoadError message={participations.error} onRetry={participations.retry} />
              ) : (
                <ParticipationsTab report={participations.data} loading={participations.loading || !participations.data} />
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}

function DateText({ value }: { value: string }) {
  return <>{formatDisplayDate(value, 'short')}</>
}

function MemberHeading({ name, role, bp }: { name: string; role: 'holding' | 'subsidiary'; bp: number | null }) {
  return (
    <span className="block">
      <span className="block whitespace-normal">{name}</span>
      <span className="text-muted-foreground block text-xs font-normal">{role === 'holding' ? 'Holding' : `Détenue à ${ownership(bp) ?? '?'}`}</span>
    </span>
  )
}

const treasuryConfig = { total: { label: 'Trésorerie du groupe', color: 'var(--chart-treasury)' } } satisfies ChartConfig

function CombinedTab({ view, loading }: { view: GroupView | null; loading: boolean }) {
  const after = view?.afterEliminations
  const points = (view?.treasury ?? []).map((t) => ({ month: formatDisplayDate(`${t.month}-01`, 'month'), total: t.totalCents / 100 }))
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy={loading || undefined}>
        <StatCard label="Chiffre d'affaires du groupe" value={after ? <Amount value={after.chiffreAffairesCents / 100} /> : '-'} hint="Après éliminations" busy={loading} />
        <StatCard
          label="Excédent brut d'exploitation"
          value={after ? <Amount value={after.ebeCents / 100} /> : '-'}
          valueClassName={after && after.ebeCents < 0 ? 'text-destructive' : undefined}
          hint="Après éliminations"
          busy={loading}
        />
        <StatCard
          label="Résultat combiné"
          value={after ? <Amount value={after.resultatCents / 100} /> : '-'}
          valueClassName={after && after.resultatCents < 0 ? 'text-destructive' : undefined}
          hint="Après éliminations"
          busy={loading}
        />
        <StatCard label="Trésorerie du groupe" value={after ? <Amount value={after.tresorerieCents / 100} /> : '-'} hint="Comptes 512 en fin d'exercice" busy={loading} />
      </div>

      <Card aria-busy={loading || undefined}>
        <CardHeader>
          <CardTitle>
            <h2>Chiffres par société</h2>
          </CardTitle>
          <CardDescription>
            Chaque société à 100 %, puis le total agrégé, les flux intragroupe retirés et le total après éliminations. Le pourcentage de détention est indiqué, jamais appliqué.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-48">Indicateur</TableHead>
                  {view?.members.map((m) => (
                    <TableHead key={m.id} numeric className="min-w-36 align-bottom">
                      <MemberHeading name={m.name} role={m.role} bp={m.ownershipBp} />
                    </TableHead>
                  ))}
                  <TableHead numeric className="min-w-36 align-bottom">
                    Total agrégé
                  </TableHead>
                  <TableHead numeric className="min-w-36 align-bottom">
                    <span className="inline-flex items-center gap-1">
                      Éliminations
                      <HelpTip term="Éliminations">
                        Les produits et les charges entre deux sociétés lisibles du groupe, les dividendes reçus d&apos;une filiale et les créances et dettes réciproques,
                        retirés une fois du total.
                      </HelpTip>
                    </span>
                  </TableHead>
                  <TableHead numeric className="min-w-36 align-bottom">
                    Après éliminations
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && !view ? (
                  <TableSkeleton columns={5} />
                ) : view ? (
                  FIGURE_ROWS.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell>
                        <span className="block">{row.label}</span>
                        <span className="text-muted-foreground block text-xs">{row.hint}</span>
                      </TableCell>
                      {view.members.map((m) => (
                        <TableCell key={m.id} numeric>
                          {m.figures ? cents(m.figures[row.key], row.key === 'resultatCents') : <span className="text-muted-foreground">Aucun exercice</span>}
                        </TableCell>
                      ))}
                      <TableCell numeric>{cents(view.combined[row.key], row.key === 'resultatCents')}</TableCell>
                      <TableCell numeric className="font-normal">
                        {view.eliminations.effect[row.key] === 0 ? <span className="text-muted-foreground">-</span> : cents(view.eliminations.effect[row.key])}
                      </TableCell>
                      <TableCell numeric className="font-semibold">
                        {cents(view.afterEliminations[row.key], row.key === 'resultatCents')}
                      </TableCell>
                    </TableRow>
                  ))
                ) : null}
              </TableBody>
            </Table>
          </div>
          {view && view.unreachable.length > 0 ? (
            <ul className="mt-4 space-y-1 text-sm">
              {view.unreachable.map((u, i) => (
                <li key={`${u.name ?? 'hidden'}-${i}`} className="text-muted-foreground flex items-start gap-2">
                  <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {u.name
                      ? `${u.name} : votre rôle dans cette filiale ne permet pas de lire ses états.`
                      : 'Une filiale du groupe n’est pas accessible avec votre compte : demandez à en être membre pour la voir ici.'}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Card aria-busy={loading || undefined}>
        <CardHeader>
          <CardTitle>
            <h2>Trésorerie du groupe</h2>
          </CardTitle>
          <CardDescription>Somme des soldes des comptes bancaires (512) des sociétés lisibles, en fin de mois.</CardDescription>
        </CardHeader>
        <CardContent className="px-2 sm:px-5">
          {points.length === 0 ? (
            <p className="text-muted-foreground px-3 text-sm sm:px-0">Aucun mois à afficher pour cet exercice.</p>
          ) : (
            <ChartContainer config={treasuryConfig} className="aspect-auto h-64 w-full">
              <LineChart data={points} accessibilityLayer margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} tickMargin={8} width={56} tickFormatter={(v) => compactEuros(Number(v))} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => (
                        <div className="flex w-full items-center justify-between gap-4">
                          <span className="text-muted-foreground">Trésorerie du groupe</span>
                          <span className="num font-medium">{formatAmount(Number(value))}</span>
                        </div>
                      )}
                    />
                  }
                />
                <Line dataKey="total" type="linear" stroke="var(--color-total)" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </>
  )
}

function FlowsTab({ view, loading }: { view: GroupView | null; loading: boolean }) {
  if (loading && !view) {
    return (
      <Card aria-busy>
        <CardContent>
          <Table>
            <TableBody>
              <TableSkeleton columns={5} />
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    )
  }
  if (!view) return null
  const names = new Map(view.members.map((m) => [m.id, m.name]))
  const nameOf = (id: string) => names.get(id) ?? 'Société du groupe'
  const perimeter = new Set(view.members.filter((m) => m.figures).map((m) => m.id))
  const { operations, dividends, balances } = view.eliminations
  if (view.flows.length === 0) {
    return (
      <EmptyState
        bordered
        title="Aucun flux intragroupe trouvé"
        description="Kledg cherche les factures entre sociétés du groupe (par SIREN), les frais de gestion, les comptes courants 451 et 455, les prêts 267 et 168 et les dividendes 761 dont le tiers ou le libellé nomme une société du groupe."
      />
    )
  }
  return (
    <>
      {operations.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Opérations entre sociétés</h2>
            </CardTitle>
            <CardDescription>Produits enregistrés par la société qui facture, charges enregistrées par celle qui reçoit la facture. Un écart signale un côté manquant ou différent.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Société qui facture</TableHead>
                    <TableHead>Société facturée</TableHead>
                    <TableHead className="hidden md:table-cell">Nature</TableHead>
                    <TableHead numeric>Produits</TableHead>
                    <TableHead numeric>Charges</TableHead>
                    <TableHead numeric>Écart</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {operations.map((p) => (
                    <TableRow key={`${p.sellerId}-${p.buyerId}`}>
                      <TableCell className="whitespace-normal">{nameOf(p.sellerId)}</TableCell>
                      <TableCell className="whitespace-normal">{nameOf(p.buyerId)}</TableCell>
                      <TableCell className="hidden whitespace-normal md:table-cell">{p.categories.map((c) => FLOW_CATEGORY_LABELS[c]).join(', ')}</TableCell>
                      <TableCell numeric>{cents(p.revenueCents)}</TableCell>
                      <TableCell numeric>{cents(p.chargeCents)}</TableCell>
                      <TableCell numeric className={cn(p.gapCents !== 0 && 'text-warning')}>
                        {p.gapCents === 0 ? <span className="text-muted-foreground">-</span> : <Amount value={p.gapCents / 100} />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {dividends.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Dividendes reçus d&apos;une société du groupe</h2>
            </CardTitle>
            <CardDescription>Retirés du résultat combiné&nbsp;: le résultat de la filiale qui les verse y est déjà.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Société qui reçoit</TableHead>
                    <TableHead>Société qui verse</TableHead>
                    <TableHead numeric>Montant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dividends.map((d) => (
                    <TableRow key={`${d.receiverId}-${d.payerId}`}>
                      <TableCell className="whitespace-normal">{nameOf(d.receiverId)}</TableCell>
                      <TableCell className="whitespace-normal">{nameOf(d.payerId)}</TableCell>
                      <TableCell numeric>{cents(d.cents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {balances.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Créances et dettes réciproques</h2>
            </CardTitle>
            <CardDescription>En fin d&apos;exercice. Le plus petit des deux montants est retiré de l&apos;actif et du passif combinés&nbsp;; la différence est un écart à justifier.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Créancier</TableHead>
                    <TableHead>Débiteur</TableHead>
                    <TableHead className="hidden md:table-cell">Nature</TableHead>
                    <TableHead numeric>Créance</TableHead>
                    <TableHead numeric>Dette</TableHead>
                    <TableHead numeric>Éliminé</TableHead>
                    <TableHead numeric>Écart</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balances.map((b) => (
                    <TableRow key={`${b.creditorId}-${b.debtorId}`}>
                      <TableCell className="whitespace-normal">{nameOf(b.creditorId)}</TableCell>
                      <TableCell className="whitespace-normal">{nameOf(b.debtorId)}</TableCell>
                      <TableCell className="hidden whitespace-normal md:table-cell">{b.categories.map((c) => FLOW_CATEGORY_LABELS[c]).join(', ')}</TableCell>
                      <TableCell numeric>{cents(b.receivableCents)}</TableCell>
                      <TableCell numeric>{cents(b.payableCents)}</TableCell>
                      <TableCell numeric>{cents(b.eliminatedCents)}</TableCell>
                      <TableCell numeric className={cn(b.gapCents !== 0 && 'text-warning')}>
                        {b.gapCents === 0 ? <span className="text-muted-foreground">-</span> : <Amount value={b.gapCents / 100} />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Lignes trouvées dans les livres</h2>
          </CardTitle>
          <CardDescription>Chaque ligne d&apos;une société sur une autre société du groupe, et comment Kledg l&apos;a reconnue.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dans les livres de</TableHead>
                  <TableHead>Avec</TableHead>
                  <TableHead className="hidden lg:table-cell">Nature</TableHead>
                  <TableHead className="hidden md:table-cell">Référence</TableHead>
                  <TableHead numeric>Montant</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.flows.map((f, i) => (
                  <TableRow key={`${f.companyId}-${f.counterpartyId}-${f.accountCode}-${f.reference}-${i}`}>
                    <TableCell className="whitespace-normal">{nameOf(f.companyId)}</TableCell>
                    <TableCell className="whitespace-normal">{nameOf(f.counterpartyId)}</TableCell>
                    <TableCell className="hidden whitespace-normal lg:table-cell">{FLOW_CATEGORY_LABELS[f.category]}</TableCell>
                    <TableCell className="hidden whitespace-normal md:table-cell">
                      <span className="font-mono text-xs">{f.accountCode}</span> {f.reference}
                      <span className="text-muted-foreground block text-xs">
                        {f.source === 'tiers' ? 'Reconnu au SIREN du tiers' : f.source === 'invoice' ? 'Facture, SIREN de la société' : 'Reconnu au libellé'}
                      </span>
                    </TableCell>
                    <TableCell numeric>{cents(f.cents)}</TableCell>
                    <TableCell>
                      {!f.inBooks ? (
                        <StatusBadge tone="warning">Non comptabilisé</StatusBadge>
                      ) : perimeter.has(f.companyId) && perimeter.has(f.counterpartyId) ? (
                        <StatusBadge tone="success">Éliminé</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">Hors périmètre</StatusBadge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  )
}

function ParticipationsTab({ report, loading }: { report: ParticipationsReport | null; loading: boolean }) {
  return (
    <Card aria-busy={loading || undefined}>
      <CardHeader>
        <CardTitle>
          <h2>Filiales et participations</h2>
        </CardTitle>
        <CardDescription>
          Les titres détenus par la holding (261, nets de la dépréciation 2961) et les chiffres de chaque filiale, pour le tableau des filiales et participations (formulaires 2059-G-SD ou
          2033-G-SD, annexe). Plus de 50&nbsp;% du capital&nbsp;: filiale&nbsp;; de 10 à 50&nbsp;%&nbsp;: participation (Code de commerce, art. L233-1 et L233-2).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-40">Société</TableHead>
                <TableHead className="hidden md:table-cell">Catégorie</TableHead>
                <TableHead numeric>Détention</TableHead>
                <TableHead numeric>Valeur nette des titres</TableHead>
                <TableHead numeric className="hidden lg:table-cell">
                  Capitaux propres
                </TableHead>
                <TableHead numeric className="hidden sm:table-cell">
                  Quote-part
                </TableHead>
                <TableHead numeric className="hidden lg:table-cell">
                  Résultat
                </TableHead>
                <TableHead numeric className="hidden lg:table-cell">
                  Prêts et avances
                </TableHead>
                <TableHead numeric className="hidden md:table-cell">
                  Dividendes
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !report ? (
                <TableSkeleton columns={9} />
              ) : report && report.rows.length === 0 && report.unreachable.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground whitespace-normal">
                    Aucune filiale lisible pour cet exercice.
                  </TableCell>
                </TableRow>
              ) : report ? (
                <>
                  {report.rows.map((r) => (
                    <TableRow key={r.subsidiaryId}>
                      <TableCell className="whitespace-normal">
                        <span className="block font-medium">{r.name}</span>
                        <span className="text-muted-foreground block text-xs">
                          {r.siren ? <span className="font-mono">{r.siren}</span> : null}
                          {r.fiscalYear && !r.samePeriod ? ` Exercice du ${formatDisplayDate(r.fiscalYear.startDate)} au ${formatDisplayDate(r.fiscalYear.endDate)}` : null}
                        </span>
                      </TableCell>
                      <TableCell className="hidden whitespace-normal md:table-cell">{PARTICIPATION_KIND_LABELS[r.kind]}</TableCell>
                      <TableCell numeric>{ownership(r.ownershipBp)}</TableCell>
                      <TableCell numeric>{cents(r.bookValueNetCents)}</TableCell>
                      <TableCell numeric className="hidden lg:table-cell">
                        {cents(r.capitauxPropresCents, true)}
                      </TableCell>
                      <TableCell numeric className="hidden sm:table-cell">
                        {cents(r.quotePartCents, true)}
                      </TableCell>
                      <TableCell numeric className="hidden lg:table-cell">
                        {cents(r.resultatCents, true)}
                      </TableCell>
                      <TableCell numeric className="hidden lg:table-cell">
                        {cents(r.loansCents)}
                      </TableCell>
                      <TableCell numeric className="hidden md:table-cell">
                        {cents(r.dividendsCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {report.unreachable.map((u, i) => (
                    <TableRow key={`unreachable-${i}`}>
                      <TableCell colSpan={9} className="text-muted-foreground whitespace-normal">
                        <span className="inline-flex items-start gap-2">
                          <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
                          {u.name ? `${u.name} : votre rôle ne permet pas de lire ses états.` : 'Filiale non accessible avec votre compte.'}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="hidden md:table-cell" />
                    <TableCell />
                    <TableCell numeric>{cents(report.totals.bookValueNetCents)}</TableCell>
                    <TableCell className="hidden lg:table-cell" />
                    <TableCell className="hidden sm:table-cell" />
                    <TableCell className="hidden lg:table-cell" />
                    <TableCell className="hidden lg:table-cell" />
                    <TableCell numeric className="hidden md:table-cell">
                      {cents(report.totals.dividendsCents)}
                    </TableCell>
                  </TableRow>
                </>
              ) : null}
            </TableBody>
          </Table>
        </div>
        {report && report.unattributed.length > 0 ? (
          <div className="space-y-2 text-sm">
            <p>
              Titres non rattachés à une filiale&nbsp;: le libellé du compte ne nomme aucune filiale lisible. Renommez le sous-compte (ex. « Titres Filiale Nord ») pour le rattacher.
            </p>
            <ul className="space-y-1">
              {report.unattributed.map((u) => (
                <li key={u.accountCode} className="flex justify-between gap-4">
                  <span>
                    <span className="font-mono text-xs">{u.accountCode}</span> {u.label}
                  </span>
                  <Amount value={u.cents / 100} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
