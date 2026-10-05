'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowUpRight, Download, Info, Plus, Trash2, TriangleAlert } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AmountInput } from '@/components/ui/amount-input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Amount, DateDisplay, EmptyState, PageHeader, StatCard, StatusBadge } from '@/components/shared'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { euros, sendJson, useJson } from '@/components/features/year-end/shared'
import { TRAINING_ORIGINS, type TrainingOrigin } from '@/lib/training-report/origins'
import type { CountHours, TrainingReportData } from '@/lib/training-report/schemas'
import type { TrainingReportView } from '@/lib/training-report/load-training-report.service'

const LOAD_ERROR = 'Le bilan pédagogique et financier ne s’est pas chargé. Réessayez dans un instant.'
const SAVE_ERROR = 'Le bilan n’a pas été enregistré. Réessayez dans un instant.'
const UNASSIGNED = 'unassigned'

function OriginSelect({ value, onChange, label, disabled }: { value: TrainingOrigin | null; onChange: (value: TrainingOrigin | null) => void; label: string; disabled?: boolean }) {
  return (
    <Select value={value ?? UNASSIGNED} onValueChange={(v) => onChange(v === UNASSIGNED ? null : (v as TrainingOrigin))} disabled={disabled}>
      <SelectTrigger aria-label={label} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED}>À affecter</SelectItem>
        {TRAINING_ORIGINS.map((o) => (
          <SelectItem key={o.code} value={o.code}>
            {o.line ? `${o.line}. ` : ''}
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function PairRow({ code, label, value, onChange, disabled }: { code?: string; label: string; value: CountHours; onChange: (value: CountHours) => void; disabled: boolean }) {
  const id = label.replace(/\W+/g, '-').toLowerCase()
  const set = (key: keyof CountHours, text: string) => {
    const n = Number(text)
    onChange({ ...value, [key]: Number.isInteger(n) && n >= 0 ? n : 0 })
  }
  return (
    <TableRow>
      <TableCell className="w-10 font-mono text-xs">{code}</TableCell>
      <TableCell className="min-w-56 whitespace-normal">{label}</TableCell>
      <TableCell className="w-32">
        <Input aria-label={`${label}, nombre`} id={`${id}-count`} inputMode="numeric" value={String(value.count)} onChange={(e) => set('count', e.target.value)} disabled={disabled} />
      </TableCell>
      <TableCell className="w-32">
        <Input aria-label={`${label}, heures`} id={`${id}-hours`} inputMode="numeric" value={String(value.hours)} onChange={(e) => set('hours', e.target.value)} disabled={disabled} />
      </TableCell>
    </TableRow>
  )
}

function TotalRow({ code, label, value }: { code: string; label: string; value: CountHours }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{code}</TableCell>
      <TableCell className="font-medium">{label}</TableCell>
      <TableCell className="num font-medium">{value.count}</TableCell>
      <TableCell className="num font-medium">{value.hours}</TableCell>
    </TableRow>
  )
}

function FrameTable({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              <TableHead />
              <TableHead>Nombre</TableHead>
              <TableHead>Heures</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{children}</TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

const add = (...pairs: CountHours[]) => pairs.reduce((s, p) => ({ count: s.count + p.count, hours: s.hours + p.hours }), { count: 0, hours: 0 })

function FramesForm({ companyId, view, canWrite, onSaved }: { companyId: string; view: TrainingReportView; canWrite: boolean; onSaved: () => void }) {
  const [data, setData] = React.useState<TrainingReportData>(view.data)
  const [saving, setSaving] = React.useState(false)
  const disabled = !canWrite
  const set = <K extends keyof TrainingReportData>(key: K, value: TrainingReportData[K]) => setData((d) => ({ ...d, [key]: value }))
  const trainee = (key: keyof TrainingReportData['trainees']) => (value: CountHours) => set('trainees', { ...data.trainees, [key]: value })
  const objective = (key: keyof TrainingReportData['objectives']) => (value: CountHours) => set('objectives', { ...data.objectives, [key]: value })

  const save = async () => {
    if (!view.fiscalYear) return
    setSaving(true)
    try {
      await sendJson(`/api/companies/${encodeURIComponent(companyId)}/training-report`, 'PUT', { fiscalYearId: view.fiscalYear.id, data }, SAVE_ERROR)
      toast.success('Bilan enregistré')
      onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const t = data.trainees
  const o = data.objectives
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>B. Informations générales et D. Charges</h2>
          </CardTitle>
          <CardDescription>
            Les charges viennent des comptes (classe 6 hors 69, 6411, 604 et 6226) tant que vous ne les saisissez pas&nbsp;: vous seul savez lesquelles relèvent de l’activité de formation.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="bpf-distance">Formation en tout ou partie à distance</Label>
            <Select value={data.distanceLearning === null ? 'unknown' : data.distanceLearning ? 'yes' : 'no'} onValueChange={(v) => set('distanceLearning', v === 'unknown' ? null : v === 'yes')} disabled={disabled}>
              <SelectTrigger id="bpf-distance" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unknown">À préciser</SelectItem>
                <SelectItem value="yes">Oui</SelectItem>
                <SelectItem value="no">Non</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(
            [
              ['totalCents', 'Total des charges liées à la formation', view.frameD?.total],
              ['trainerSalariesCents', 'Dont salaires des formateurs', view.frameD?.trainerSalaries],
              ['trainingPurchasesCents', 'Dont achats de prestations et honoraires de formation', view.frameD?.trainingPurchases],
            ] as const
          ).map(([key, label, current]) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={`bpf-${key}`}>{label}</Label>
              <AmountInput id={`bpf-${key}`} value={data.charges[key]} onValueChange={(v) => set('charges', { ...data.charges, [key]: v })} disabled={disabled} />
              <p className="text-muted-foreground text-xs">{current ? `${current.source === 'books' ? 'D’après les comptes' : 'Saisi'} : ${current.euros.toLocaleString('fr-FR')} €` : null}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <FrameTable title="E. Personnes dispensant des heures de formation">
        <PairRow label="Personnes de votre organisme" value={data.trainers.internal} onChange={(v) => set('trainers', { ...data.trainers, internal: v })} disabled={disabled} />
        <PairRow label="Personnes extérieures (sous-traitance)" value={data.trainers.external} onChange={(v) => set('trainers', { ...data.trainers, external: v })} disabled={disabled} />
      </FrameTable>

      <FrameTable title="F-1. Type de stagiaires" description="Heures suivies par les stagiaires : 12 stagiaires de 6 heures font 72 heures.">
        <PairRow code="a" label="Salariés d’employeurs privés hors apprentis" value={t.employees} onChange={trainee('employees')} disabled={disabled} />
        <PairRow code="b" label="Apprentis" value={t.apprentices} onChange={trainee('apprentices')} disabled={disabled} />
        <PairRow code="c" label="Personnes en recherche d’emploi" value={t.jobSeekers} onChange={trainee('jobSeekers')} disabled={disabled} />
        <PairRow code="d" label="Particuliers à leurs propres frais" value={t.individuals} onChange={trainee('individuals')} disabled={disabled} />
        <PairRow code="e" label="Autres stagiaires" value={t.others} onChange={trainee('others')} disabled={disabled} />
        <TotalRow code="1" label="Total" value={add(t.employees, t.apprentices, t.jobSeekers, t.individuals, t.others)} />
        <PairRow code="2" label="F-2. Dont activité confiée à un autre organisme" value={data.subcontracted} onChange={(v) => set('subcontracted', v)} disabled={disabled} />
      </FrameTable>

      <FrameTable title="F-3. Objectif général des prestations">
        <PairRow code="a" label="Diplôme, titre ou CQP enregistré au RNCP" value={o.rncp} onChange={objective('rncp')} disabled={disabled} />
        <PairRow label="dont niveau 6 à 8" value={o.rncpLevel6to8} onChange={objective('rncpLevel6to8')} disabled={disabled} />
        <PairRow label="dont niveau 5" value={o.rncpLevel5} onChange={objective('rncpLevel5')} disabled={disabled} />
        <PairRow label="dont niveau 4" value={o.rncpLevel4} onChange={objective('rncpLevel4')} disabled={disabled} />
        <PairRow label="dont niveau 3" value={o.rncpLevel3} onChange={objective('rncpLevel3')} disabled={disabled} />
        <PairRow label="dont niveau 2" value={o.rncpLevel2} onChange={objective('rncpLevel2')} disabled={disabled} />
        <PairRow label="dont CQP sans niveau de qualification" value={o.rncpCqpWithoutLevel} onChange={objective('rncpCqpWithoutLevel')} disabled={disabled} />
        <PairRow code="b" label="Certification ou habilitation au répertoire spécifique (RS)" value={o.rs} onChange={objective('rs')} disabled={disabled} />
        <PairRow code="c" label="CQP non enregistré au RNCP ou au RS" value={o.cqpNotRegistered} onChange={objective('cqpNotRegistered')} disabled={disabled} />
        <PairRow code="d" label="Autres formations professionnelles" value={o.other} onChange={objective('other')} disabled={disabled} />
        <PairRow code="e" label="Bilans de compétence" value={o.skillsAssessment} onChange={objective('skillsAssessment')} disabled={disabled} />
        <PairRow code="f" label="Accompagnement à la validation des acquis de l’expérience" value={o.vae} onChange={objective('vae')} disabled={disabled} />
        <TotalRow code="3" label="Total" value={add(o.rncp, o.rs, o.cqpNotRegistered, o.other, o.skillsAssessment, o.vae)} />
      </FrameTable>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>F-4. Spécialités de formation</h2>
          </CardTitle>
          <CardDescription>Les cinq principales, avec le code NSF à trois chiffres de la notice (314 Comptabilité, gestion...)&nbsp;; les autres ensemble.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.specialities.map((s, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[6rem_1fr_7rem_7rem_auto] sm:items-center">
              <Input aria-label={`Spécialité ${i + 1}, code`} value={s.code} maxLength={3} onChange={(e) => set('specialities', data.specialities.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} disabled={disabled} />
              <Input aria-label={`Spécialité ${i + 1}, libellé`} value={s.label} onChange={(e) => set('specialities', data.specialities.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} disabled={disabled} />
              <Input aria-label={`Spécialité ${i + 1}, nombre`} inputMode="numeric" value={String(s.count)} onChange={(e) => set('specialities', data.specialities.map((x, j) => (j === i ? { ...x, count: Math.max(0, Math.trunc(Number(e.target.value)) || 0) } : x)))} disabled={disabled} />
              <Input aria-label={`Spécialité ${i + 1}, heures`} inputMode="numeric" value={String(s.hours)} onChange={(e) => set('specialities', data.specialities.map((x, j) => (j === i ? { ...x, hours: Math.max(0, Math.trunc(Number(e.target.value)) || 0) } : x)))} disabled={disabled} />
              <Button variant="ghost" size="icon" aria-label={`Retirer la spécialité ${i + 1}`} onClick={() => set('specialities', data.specialities.filter((_, j) => j !== i))} disabled={disabled}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          {canWrite && data.specialities.length < 5 ? (
            <Button variant="outline" size="sm" onClick={() => set('specialities', [...data.specialities, { code: '', label: '', count: 0, hours: 0 }])}>
              <Plus aria-hidden />
              Ajouter une spécialité
            </Button>
          ) : null}
          <Table>
            <TableBody>
              <PairRow label="Autres spécialités" value={data.otherSpecialities} onChange={(v) => set('otherSpecialities', v)} disabled={disabled} />
              <TotalRow code="4" label="Total" value={add(...data.specialities.map((s) => ({ count: s.count, hours: s.hours })), data.otherSpecialities)} />
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <FrameTable title="G. Stagiaires confiés par un autre organisme de formation" description="Correspond aux produits de la ligne 10 du cadre C.">
        <PairRow code="5" label="Formations confiées à votre organisme par un autre organisme" value={data.entrusted} onChange={(v) => set('entrusted', v)} disabled={disabled} />
      </FrameTable>

      {canWrite ? (
        <div className="flex justify-end">
          <Button onClick={() => void save()} loading={saving}>
            Enregistrer le bilan
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function FrameCCard({ companyId, view, canWrite, onSaved }: { companyId: string; view: TrainingReportView; canWrite: boolean; onSaved: () => void }) {
  const [busy, setBusy] = React.useState<string | null>(null)
  const c = view.frameC
  const accounts = [...new Map(view.revenue.map((r) => [r.code, r.label])).entries()]
  const accountOrigin = (code: string) => view.accountOrigins.find((a) => a.accountCode === code)?.trainingOrigin ?? null
  const saveOrigin = async (key: string, body: Record<string, unknown>) => {
    setBusy(key)
    try {
      await sendJson(`/api/companies/${encodeURIComponent(companyId)}/training-report/origins`, 'PUT', body, SAVE_ERROR)
      toast.success('Origine enregistrée')
      onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  if (!c) return null
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>C. Origine des produits (hors taxes)</h2>
          </CardTitle>
          <CardDescription>Depuis les comptes 70 et 74 de l’exercice, d’après l’origine affectée à chaque client, sinon à chaque compte. Montants arrondis à l’euro.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableBody>
              {c.lines.map((line) => (
                <React.Fragment key={line.code}>
                  <TableRow>
                    <TableCell className="w-10 font-mono text-xs">{line.line}</TableCell>
                    <TableCell className="whitespace-normal">{line.label}</TableCell>
                    <TableCell className="text-right"><Amount value={line.euros} decimals={0} /></TableCell>
                  </TableRow>
                  {line.code === 'c2h' ? (
                    <TableRow>
                      <TableCell className="font-mono text-xs">2</TableCell>
                      <TableCell className="font-medium">Total des organismes gestionnaires des fonds de la formation (a à h)</TableCell>
                      <TableCell className="text-right font-medium"><Amount value={c.opcoTotalEuros} decimals={0} /></TableCell>
                    </TableRow>
                  ) : null}
                </React.Fragment>
              ))}
              <TableRow>
                <TableCell />
                <TableCell className="font-medium">Total des produits au titre de la formation professionnelle (lignes 1 à 11)</TableCell>
                <TableCell className="text-right font-medium"><Amount value={c.totalEuros} decimals={0} /></TableCell>
              </TableRow>
              <TableRow>
                <TableCell />
                <TableCell>Part du chiffre d’affaires global réalisée en formation professionnelle</TableCell>
                <TableCell className="num text-right">{c.sharePercent === null ? 'Sans chiffre d’affaires' : `${c.sharePercent} %`}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          {c.unassignedCents !== 0 ? (
            <p className="mt-3 text-sm">
              <StatusBadge tone="warning">À affecter</StatusBadge> <Amount value={euros(c.unassignedCents)} /> de recettes sans origine.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Origine des recettes</h2>
          </CardTitle>
          <CardDescription>Affectez une fois chaque compte de produits (par exemple un 706 par financeur) ou chaque client à sa ligne du cadre C&nbsp;; l’origine du client l’emporte sur celle du compte.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <p className="text-sm font-medium">Comptes</p>
            {accounts.map(([code, label]) => (
              <div key={code} className="grid gap-2 sm:grid-cols-[1fr_24rem] sm:items-center">
                <span className="text-sm">
                  <span className="num">{code}</span> <span className="text-muted-foreground">{label}</span>
                </span>
                <OriginSelect value={accountOrigin(code)} label={`Origine du compte ${code}`} disabled={!canWrite || busy === code} onChange={(v) => void saveOrigin(code, { accounts: [{ accountCode: code, trainingOrigin: v }] })} />
              </div>
            ))}
          </div>
          {view.customers.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Clients</p>
              {view.customers.map((customer) => (
                <div key={customer.id} className="grid gap-2 sm:grid-cols-[1fr_8rem_24rem] sm:items-center">
                  <span className="text-sm">{customer.name}</span>
                  <span className="text-right text-sm"><Amount value={euros(customer.cents)} /></span>
                  <OriginSelect value={customer.trainingOrigin} label={`Origine du client ${customer.name}`} disabled={!canWrite || busy === customer.id} onChange={(v) => void saveOrigin(customer.id, { customers: [{ tiersId: customer.id, trainingOrigin: v }] })} />
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </>
  )
}

/**
 * Bilan pédagogique et financier (docs/organisme-de-formation.md): the
 * frames of cerfa 10443*17 for a closed fiscal year, frame C from the books
 * and the origins assigned, the other frames entered by hand, the checks of
 * the notice, a CSV to copy into Mon Activité Formation.
 */
export function TrainingReportPage({ companyId }: { companyId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { can } = useCompanyAccess()
  const canWrite = can({ entries: ['create'] })
  const canExport = can({ reports: ['export'] })
  const fyParam = searchParams?.get('exercice') ?? ''
  const base = `/api/companies/${encodeURIComponent(companyId)}/training-report`
  const { data, error, loading, reload } = useJson<TrainingReportView>(`${base}${fyParam ? `?fiscalYearId=${encodeURIComponent(fyParam)}` : ''}`, LOAD_ERROR)
  const view = data && (!fyParam || data.fiscalYear?.id === fyParam) ? data : null

  const choose = (id: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('exercice', id)
    router.replace(`${pathname}?${params.toString()}`)
  }
  const key = view ? `${view.fiscalYear?.id}:${JSON.stringify(view.data)}:${JSON.stringify(view.accountOrigins)}` : ''

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bilan pédagogique et financier"
        description="Le bilan annuel d’un organisme de formation (cerfa 10443), à déposer avant le 30 avril sur Mon Activité Formation : Kledg calcule l’origine des produits depuis les comptes, vous saisissez les stagiaires et les heures."
        actions={
          canExport && view?.fiscalYear ? (
            <Button asChild variant="outline">
              <a href={`${base}/export?${new URLSearchParams({ fiscalYearId: view.fiscalYear.id, format: 'csv' })}`} download>
                <Download aria-hidden />
                CSV
              </a>
            </Button>
          ) : null
        }
      />

      <Alert role="note">
        <Info aria-hidden />
        <AlertTitle>Kledg prépare, vous déposez</AlertTitle>
        <AlertDescription>
          <p>
            Recopiez les cadres sur{' '}
            <a href="https://www.monactiviteformation.emploi.gouv.fr/mon-activite-formation/" target="_blank" rel="noreferrer" className="text-link inline-flex items-center gap-1 underline-offset-4 hover:underline">
              Mon Activité Formation
              <ArrowUpRight aria-hidden className="size-3.5" />
            </a>
            . Sans bilan, la déclaration d’activité devient caduque (Code du travail, art. L6351-6).
          </p>
        </AlertDescription>
      </Alert>

      {error ? (
        <EmptyState bordered title="Le bilan ne s’est pas chargé" description={error} action={<Button size="sm" onClick={reload}>Réessayer</Button>} />
      ) : !view || loading ? (
        <div aria-busy className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : !view.fiscalYear ? (
        <EmptyState bordered title="Aucun exercice" description="Le bilan porte sur un exercice comptable clos : créez les exercices de la société." />
      ) : (
        <>
          {!view.trainingOrganisation ? (
            <Alert role="note">
              <Info aria-hidden />
              <AlertDescription>
                <p>Aucun établissement n’est déclaré organisme de formation (Informations de la société, Établissements).</p>
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="w-full space-y-2 sm:w-72">
            <Label htmlFor="bpf-fiscal-year">Exercice</Label>
            <Select value={view.fiscalYear.id} onValueChange={choose}>
              <SelectTrigger id="bpf-fiscal-year" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {view.fiscalYears.map((fy) => (
                  <SelectItem key={fy.id} value={fy.id}>
                    Exercice {fy.year} ({fy.startDate.split('-').reverse().join('/')} au {fy.endDate.split('-').reverse().join('/')})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <section className="grid gap-3 sm:grid-cols-3" aria-label="En bref">
            <StatCard label="Produits de la formation" value={<Amount value={view.frameC?.totalEuros ?? 0} decimals={0} />} hint={view.frameC?.sharePercent !== null && view.frameC ? `${view.frameC.sharePercent} % du chiffre d’affaires` : undefined} />
            <StatCard label="Stagiaires" value={view.totals.trainees.count.toLocaleString('fr-FR')} hint={`${view.totals.trainees.hours.toLocaleString('fr-FR')} heures`} />
            <StatCard
              label="À déposer avant le"
              value={view.deadline ? <DateDisplay value={view.deadline.date} /> : 'Non connu'}
              hint={view.deadline?.extendedDate ? `Campagne prolongée jusqu’au ${view.deadline.extendedDate.split('-').reverse().join('/')}` : 'Code du travail, art. R6352-23'}
            />
          </section>

          {view.checks.map((check) => (
            <Alert key={check} role="note">
              <TriangleAlert aria-hidden />
              <AlertDescription>
                <p>{check}</p>
              </AlertDescription>
            </Alert>
          ))}

          <FrameCCard key={`c-${key}`} companyId={companyId} view={view} canWrite={canWrite} onSaved={reload} />
          <FramesForm key={`frames-${key}`} companyId={companyId} view={view} canWrite={canWrite} onSaved={reload} />

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
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
