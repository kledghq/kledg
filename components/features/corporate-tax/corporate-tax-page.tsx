'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowUpRight, CalendarClock, Download, FilePlus2, FileText, Info, Plus, Scale, Trash2 } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AmountInput } from '@/components/ui/amount-input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DateInput } from '@/components/ui/date-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Amount, ConfirmDialog, DateDisplay, EmptyState, Field, PageHeader, StatCard, StatusBadge, formatDisplayDate, type StatusTone } from '@/components/shared'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { euros, sendJson, useJson } from '@/components/features/year-end/shared'
import { docsUrl } from '@/lib/docs-links'
import type { CorporateTaxView, DraftEntryState } from '@/lib/corporate-tax/load-corporate-tax.service'
import type { WorksheetLine } from '@/lib/corporate-tax/compute'
import type { CheckSeverity } from '@/lib/corporate-tax/checks'
import type { ManualLine, ManualKind } from '@/lib/corporate-tax/adjustments'
import type { AcomptePaid } from '@/lib/corporate-tax/acomptes'
import type { CorporateTaxEntryResult } from '@/lib/corporate-tax/prepare-corporate-tax-entries.service'

const SEVERITY: Record<CheckSeverity, { tone: StatusTone; label: string }> = {
  blocking: { tone: 'danger', label: 'À corriger' },
  warning: { tone: 'warning', label: 'À vérifier' },
  info: { tone: 'info', label: 'Information' },
  ok: { tone: 'success', label: 'OK' },
}

const ORIGIN: Record<WorksheetLine['origin'], { tone: StatusTone; label: string }> = {
  books: { tone: 'success', label: 'Comptes' },
  group: { tone: 'info', label: 'Filiales' },
  manual: { tone: 'warning', label: 'Saisi' },
  total: { tone: 'neutral', label: 'Total' },
}

const KIND_LABELS: Record<ManualKind, string> = {
  reintegration: 'Réintégration',
  deduction: 'Déduction',
  credit: 'Crédit d’impôt',
}

const LOAD_ERROR = 'L’impôt sur les sociétés ne s’est pas chargé. Réessayez dans un instant.'
const SAVE_ERROR = 'Les informations n’ont pas été enregistrées. Réessayez dans un instant.'

type Answer = 'yes' | 'no' | 'unknown'
const toAnswer = (value: boolean | null): Answer => (value === null ? 'unknown' : value ? 'yes' : 'no')
const fromAnswer = (value: Answer): boolean | null => (value === 'unknown' ? null : value === 'yes')

