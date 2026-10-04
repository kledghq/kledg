'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, RotateCw, Target, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Amount, EmptyState, PageHeader, StatCard, formatDisplayDate, useConfirm } from '@/components/shared'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { responseError } from '@/hooks/use-cursor-list'
import { SIDE_LABELS, type BudgetSide } from '@/lib/budgets/prefixes'
import { FREQUENCY_LABELS } from '@/lib/budgets/recurring'
import type { BudgetDetail, BudgetLineView, BudgetSummary } from '@/lib/budgets/manage-budgets.service'
import type { BudgetReport } from '@/lib/budgets/get-budget-report.service'
import { BudgetComparison } from './budget-comparison'
import { BudgetLineSheet } from './budget-line-sheet'

const monthLabel = (month: string) => formatDisplayDate(`${month}-01`, 'month')

async function load<T>(url: string, fallback: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(await responseError(response, fallback))
  return response.json() as Promise<T>
}

function LinesTable({ lines, side, editable, onEdit, onDelete }: { lines: BudgetLineView[]; side: BudgetSide; editable: boolean; onEdit: (line: BudgetLineView) => void; onDelete: (line: BudgetLineView) => void }) {
  const rows = lines.filter((l) => l.side === side)
  const total = rows.reduce((sum, l) => sum + l.annualCents, 0)
  const actions = (line: BudgetLineView) =>
    editable ? (
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="icon-sm" aria-label={`Modifier la ligne ${line.accountPrefix}`} title="Modifier" onClick={() => onEdit(line)}>
          <Pencil aria-hidden />
        </Button>
        <Button variant="ghost" size="icon-sm" className="hover:text-destructive" aria-label={`Supprimer la ligne ${line.accountPrefix}`} title="Supprimer" onClick={() => onDelete(line)}>
          <Trash2 aria-hidden />
        </Button>
      </div>
    ) : null
  const detail = (line: BudgetLineView) =>
    line.recurringItems.length > 0
      ? line.recurringItems.map((item) => `${item.label} (${FREQUENCY_LABELS[item.frequency].toLowerCase()})`).join(', ')
      : null

  return (
    <section className="space-y-2" aria-label={SIDE_LABELS[side]}>
      <h3 className="text-sm font-medium">{SIDE_LABELS[side]}</h3>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Aucune ligne de {side === 'charges' ? 'charges (classe 6)' : 'produits (classe 7)'}.
        </p>
      ) : (
        <>
          <ul className="divide-y rounded-md border lg:hidden">
            {rows.map((line) => (
              <li key={line.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate text-sm">{line.label}</p>
                  <p className="text-muted-foreground font-mono text-xs">{line.accountPrefix}</p>
                  {detail(line) ? <p className="text-muted-foreground text-xs">{detail(line)}</p> : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Amount value={line.annualCents / 100} className="text-sm font-semibold" />
                  {actions(line)}
                </div>
              </li>
            ))}
            <li className="bg-muted/50 flex justify-between px-3 py-2.5 text-sm font-semibold">
              <span>Total</span>
              <Amount value={total / 100} />
            </li>
          </ul>
          <div className="hidden rounded-md border lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Compte</TableHead>
                  <TableHead>Libellé</TableHead>
                  <TableHead>Récurrents</TableHead>
                  <TableHead numeric>Total de l&apos;exercice</TableHead>
                  {editable ? <TableHead className="w-24"><span className="sr-only">Actions</span></TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-mono text-xs">{line.accountPrefix}</TableCell>
                    <TableCell className="max-w-72">
                      <span className="block truncate">{line.label}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-72 text-xs">
                      <span className="block truncate">{detail(line) ?? '-'}</span>
                    </TableCell>
                    <TableCell numeric>
                      <Amount value={line.annualCents / 100} />
                    </TableCell>
                    {editable ? <TableCell>{actions(line)}</TableCell> : null}
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50 border-t-foreground border-t-2">
                  <TableCell colSpan={3} className="font-semibold">
                    Total {SIDE_LABELS[side].toLowerCase()}
                  </TableCell>
                  <TableCell numeric className="font-semibold">
                    <Amount value={total / 100} />
                  </TableCell>
                  {editable ? <TableCell /> : null}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  )
}

/**
 * Budget of a fiscal year (docs/budget.md): "Suivi" compares it with the
 * validated entries per line and per month, "Saisie" builds it. Members who
 * read the books follow it; administrators and accountants build it.
 */
export function BudgetPage({ companyId }: { companyId: string }) {
  const { can, denied } = useCompanyAccess()
  const canManage = can({ budgets: ['manage'] })
  const { confirm, dialog } = useConfirm()
  const [fiscalYearId, setFiscalYearId] = React.useState('')
  const [summaries, setSummaries] = React.useState<BudgetSummary[] | null>(null)
  const [budget, setBudget] = React.useState<BudgetDetail | null>(null)
  const [report, setReport] = React.useState<BudgetReport | null>(null)
  const [throughMonth, setThroughMonth] = React.useState('')
  const [tab, setTab] = React.useState('suivi')
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [version, setVersion] = React.useState(0)
  const [creating, setCreating] = React.useState(false)
  // `session` remounts the line editor at each opening, so its form starts from the line as saved.
  const [editor, setEditor] = React.useState<{ open: boolean; line: BudgetLineView | null; session: number }>({ open: false, line: null, session: 0 })
  const openEditor = (line: BudgetLineView | null) => setEditor((current) => ({ open: true, line, session: current.session + 1 }))

  const refresh = React.useCallback(() => setVersion((n) => n + 1), [])

  React.useEffect(() => {
    if (!companyId || !fiscalYearId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const run = async () => {
      const list = await load<{ items: BudgetSummary[] }>(`/api/budgets?${new URLSearchParams({ companyId })}`, "Les budgets ne se sont pas chargés. Réessayez dans un instant.")
      const summary = list.items.find((b) => b.fiscalYear.id === fiscalYearId) ?? null
      if (!summary) return { list: list.items, detail: null, comparison: null }
      const query = throughMonth ? `?${new URLSearchParams({ throughMonth })}` : ''
      const [detail, comparison] = await Promise.all([
        load<BudgetDetail>(`/api/budgets/${summary.id}`, "Le budget ne s'est pas chargé. Réessayez dans un instant."),
        load<BudgetReport>(`/api/budgets/${summary.id}/report${query}`, "La comparaison avec la comptabilité ne s'est pas chargée. Réessayez dans un instant."),
      ])
      return { list: list.items, detail, comparison }
    }
    run()
      .then(({ list, detail, comparison }) => {
        if (cancelled) return
        setSummaries(list)
        setBudget(detail)
        setReport(comparison)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, fiscalYearId, throughMonth, version])

  const createBudget = async (template: 'posts' | 'empty') => {
    setCreating(true)
    try {
      const response = await fetch('/api/budgets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ companyId, fiscalYearId, template }),
      })
      if (!response.ok) throw new Error(await responseError(response, "Le budget n'a pas été créé. Réessayez dans un instant."))
      toast.success('Budget créé')
      setTab('saisie')
      refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const deleteLine = async (line: BudgetLineView) => {
    const ok = await confirm({
      title: `Supprimer la ligne ${line.accountPrefix} ?`,
      description: 'Ses montants et ses éléments récurrents sont supprimés. Les comptes qu’elle couvrait passent hors budget ou sur une ligne plus courte.',
      confirmLabel: 'Supprimer',
    })
    if (!ok) return
    const response = await fetch(`/api/budget-lines/${line.id}`, { method: 'DELETE' })
    if (!response.ok) toast.error(await responseError(response, "La ligne n'a pas été supprimée. Réessayez dans un instant."))
    else {
      toast.success('Ligne supprimée')
      refresh()
    }
  }

  const deleteBudget = async () => {
    if (!budget) return
    const ok = await confirm({
      title: `Supprimer le budget ${budget.fiscalYear.year} ?`,
      description: 'Toutes ses lignes, ses montants et ses éléments récurrents sont supprimés. La comptabilité ne change pas.',
      confirmLabel: 'Supprimer',
    })
    if (!ok) return
    const response = await fetch(`/api/budgets/${budget.id}`, { method: 'DELETE' })
    if (!response.ok) toast.error(await responseError(response, "Le budget n'a pas été supprimé. Réessayez dans un instant."))
    else {
      toast.success('Budget supprimé')
      setThroughMonth('')
      refresh()
    }
  }

  const editable = Boolean(budget?.editable && canManage)
  const selectedYear = summaries?.find((b) => b.fiscalYear.id === fiscalYearId)?.fiscalYear

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budget"
        description="Prévoyez les charges et les produits de l'exercice mois par mois, puis comparez-les aux écritures validées."
        actions={
          editable ? (
            <Button variant="ghost" className="hover:text-destructive" onClick={deleteBudget}>
              <Trash2 aria-hidden />
              Supprimer le budget
            </Button>
          ) : null
        }
      />

      <Card>
        <CardContent className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="budget-fiscal-year">Exercice</Label>
            <FiscalYearSelector
              companyId={companyId}
              value={fiscalYearId}
              onValueChange={(id) => {
                setFiscalYearId(id)
                setThroughMonth('')
              }}
              showLabel={false}
              showPeriod={false}
              id="budget-fiscal-year"
            />
          </div>
          {budget ? (
            <div className="space-y-2">
              <Label htmlFor="budget-through">Comparer jusqu&apos;à</Label>
              <Select value={throughMonth || budget.months[budget.months.length - 1]} onValueChange={(m) => setThroughMonth(m === budget.months[budget.months.length - 1] ? '' : m)}>
                <SelectTrigger id="budget-through" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {budget.months.map((m, i) => (
                    <SelectItem key={m} value={m}>
                      {i === budget.months.length - 1 ? `Fin de l'exercice (${monthLabel(m)})` : `Fin ${monthLabel(m)}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3" role="alert">
            <p className="text-sm">{error}</p>
            <Button size="sm" variant="outline" onClick={refresh}>
              <RotateCw aria-hidden />
              Réessayer
            </Button>
          </CardContent>
        </Card>
      ) : loading && !budget ? (
        <div className="grid gap-4 sm:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : !budget ? (
        <EmptyState
          bordered
          icon={Target}
          title={selectedYear ? `Aucun budget pour l'exercice ${selectedYear.year}` : "Aucun budget pour cet exercice"}
          description={
            canManage
              ? 'Partez des grands postes (achats, services extérieurs, personnel, ventes...) ou d’un budget vide, puis saisissez les montants prévus chaque mois.'
              : denied('créer le budget')
          }
          action={
            canManage ? (
              <Button size="sm" onClick={() => createBudget('posts')} loading={creating}>
                <Plus aria-hidden />
                Créer le budget
              </Button>
            ) : undefined
          }
          secondaryAction={
            canManage ? (
              <Button size="sm" variant="outline" onClick={() => createBudget('empty')} disabled={creating}>
                Partir d&apos;un budget vide
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3" aria-busy={loading || undefined}>
            <StatCard label="Charges prévues" value={<Amount value={budget.chargesCents / 100} />} hint={`Exercice ${budget.fiscalYear.year}`} />
            <StatCard label="Produits prévus" value={<Amount value={budget.produitsCents / 100} />} hint={`Exercice ${budget.fiscalYear.year}`} />
            <StatCard
              label="Résultat prévu"
              value={<Amount value={budget.resultatCents / 100} />}
              valueClassName={budget.resultatCents < 0 ? 'text-destructive' : undefined}
              hint="Produits moins charges"
            />
          </div>

          {!budget.editable ? (
            <p className="text-muted-foreground text-sm" role="status">
              L&apos;exercice {budget.fiscalYear.year} est clôturé&nbsp;: son budget ne se modifie plus.
            </p>
          ) : null}

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="suivi">Suivi</TabsTrigger>
              <TabsTrigger value="saisie">Saisie</TabsTrigger>
            </TabsList>
            <TabsContent value="suivi" className="mt-4">
              {report ? <BudgetComparison report={report} /> : null}
            </TabsContent>
            <TabsContent value="saisie" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <CardTitle>Lignes du budget</CardTitle>
                    <CardDescription>
                      {budget.lineCount === 0
                        ? 'Ajoutez une ligne par compte ou groupe de comptes à suivre.'
                        : `${budget.lineCount} ligne${budget.lineCount > 1 ? 's' : ''}, montants saisis par mois et éléments récurrents.`}
                    </CardDescription>
                  </div>
                  {editable ? (
                    <Button size="sm" onClick={() => openEditor(null)}>
                      <Plus aria-hidden />
                      Ajouter une ligne
                    </Button>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-6">
                  {!canManage ? <p className="text-muted-foreground text-sm">{denied('modifier le budget')}</p> : null}
                  <LinesTable lines={budget.lines} side="charges" editable={editable} onEdit={openEditor} onDelete={deleteLine} />
                  <LinesTable lines={budget.lines} side="produits" editable={editable} onEdit={openEditor} onDelete={deleteLine} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {editable ? (
            <BudgetLineSheet
              key={editor.session}
              open={editor.open}
              onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}
              budgetId={budget.id}
              months={budget.months}
              line={editor.line}
              onSaved={refresh}
            />
          ) : null}
        </>
      )}
      {dialog}
    </div>
  )
}