function useSave(companyId: string, fiscalYearId: string, onSaved: () => void) {
  const [saving, setSaving] = React.useState(false)
  const save = async (fields: Record<string, unknown>, success: string) => {
    setSaving(true)
    try {
      await sendJson(`/api/companies/${encodeURIComponent(companyId)}/corporate-tax/inputs`, 'PUT', { fiscalYearId, ...fields }, SAVE_ERROR)
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

function WorksheetTable({ lines }: { lines: WorksheetLine[] }) {
  return (
    <>
      <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Ligne</TableHead>
              <TableHead>Libellé</TableHead>
              <TableHead className="w-28">Origine</TableHead>
              <TableHead numeric className="w-40">
                Montant
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.id} className={line.kind === 'total' || line.kind === 'subtotal' ? 'font-medium' : undefined}>
                <TableCell className="font-mono text-xs">{line.formLine ?? ''}</TableCell>
                <TableCell className="whitespace-normal">
                  <span className="block">
                    {line.kind === 'reintegration' ? 'Plus : ' : line.kind === 'deduction' || line.kind === 'deficits' ? 'Moins : ' : ''}
                    {line.label}
                  </span>
                  <span className="text-muted-foreground block text-xs">{line.hint}</span>
                </TableCell>
                <TableCell>
                  <StatusBadge tone={ORIGIN[line.origin].tone}>{ORIGIN[line.origin].label}</StatusBadge>
                </TableCell>
                <TableCell numeric>
                  <Amount value={euros(line.amountCents)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="divide-y lg:hidden" aria-label="Lignes du résultat fiscal">
        {lines.map((line) => (
          <li key={line.id} className="space-y-1 py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm">
                {line.formLine ? <span className="font-mono text-xs">{line.formLine} </span> : null}
                {line.label}
              </p>
              <span className="num shrink-0 text-sm">
                <Amount value={euros(line.amountCents)} />
              </span>
            </div>
            <p className="text-muted-foreground text-xs">{line.hint}</p>
          </li>
        ))}
      </ul>
    </>
  )
}

function DraftLink({ companyId, state }: { companyId: string; state: DraftEntryState }) {
  if (state.status === 'none' || !state.entryId) return <span className="text-muted-foreground text-sm">Pas encore préparée.</span>
  return (
    <span className="text-sm">
      {state.status === 'validated' ? 'Validée' : 'Brouillon'}{' '}
      <Link href={`/${companyId}/entries/${state.entryId}`} className="text-link font-mono underline-offset-4 hover:underline">
        {state.entryNumber}
      </Link>
    </span>
  )
}

function usePrepare(companyId: string, onDone: () => void) {
  const [busy, setBusy] = React.useState<string | null>(null)
  const prepare = async (key: string, body: Record<string, unknown>) => {
    setBusy(key)
    try {
      const result = await sendJson<CorporateTaxEntryResult>(
        `/api/companies/${encodeURIComponent(companyId)}/corporate-tax/entries`,
        'POST',
        body,
        'L’écriture n’a pas été préparée. Réessayez dans un instant.',
      )
      if (result) toast.success(result.message)
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  return { busy, prepare }
}

function QuestionsCard({ companyId, view, canWrite, onSaved }: { companyId: string; view: CorporateTaxView; canWrite: boolean; onSaved: () => void }) {
  const fy = view.fiscalYear
  const c = view.computation
  const [capital, setCapital] = React.useState<Answer>(toAnswer(view.answers.capitalPaidUp.value))
  const [persons, setPersons] = React.useState<Answer>(toAnswer(view.answers.naturalPersons75.value))
  const [deficits, setDeficits] = React.useState<number | null>(view.deficits.openingTypedCents)
  const { saving, save } = useSave(companyId, fy?.id ?? '', onSaved)
  if (!fy || !c) return null
  const turnoverOk = c.eligibility.turnoverOk
  const sources = {
    capital: view.answers.capitalPaidUp.from === 'books' ? 'Déduit des comptes : capital souscrit non appelé ou appelé non versé.' : null,
    persons:
      view.answers.naturalPersons75.from === 'shareholders'
        ? `D’après les associés enregistrés : ${(view.answers.shareholders.naturalBp / 100).toLocaleString('fr-FR')} % détenus par des personnes physiques.`
        : view.answers.shareholders.complete
          ? null
          : 'Les associés enregistrés ne totalisent pas 100 % du capital : répondez à la question.',
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    void save({ capitalPaidUp: fromAnswer(capital), naturalPersons75: fromAnswer(persons), deficitsOpeningCents: deficits }, 'Informations enregistrées')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Taux réduit et déficits</h2>
        </CardTitle>
        <CardDescription>
          Le taux de 15&nbsp;% s’applique jusqu’à 42&nbsp;500&nbsp;€ de bénéfice par période de douze mois si le chiffre d’affaires ne dépasse pas 10&nbsp;M€, le capital est entièrement libéré et détenu à 75&nbsp;% au moins par des personnes physiques (CGI, art.&nbsp;219,&nbsp;I,&nbsp;b).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm">
          Chiffre d’affaires de l’exercice, ramené à douze mois&nbsp;: <Amount value={euros(c.eligibility.turnoverAnnualCents)} />{' '}
          <StatusBadge tone={turnoverOk ? 'success' : 'neutral'}>{turnoverOk ? 'Sous le seuil' : 'Au-dessus du seuil'}</StatusBadge>
        </p>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Capital entièrement libéré" htmlFor="is-capital" hint={sources.capital ?? undefined}>
            <Select value={capital} onValueChange={(v) => setCapital(v as Answer)} disabled={!canWrite}>
              <SelectTrigger id="is-capital" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Oui</SelectItem>
                <SelectItem value="no">Non</SelectItem>
                <SelectItem value="unknown">Non renseigné</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Capital détenu à 75 % par des personnes physiques" htmlFor="is-persons" hint={sources.persons ?? 'Directement, ou par des sociétés qui remplissent elles-mêmes ces conditions.'}>
            <Select value={persons} onValueChange={(v) => setPersons(v as Answer)} disabled={!canWrite}>
              <SelectTrigger id="is-persons" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Oui</SelectItem>
                <SelectItem value="no">Non</SelectItem>
                <SelectItem value="unknown">Non renseigné</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Déficits reportables au début de l’exercice"
            htmlFor="is-deficits"
            hint={
              view.deficits.openingTypedCents === null && c.deficits.known
                ? `Repris des exercices précédents : ${formatEuros(c.deficits.openingCents)}. Laissez vide pour garder ce report.`
                : 'D’après la dernière déclaration (2033-B ligne 370, tableau 2058-B). 0 s’il n’y en a pas.'
            }
          >
            <AmountInput id="is-deficits" value={deficits} onValueChange={setDeficits} disabled={!canWrite} />
          </Field>
          {canWrite ? (
            <div className="flex items-end">
              <Button type="submit" loading={saving}>
                Enregistrer
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  )
}

const formatEuros = (cents: number) => `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

function ManualLinesCard({ companyId, view, canWrite, onSaved }: { companyId: string; view: CorporateTaxView; canWrite: boolean; onSaved: () => void }) {
  const fy = view.fiscalYear
  const [kind, setKind] = React.useState<ManualKind>('reintegration')
  const [label, setLabel] = React.useState('')
  const [amount, setAmount] = React.useState<number | null>(null)
  const { saving, save } = useSave(companyId, fy?.id ?? '', onSaved)
  if (!fy) return null
  const lines = view.manualLines

  const add = (event: React.FormEvent) => {
    event.preventDefault()
    if (!label.trim() || amount === null || amount <= 0) {
      toast.error('Indiquez un libellé et un montant positif.')
      return
    }
    const line: ManualLine = { id: `l${Date.now().toString(36)}`, kind, label: label.trim(), amountCents: amount }
    void save({ manualLines: [...lines, line] }, 'Ligne ajoutée').then(() => {
      setLabel('')
      setAmount(null)
    })
  }
  const remove = (id: string) => void save({ manualLines: lines.filter((l) => l.id !== id) }, 'Ligne retirée')

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Lignes ajoutées à la main</h2>
        </CardTitle>
        <CardDescription>Ce que les comptes ne disent pas&nbsp;: dépenses somptuaires, amortissements excédentaires, provisions non déductibles, crédits d’impôt...</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {lines.length === 0 ? (
          <p className="text-muted-foreground text-sm">Aucune ligne ajoutée.</p>
        ) : (
          <ul className="divide-y">
            {lines.map((line) => (
              <li key={line.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm">{line.label}</p>
                  <p className="text-muted-foreground text-xs">{KIND_LABELS[line.kind]}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="num text-sm">
                    <Amount value={euros(line.amountCents)} />
                  </span>
                  {canWrite ? (
                    <Button variant="ghost" size="icon-sm" aria-label={`Retirer ${line.label}`} title="Retirer" onClick={() => remove(line.id)} disabled={saving}>
                      <Trash2 aria-hidden />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-[10rem_1fr_10rem_auto] sm:items-end">
            <Field label="Nature" htmlFor="is-line-kind">
              <Select value={kind} onValueChange={(v) => setKind(v as ManualKind)}>
                <SelectTrigger id="is-line-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_LABELS) as ManualKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Libellé" htmlFor="is-line-label">
              <Input id="is-line-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex. Dépenses de chasse (art. 39, 4)" maxLength={200} />
            </Field>
            <Field label="Montant" htmlFor="is-line-amount">
              <AmountInput id="is-line-amount" value={amount} onValueChange={setAmount} />
            </Field>
            <Button type="submit" variant="outline" loading={saving}>
              <Plus aria-hidden />
              Ajouter
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  )
}

function BalanceCard({ companyId, view, canWrite, onSaved }: { companyId: string; view: CorporateTaxView; canWrite: boolean; onSaved: () => void }) {
  const fy = view.fiscalYear
  const balance = view.balance
  const [number, setNumber] = React.useState('1')
  const [paidOn, setPaidOn] = React.useState(view.today)
  const [amount, setAmount] = React.useState<number | null>(null)
  const { saving, save } = useSave(companyId, fy?.id ?? '', onSaved)
  if (!fy || !balance) return null
  const paid = balance.acomptesPaid

  const add = (event: React.FormEvent) => {
    event.preventDefault()
    if (amount === null || amount < 0) {
      toast.error('Indiquez le montant versé.')
      return
    }
    const entry: AcomptePaid = { number: Number(number), paidOn, amountCents: amount }
    void save({ acomptesPaid: [...paid.filter((p) => p.number !== entry.number), entry] }, 'Acompte enregistré').then(() => setAmount(null))
  }
  const remove = (n: number) => void save({ acomptesPaid: paid.filter((p) => p.number !== n) }, 'Acompte retiré')

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Relevé de solde (2572-SD)</h2>
        </CardTitle>
        <CardDescription>
          L’impôt de l’exercice, moins les acomptes versés pour lui, se paie avec le relevé de solde
          {balance.deadline ? (
            <>
              {' '}au plus tard le <DateDisplay value={balance.deadline.date} format="long" />
            </>
          ) : null}
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground text-xs">Acomptes versés</dt>
            <dd className="num">
              <Amount value={euros(balance.paidCents)} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Débits du compte 444</dt>
            <dd className="num">
              <Amount value={euros(balance.acomptesBookedCents)} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{balance.balanceCents >= 0 ? 'Solde à payer' : 'Excédent à demander en remboursement'}</dt>
            <dd className="num font-medium">
              <Amount value={euros(Math.abs(balance.balanceCents))} />
            </dd>
          </div>
        </dl>
        {paid.length > 0 ? (
          <ul className="divide-y">
            {paid.map((p) => (
              <li key={p.number} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  Acompte n°&nbsp;{p.number}, payé le <DateDisplay value={p.paidOn} />
                </span>
                <span className="flex items-center gap-2">
                  <Amount value={euros(p.amountCents)} />
                  {canWrite ? (
                    <Button variant="ghost" size="icon-sm" aria-label={`Retirer l’acompte n° ${p.number}`} title="Retirer" onClick={() => remove(p.number)} disabled={saving}>
                      <Trash2 aria-hidden />
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {canWrite ? (
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-[8rem_1fr_1fr_auto] sm:items-end">
            <Field label="Acompte" htmlFor="is-paid-number">
              <Select value={number} onValueChange={setNumber}>
                <SelectTrigger id="is-paid-number" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      N° {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Payé le" htmlFor="is-paid-on">
              <DateInput id="is-paid-on" value={paidOn} onValueChange={setPaidOn} />
            </Field>
            <Field label="Montant versé" htmlFor="is-paid-amount">
              <AmountInput id="is-paid-amount" value={amount} onValueChange={setAmount} />
            </Field>
            <Button type="submit" variant="outline" loading={saving}>
              Enregistrer l’acompte
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  )
}

function AcomptesCard({ companyId, view, canWrite, onDone }: { companyId: string; view: CorporateTaxView; canWrite: boolean; onDone: () => void }) {
  const { busy, prepare } = usePrepare(companyId, onDone)
  const schedule = view.acomptes
  const fy = view.fiscalYear
  if (!schedule || !fy) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Acomptes de l’exercice {schedule.exercice.year} (2571-SD)</h2>
        </CardTitle>
        <CardDescription>
          Calculés sur l’impôt de cet exercice ramené à douze mois (<Amount value={euros(schedule.referenceTaxCents)} />)&nbsp;: un quart à chaque échéance, aucun acompte si cet impôt ne dépasse pas 3&nbsp;000&nbsp;€ (CGI, art.&nbsp;1668).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {schedule.items.length === 0 ? (
          <p className="text-muted-foreground text-sm">Aucune échéance d’acompte pour cet exercice.</p>
        ) : (
          <ul className="divide-y">
            {schedule.items.map((item, index) => (
              <li key={item.number} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">
                    Acompte n°&nbsp;{item.number}, le <DateDisplay value={item.date} format="long" />
                  </p>
                  <p className="text-muted-foreground text-xs">{item.note}</p>
                  <p className="text-xs">
                    Écriture de paiement&nbsp;: <DraftLink companyId={companyId} state={schedule.drafts[index]} />
                  </p>
                </div>
                <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                  <span className="num text-sm font-medium">{item.amountCents === null ? 'À calculer' : <Amount value={euros(item.amountCents)} />}</span>
                  {canWrite && schedule.exercice.exists && (item.amountCents ?? 0) > 0 && schedule.drafts[index]?.status !== 'validated' ? (
                    <Button size="xs" variant="outline" loading={busy === `acompte-${item.number}`} onClick={() => prepare(`acompte-${item.number}`, { kind: 'acompte', fiscalYearId: fy.id, number: item.number })}>
                      <FilePlus2 aria-hidden />
                      Préparer le paiement
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {!schedule.exercice.exists ? <p className="text-muted-foreground mt-2 text-xs">Créez l’exercice {schedule.exercice.year} pour préparer les écritures de paiement.</p> : null}
      </CardContent>
    </Card>
  )
}

function ChargeCard({ companyId, view, canWrite, onDone }: { companyId: string; view: CorporateTaxView; canWrite: boolean; onDone: () => void }) {
  const { busy, prepare } = usePrepare(companyId, onDone)
  const fy = view.fiscalYear
  const c = view.computation
  if (!fy || !c) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Charge d’impôt de l’exercice</h2>
        </CardTitle>
        <CardDescription>
          Au dernier jour de l’exercice, l’impôt et la contribution sociale (<Amount value={euros(c.corporateTaxCents + c.socialContribution.cents)} />) au débit du 695 et au crédit du 444. Kledg la prépare en brouillon&nbsp;; les crédits d’impôt se comptabilisent à part.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <DraftLink companyId={companyId} state={view.charge} />
        {canWrite && view.charge.status !== 'validated' && !fy.isClosed ? (
          <Button size="sm" variant="outline" loading={busy === 'charge'} onClick={() => prepare('charge', { kind: 'charge', fiscalYearId: fy.id })}>
            <FilePlus2 aria-hidden />
            {view.charge.status === 'draft' ? 'Mettre à jour le brouillon' : 'Préparer l’écriture'}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

function FilingCard({ companyId, view, canWrite, onSaved }: { companyId: string; view: CorporateTaxView; canWrite: boolean; onSaved: () => void }) {
  const c = view.computation
  const fy = view.fiscalYear
  const [filedOn, setFiledOn] = React.useState(view.today)
  const [result, setResult] = React.useState<number | null>(c?.resultBeforeDeficitsCents ?? 0)
  const [imputed, setImputed] = React.useState<number | null>(c?.deficits.imputedCents ?? 0)
  const [tax, setTax] = React.useState<number | null>(c?.corporateTaxCents ?? 0)
  const [reduced, setReduced] = React.useState<Answer>(c?.reducedRate.applied ? 'yes' : 'no')
  const [saving, setSaving] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  if (!fy || !c) return null
  const url = `/api/companies/${encodeURIComponent(companyId)}/corporate-tax/filing`

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await sendJson(
        url,
        'PUT',
        { fiscalYearId: fy.id, filedOn, resultBeforeDeficitsCents: result ?? 0, deficitsImputedCents: imputed ?? 0, corporateTaxCents: tax ?? 0, reducedRate: reduced === 'yes' },
        'Le dépôt n’a pas été enregistré. Réessayez dans un instant.',
      )
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
      await sendJson(`${url}?fiscalYearId=${encodeURIComponent(fy.id)}`, 'DELETE', undefined, 'Le dépôt n’a pas été retiré. Réessayez dans un instant.')
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
          Kledg ne dépose pas la déclaration. Une fois la 2065-SD déposée, indiquez ce qui a été déclaré&nbsp;: l’exercice suivant en tire ses acomptes et ses déficits reportables.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {view.filing ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              Déposée le <DateDisplay value={view.filing.filedOn} format="long" />, résultat fiscal avant déficits <Amount value={euros(view.filing.resultBeforeDeficitsCents)} />, impôt{' '}
              <Amount value={euros(view.filing.corporateTaxCents)} />
              {view.filing.reducedRate ? ', taux réduit appliqué' : ''}.
            </p>
            {canWrite ? (
              <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
                Retirer le dépôt
              </Button>
            ) : null}
          </div>
        ) : canWrite && fy.endDate < view.today ? (
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            <Field label="Date de dépôt" htmlFor="is-filed-on" required>
              <DateInput id="is-filed-on" value={filedOn} onValueChange={setFiledOn} />
            </Field>
            <Field label="Résultat fiscal avant déficits" htmlFor="is-filed-result" hint="Négatif pour un déficit (2033-B 352 ou 354, 2058-A XI ou XJ)">
              <AmountInput id="is-filed-result" value={result} onValueChange={setResult} allowNegative />
            </Field>
            <Field label="Déficits imputés" htmlFor="is-filed-imputed" hint="2033-B 360, 2058-A XL">
              <AmountInput id="is-filed-imputed" value={imputed} onValueChange={setImputed} />
            </Field>
            <Field label="Impôt sur les sociétés" htmlFor="is-filed-tax" hint="Aux taux de 15 % et 25 %, avant crédits d’impôt">
              <AmountInput id="is-filed-tax" value={tax} onValueChange={setTax} />
            </Field>
            <Field label="Taux réduit appliqué" htmlFor="is-filed-reduced">
              <Select value={reduced} onValueChange={(v) => setReduced(v as Answer)}>
                <SelectTrigger id="is-filed-reduced" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Oui</SelectItem>
                  <SelectItem value="no">Non</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="flex items-end">
              <Button type="submit" loading={saving}>
                Enregistrer le dépôt
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-muted-foreground text-sm">
            {fy.endDate < view.today ? 'Pas encore de dépôt enregistré pour cet exercice.' : 'La déclaration se dépose après la clôture de l’exercice.'}
          </p>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Retirer le dépôt de l’exercice ${fy.year} ?`}
        description="Kledg oublie la date et les montants déclarés. La déclaration reste déposée sur impots.gouv.fr."
        confirmLabel="Retirer"
        loading={saving}
        onConfirm={remove}
      />
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
 * Impôt sur les sociétés (docs/impot-societes.md): the tax result of a
 * fiscal year from its validated entries, the IS at 15 % and 25 %, the
 * deficits, the balance and the acomptes of the next year, the draft
 * entries and the record of the filing. Kledg prepares; the user files on
 * impots.gouv.fr.
 */
export function CorporateTaxPage({ companyId }: { companyId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { can } = useCompanyAccess()
  const canWrite = can({ entries: ['create'] })
  const canExport = can({ reports: ['export'] })
  const fiscalYearId = searchParams?.get('exercice') ?? ''
  const deadline = searchParams?.get('echeance') ?? ''
  const query = new URLSearchParams(fiscalYearId ? { fiscalYearId } : deadline ? { deadline } : {})
  const base = `/api/companies/${encodeURIComponent(companyId)}/corporate-tax`
  const { data, error, loading, reload } = useJson<CorporateTaxView>(`${base}${query.size ? `?${query}` : ''}`, LOAD_ERROR)

  const chooseYear = (id: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('exercice', id)
    params.delete('echeance')
    router.replace(`${pathname}?${params.toString()}`)
  }

  const view = data && (!fiscalYearId || data.fiscalYear?.id === fiscalYearId) ? data : null
  const c = view?.computation
  const fy = view?.fiscalYear
  const exportUrl = (format: 'pdf' | 'csv') => `${base}/export?${new URLSearchParams({ ...(fy ? { fiscalYearId: fy.id } : {}), format })}`
  const key = `${fy?.id ?? ''}:${data ? JSON.stringify([data.answers, data.deficits.openingTypedCents, data.filing]) : ''}`

  return (
    <div className="space-y-6">
      <PageHeader
        title="Impôt sur les sociétés"
        description="Kledg prépare le résultat fiscal, l’impôt, les acomptes et le solde de chaque exercice à partir des écritures validées. Vous vérifiez, puis vous déclarez et payez sur impots.gouv.fr."
        docsHref={docsUrl('fiscalYear')}
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
        <EmptyState bordered title="L’impôt ne s’est pas chargé" description={error} action={<Button size="sm" onClick={reload}>Réessayer</Button>} />
      ) : !view || loading ? (
        <PageSkeleton />
      ) : view.status === 'no-fiscal-year' ? (
        <EmptyState
          bordered
          icon={CalendarClock}
          title="Aucun exercice"
          description="L’impôt sur les sociétés se calcule par exercice. Créez le premier exercice de la société pour le préparer."
          action={
            <Button asChild size="sm">
              <Link href={`/${companyId}/fiscal-years`}>Créer un exercice</Link>
            </Button>
          }
        />
      ) : view.status === 'not-subject' ? (
        <EmptyState
          bordered
          icon={Scale}
          title="Pas d’impôt sur les sociétés à calculer"
          description="La société relève de l’impôt sur le revenu (entreprise individuelle, SCI, SNC... sans option pour l’impôt sur les sociétés) : son bénéfice est imposé chez ses associés, il n’y a rien à calculer ici. Si elle a opté pour l’impôt sur les sociétés, indiquez son régime dans les informations de la société."
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
          title="Régime d’impôt sur les sociétés non renseigné"
          description="Kledg choisit les formulaires (2033 au régime simplifié, 2050 au réel normal) d’après le régime d’imposition des bénéfices. Renseignez-le pour préparer l’impôt."
          action={
            <Button asChild size="sm">
              <Link href={`/${companyId}/informations#regimes-fiscaux`}>Renseigner le régime</Link>
            </Button>
          }
        />
      ) : !fy || !c ? null : (
        <React.Fragment key={key}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full space-y-2 sm:w-72">
              <Label htmlFor="is-year">Exercice</Label>
              <Select value={fy.id} onValueChange={chooseYear}>
                <SelectTrigger id="is-year" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {view.fiscalYears.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      Exercice {y.year}
                      {y.filed ? ', déposé' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-muted-foreground text-sm">
              Du {formatDisplayDate(fy.startDate)} au {formatDisplayDate(fy.endDate)}. {view.formTitle}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label={view.reliable && fy.endDate < view.today ? 'Impôt de l’exercice' : 'Impôt de l’exercice estimé'}
              value={<Amount value={euros(c.totalCents)} />}
              hint={c.reducedRate.applied ? 'Taux réduit de 15 % puis 25 %' : c.ifEligibleCents !== null ? `${formatEuros(c.ifEligibleCents)} avec le taux réduit, si ses conditions sont remplies` : 'Taux normal de 25 %'}
            />
            <StatCard
              label={view.balance && view.balance.balanceCents < 0 ? 'Excédent d’acomptes' : 'Solde à payer'}
              value={<Amount value={euros(Math.abs(view.balance?.balanceCents ?? 0))} />}
              hint={view.balance?.deadline ? `Au plus tard le ${formatDisplayDate(view.balance.deadline.date)}, relevé 2572-SD` : undefined}
            />
            <StatCard
              label="Préparation"
              value={<StatusBadge tone={view.reliable ? 'success' : 'danger'}>{view.reliable ? 'Chiffres complets' : 'À corriger'}</StatusBadge>}
              hint={view.liasse ? `Déclaration de résultat au plus tard le ${formatDisplayDate(view.liasse.date)}${view.filing ? ', déposée' : ''}` : undefined}
            />
          </div>

          <Alert role="note">
            <Info aria-hidden />
            <AlertTitle>Kledg prépare, vous déclarez</AlertTitle>
            <AlertDescription>
              <p>
                Kledg ne dépose rien et ne paie rien&nbsp;: reportez le résultat fiscal sur la 2065-SD et son tableau, puis payez les acomptes et le solde dans votre espace professionnel sur{' '}
                <a href="https://www.impots.gouv.fr/professionnel" target="_blank" rel="noreferrer" className="text-link underline-offset-4 hover:underline">
                  impots.gouv.fr
                </a>
                . Les montants des formulaires sont arrondis à l’euro.
              </p>
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Contrôles</h2>
              </CardTitle>
              <CardDescription>Ce qu’il faut corriger ou vérifier avant de déclarer.</CardDescription>
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
                          <ArrowUpRight aria-hidden className="size-3.5" />
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
                <h2>Résultat fiscal</h2>
              </CardTitle>
              <CardDescription>
                Du résultat comptable au résultat fiscal, avec la ligne du tableau {view.regime === 'simplified' ? '2033-B-SD' : '2058-A-SD'}. Seules les réintégrations certaines sont lues dans les comptes&nbsp;; le reste s’ajoute à la main.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <WorksheetTable lines={c.lines} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Calcul de l’impôt</h2>
              </CardTitle>
              <CardDescription>Taux réduit de 15&nbsp;% jusqu’à {formatEuros(c.reducedRate.ceilingCents)} pour cet exercice, taux normal de 25&nbsp;% au-delà (CGI, art.&nbsp;219,&nbsp;I).</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell className="whitespace-normal">Taux réduit de 15&nbsp;% sur <Amount value={euros(c.reducedRate.baseCents)} /></TableCell>
                    <TableCell numeric>
                      <Amount value={euros(c.reducedRate.taxCents)} />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="whitespace-normal">Taux normal de 25&nbsp;% sur <Amount value={euros(c.normalRate.baseCents)} /></TableCell>
                    <TableCell numeric>
                      <Amount value={euros(c.normalRate.taxCents)} />
                    </TableCell>
                  </TableRow>
                  <TableRow className="font-medium">
                    <TableCell>Impôt sur les sociétés</TableCell>
                    <TableCell numeric>
                      <Amount value={euros(c.corporateTaxCents)} />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="whitespace-normal">
                      {c.socialContribution.exempt ? 'Contribution sociale de 3,3 % : exonérée' : 'Contribution sociale de 3,3 % sur l’impôt au-delà de 763 000 € (CGI, art. 235 ter ZC)'}
                    </TableCell>
                    <TableCell numeric>
                      <Amount value={euros(c.socialContribution.cents)} />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Moins&nbsp;: crédits d’impôt</TableCell>
                    <TableCell numeric>
                      <Amount value={euros(c.creditsCents)} />
                    </TableCell>
                  </TableRow>
                  <TableRow className="font-medium">
                    <TableCell>Impôt de l’exercice</TableCell>
                    <TableCell numeric>
                      <Amount value={euros(c.totalCents)} />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <QuestionsCard companyId={companyId} view={view} canWrite={canWrite} onSaved={reload} />

          {view.deficits.history.length > 1 || c.deficits.closingCents > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Historique des déficits</h2>
                </CardTitle>
                <CardDescription>D’après les dépôts enregistrés et cet exercice. Imputation limitée à 1&nbsp;000&nbsp;000&nbsp;€, majorés de 50&nbsp;% du bénéfice au-delà (CGI, art.&nbsp;209,&nbsp;I).</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Exercice</TableHead>
                      <TableHead numeric>Au début</TableHead>
                      <TableHead numeric>Imputés</TableHead>
                      <TableHead numeric>Créés</TableHead>
                      <TableHead numeric>À reporter</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view.deficits.history.map((h) => (
                      <TableRow key={h.fiscalYearId}>
                        <TableCell>
                          {h.year}
                          {h.basis === 'unknown' ? <span className="text-muted-foreground text-xs"> (dépôt non enregistré)</span> : null}
                        </TableCell>
                        {[h.openingCents, h.imputedCents, h.createdCents, h.closingCents].map((v, i) => (
                          <TableCell key={i} numeric>
                            {v === null ? <span className="text-muted-foreground">?</span> : <Amount value={euros(v)} />}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          <ManualLinesCard companyId={companyId} view={view} canWrite={canWrite} onSaved={reload} />

          <div className="grid gap-4 lg:grid-cols-2">
            <BalanceCard companyId={companyId} view={view} canWrite={canWrite} onSaved={reload} />
            <AcomptesCard companyId={companyId} view={view} canWrite={canWrite} onDone={reload} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChargeCard companyId={companyId} view={view} canWrite={canWrite} onDone={reload} />
            <FilingCard companyId={companyId} view={view} canWrite={canWrite} onSaved={reload} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Ce que Kledg ne peut pas savoir</h2>
              </CardTitle>
              <CardDescription>À vérifier et, le cas échéant, à ajouter à la main.</CardDescription>
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
        </React.Fragment>
      )}
    </div>
  )
}
