'use client'

/**
 * Bibliothèque de règles (/[companyId]/rules/library): ready-made assignment
 * rules (lib/rules-library), the ones the company's transactions suggest,
 * and the rules of the user's other companies to copy. "Ajouter" opens the
 * rule editor prefilled with the template (/rules/new?template=<id>), after
 * offering to create the accounts the chart lacks; nothing is created
 * silently.
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { BookCopy, Copy, ExternalLink, Plus, Search, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { DateDisplay, EmptyState, PageHeader, StatusBadge } from '@/components/shared'
import { plural } from '@/lib/utils/plural'
import type { RuleLibrary, TemplateView } from '@/lib/rules-library/manage-rule-templates.service'
import type { CopyRulesResult, CopySources } from '@/lib/rules-library/copy-rules.service'
import { describeCondition } from './rule-form'

type LoadState<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T }

async function readError(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: string } | null
  return data?.error || fallback
}

function useLoad<T>(url: string, errorMessage: string): [LoadState<T>, () => void] {
  const [version, setVersion] = React.useState(0)
  const key = `${url}#${version}`
  // The state of the last request answered, by its key: a new key reads as loading until it answers.
  const [answered, setAnswered] = React.useState<{ key: string; state: LoadState<T> } | null>(null)
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      let state: LoadState<T>
      try {
        const response = await fetch(url)
        if (!response.ok) throw new Error(await readError(response, errorMessage))
        state = { status: 'ready', data: (await response.json()) as T }
      } catch (error) {
        state = { status: 'error', message: error instanceof Error ? error.message : errorMessage }
      }
      if (!cancelled) setAnswered({ key, state })
    })()
    return () => {
      cancelled = true
    }
  }, [key, url, errorMessage])
  const reload = React.useCallback(() => setVersion((v) => v + 1), [])
  return [answered?.key === key ? answered.state : { status: 'loading' }, reload]
}

const LIBRARY_ERROR = 'La bibliothèque ne s’est pas chargée. Réessayez.'
const SOURCES_ERROR = 'Les règles de vos autres sociétés ne se sont pas chargées. Réessayez.'

/** VAT treatment of a template, in a few words for the card. */
export function vatTreatmentLabel(template: Pick<TemplateView, 'vat' | 'lines'>): string {
  const rate = template.lines.find((l) => l.vatType && l.vatType !== 'none')?.vatRate
  const percent = rate != null ? `${String(rate).replace('.', ',')} %` : ''
  switch (template.vat.treatment) {
    case 'standard':
      return 'TVA déductible 20 %'
    case 'reduced':
      return `TVA déductible ${percent}`
    case 'detected':
      return 'TVA détectée par la banque'
    case 'self-assessed':
      return 'TVA autoliquidée 20 %'
    case 'partial':
      return 'TVA déductible à 80 %'
    case 'not-deductible':
      return 'TVA non déductible'
    case 'none':
      return 'Sans TVA'
  }
}

/** A condition of a template or a rule as a sentence: "Sortie d'argent", "Libellé contenant OVH". */
export function conditionSentence(condition: { conditionType: string; operator: string; value: string | null; value2?: string | null; display?: string }): string {
  if (condition.display) return condition.display
  if (condition.conditionType === 'side') return condition.value === 'credit' ? 'Entrée d’argent (crédit)' : 'Sortie d’argent (débit)'
  return describeCondition({ id: '', conditionType: condition.conditionType, operator: condition.operator, value: condition.value ?? '', value2: condition.value2 ?? '' }) ?? condition.conditionType
}

function lineSentence(line: TemplateView['lines'][number], account: TemplateView['accounts'][number] | undefined): string {
  const side = line.lineType === 'debit' ? 'Débit' : 'Crédit'
  const where = account?.mappedCode ? `${account.mappedCode} ${account.mappedLabel ?? ''}`.trim() : `${line.accountCode} (à choisir)`
  const amount = line.amountType === 'percentage' ? ` (${line.amountValue} % du montant)` : line.amountType === 'remaining' ? ' (le reste)' : ''
  return `${side} ${where}${amount}`
}

function TemplateCard({ template, onAdd }: { template: TemplateView; onAdd: (template: TemplateView) => void }) {
  const installed = template.status.installed
  const near = template.status.nearDuplicates
  return (
    <Card className="gap-4">
      <CardHeader className="gap-1.5">
        <CardTitle className="flex flex-wrap items-center gap-2">
          {template.name}
          {installed ? (
            <StatusBadge tone="success" title={`Règle « ${installed.ruleName} »`}>
              Déjà ajoutée
            </StatusBadge>
          ) : near.length > 0 ? (
            <StatusBadge tone="warning" title={near.map((r) => r.ruleName).join(', ')}>
              Règle proche
            </StatusBadge>
          ) : null}
        </CardTitle>
        <CardDescription>{template.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">Reconnaît</p>
          <ul className="list-inside list-disc">
            {template.conditions.map((c, i) => (
              <li key={i}>{conditionSentence(c)}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Écriture</p>
          <ul className="list-inside list-disc">
            {template.lines.map((line, i) => (
              <li key={i}>{lineSentence(line, template.accounts.find((a) => a.code === line.accountCode))}</li>
            ))}
            <li>Contrepartie en banque</li>
          </ul>
        </div>
        <div>
          <p className="font-medium">{vatTreatmentLabel(template)}</p>
          <p className="text-muted-foreground text-xs">{template.vat.why}</p>
          {template.sources.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-xs">
              {template.sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-link inline-flex items-center gap-1 hover:underline">
                    {source.label}
                    <ExternalLink aria-hidden className="size-3.5" />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {near.length > 0 && !installed ? (
          <p className="text-xs">
            Vos règles {near.map((r) => `« ${r.ruleName} »`).join(', ')} reconnaissent déjà des libellés semblables&nbsp;: vérifiez-les avant d’ajouter ce modèle.
          </p>
        ) : null}
        {template.missingAccounts.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            {template.missingAccounts.length > 1 ? 'Comptes absents du plan' : 'Compte absent du plan'}&nbsp;: {template.missingAccounts.map((a) => `${a.code} ${a.label}`).join(', ')}.
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="mt-auto">
        <Button size="sm" variant={installed ? 'outline' : 'default'} onClick={() => onAdd(template)} aria-label={`Ajouter le modèle ${template.name}`}>
          <Plus aria-hidden />
          {installed ? 'Ajouter quand même' : 'Ajouter'}
        </Button>
      </CardFooter>
    </Card>
  )
}

function AddTemplateDialog({
  template,
  companyId,
  onClose,
}: {
  template: TemplateView | null
  companyId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [creating, setCreating] = React.useState(false)
  const open = (id: string) => {
    onClose()
    setCreating(false)
    router.push(`/${companyId}/rules/new?template=${encodeURIComponent(id)}`)
  }

  const createAndOpen = async () => {
    if (!template) return
    setCreating(true)
    try {
      const response = await fetch(`/api/rule-templates/${encodeURIComponent(template.id)}/accounts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ companyId }),
      })
      if (!response.ok) throw new Error(await readError(response, 'Les comptes n’ont pas été créés. Réessayez.'))
      const { created } = (await response.json()) as { created: string[] }
      if (created.length > 0) toast.success(`${plural(created.length, 'compte créé', 'comptes créés')} : ${created.join(', ')}`)
      open(template.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Les comptes n’ont pas été créés. Réessayez.')
      setCreating(false)
    }
  }

  return (
    <Dialog open={!!template} onOpenChange={(next) => !next && !creating && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Créer les comptes de la règle&nbsp;?</DialogTitle>
          <DialogDescription>
            Le modèle « {template?.name} » utilise des comptes absents du plan de l’exercice ouvert. Kledg peut les créer, chacun sous le compte qu’il
            subdivise. Sinon, la règle s’ouvre avec le compte parent quand il existe, ou un compte à choisir.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-inside list-disc text-sm">
          {template?.missingAccounts.map((a) => (
            <li key={a.code}>
              <span className="font-mono">{a.code}</span> {a.label}, sous <span className="font-mono">{a.parentCode}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={creating}>
            Annuler
          </Button>
          <Button variant="outline" onClick={() => template && open(template.id)} disabled={creating}>
            Continuer sans créer
          </Button>
          <Button onClick={() => void createAndOpen()} loading={creating}>
            Créer et continuer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CopySection({ companyId, onCopied }: { companyId: string; onCopied: () => void }) {
  const [state, reload] = useLoad<CopySources>(`/api/transaction-rules/copy?companyId=${encodeURIComponent(companyId)}`, SOURCES_ERROR)
  const [sourceId, setSourceId] = React.useState<string>('')
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [createAccounts, setCreateAccounts] = React.useState(true)
  const [enable, setEnable] = React.useState(false)
  const [copying, setCopying] = React.useState(false)

  const companies = state.status === 'ready' ? state.data.companies : []
  const source = companies.find((c) => c.id === sourceId) ?? companies[0]

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const copyRules = async () => {
    if (!source || selected.size === 0) return
    setCopying(true)
    try {
      const response = await fetch('/api/transaction-rules/copy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ companyId, sourceCompanyId: source.id, ruleIds: [...selected], createMissingAccounts: createAccounts, enabled: enable }),
      })
      if (!response.ok) throw new Error(await readError(response, 'Les règles n’ont pas été copiées. Réessayez.'))
      const result = (await response.json()) as CopyRulesResult
      if (result.copied.length > 0) {
        toast.success(`${plural(result.copied.length, 'règle copiée', 'règles copiées')}${enable ? '' : ', inactives'}`, {
          description: result.createdAccounts.length > 0 ? `Comptes créés : ${result.createdAccounts.join(', ')}` : undefined,
        })
      }
      for (const skipped of result.skipped) toast.warning(`« ${skipped.name} » n’a pas été copiée`, { description: skipped.reason })
      setSelected(new Set())
      reload()
      onCopied()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Les règles n’ont pas été copiées. Réessayez.')
    } finally {
      setCopying(false)
    }
  }

  return (
    <section aria-labelledby="copy-rules" className="space-y-3">
      <div>
        <h2 id="copy-rules" className="text-base font-semibold">
          Copier depuis une autre société
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm">
          Les règles de vos autres sociétés, quand votre rôle vous permet de les lire. Les comptes sont adaptés au plan de cette société&nbsp;; les règles
          déjà présentes (même nom ou mêmes conditions) ne sont pas copiées.
        </p>
      </div>
      {state.status === 'loading' ? (
        <Skeleton className="h-32 w-full" aria-busy="true" />
      ) : state.status === 'error' ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-sm">{state.message}</p>
          <Button size="sm" variant="outline" onClick={reload}>
            Réessayer
          </Button>
        </div>
      ) : !source ? (
        <EmptyState
          bordered
          icon={BookCopy}
          title="Aucune règle à copier"
          description={
            state.data.unreadable > 0
              ? 'Votre rôle ne vous permet pas de lire les règles de vos autres sociétés.'
              : 'Vos autres sociétés n’ont pas de règle d’affectation, ou vous n’êtes membre d’aucune autre société.'
          }
        />
      ) : (
        <Card>
          <CardContent className="space-y-4">
            <Select
              value={source.id}
              onValueChange={(id) => {
                setSourceId(id)
                setSelected(new Set())
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-72" aria-label="Société source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({plural(c.rules.length, 'règle')})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ul className="divide-y rounded-lg border">
              {source.rules.map((rule) => {
                const id = `copy-${rule.id}`
                const present = rule.status.installed
                return (
                  <li key={rule.id} className="flex items-start gap-3 px-3 py-2.5">
                    <Checkbox id={id} checked={selected.has(rule.id)} disabled={!!present} onCheckedChange={(c) => toggle(rule.id, c === true)} className="mt-0.5" />
                    <div className="min-w-0 flex-1 text-sm">
                      <Label htmlFor={id} className="font-medium">
                        {rule.name}
                      </Label>
                      <p className="text-muted-foreground text-xs break-words">
                        {rule.conditions.map((c) => conditionSentence(c)).join(', ')}
                        {rule.entryLines.length > 0 ? `, ${rule.entryLines.map((l) => l.accountCode).join(', ')}` : ''}
                      </p>
                    </div>
                    {present ? (
                      <StatusBadge tone="neutral" title={`Règle « ${present.ruleName} »`}>
                        Déjà présente
                      </StatusBadge>
                    ) : rule.status.nearDuplicates.length > 0 ? (
                      <StatusBadge tone="warning" title={rule.status.nearDuplicates.map((r) => r.ruleName).join(', ')}>
                        Règle proche
                      </StatusBadge>
                    ) : null}
                  </li>
                )
              })}
            </ul>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center gap-2">
                <Checkbox id="copy-create-accounts" checked={createAccounts} onCheckedChange={(c) => setCreateAccounts(c === true)} />
                <Label htmlFor="copy-create-accounts">Créer les comptes absents du plan de cette société</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="copy-enable" checked={enable} onCheckedChange={(c) => setEnable(c === true)} />
                <Label htmlFor="copy-enable">Activer les règles copiées (sinon, elles restent inactives pour que vous vérifiiez leurs comptes)</Label>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button size="sm" onClick={() => void copyRules()} disabled={selected.size === 0} loading={copying}>
              <Copy aria-hidden />
              {selected.size > 0 ? `Copier ${plural(selected.size, 'règle')}` : 'Copier'}
            </Button>
          </CardFooter>
        </Card>
      )}
    </section>
  )
}

export function RuleLibraryPage({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [state, reload] = useLoad<RuleLibrary>(`/api/rule-templates?companyId=${encodeURIComponent(companyId)}`, LIBRARY_ERROR)
  const [search, setSearch] = React.useState('')
  const [category, setCategory] = React.useState('all')
  const [pending, setPending] = React.useState<TemplateView | null>(null)

  const add = (template: TemplateView) => {
    if (template.missingAccounts.length > 0) setPending(template)
    else router.push(`/${companyId}/rules/new?template=${encodeURIComponent(template.id)}`)
  }

  const library = state.status === 'ready' ? state.data : null
  const words = search.trim().toLowerCase()
  const visible = (library?.templates ?? []).filter(
    (t) => (category === 'all' || t.category === category) && (!words || `${t.name} ${t.description} ${t.categoryLabel}`.toLowerCase().includes(words)),
  )
  const byId = new Map((library?.templates ?? []).map((t) => [t.id, t]))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bibliothèque de règles"
        description="Des règles d’affectation prêtes à l’emploi pour les fournisseurs et paiements courants, avec la TVA qui convient et ses sources. Ajoutez-en une&nbsp;: elle s’ouvre dans l’éditeur, avec les comptes de votre plan."
      />

      {state.status === 'error' ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-sm">{state.message}</p>
          <Button size="sm" variant="outline" onClick={reload}>
            Réessayer
          </Button>
        </div>
      ) : !library ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-28 w-full" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      ) : (
        <>
          <section aria-labelledby="suggested-rules" className="space-y-3">
            <div>
              <h2 id="suggested-rules" className="flex items-center gap-2 text-base font-semibold">
                <Sparkles aria-hidden className="size-4" />
                Suggérées pour vous
              </h2>
              <p className="text-muted-foreground text-sm">
                D’après {plural(library.analysis.analyzed, 'transaction')} depuis le <DateDisplay value={library.analysis.since} />, dont{' '}
                {plural(library.analysis.covered, 'déjà reconnue', 'déjà reconnues')} par vos règles
                {library.analysis.truncated ? ' (les plus récentes seulement)' : ''}.
              </p>
            </div>
            {library.suggestions.length === 0 ? (
              <p className="text-sm">
                Aucune suggestion&nbsp;: vos transactions récentes sont déjà reconnues par vos règles, ou ne ressemblent à aucun modèle.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {library.suggestions.map((s) => {
                  const template = byId.get(s.templateId)
                  return (
                    <li key={s.templateId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{s.name}</p>
                        <p className="text-muted-foreground text-xs break-words">
                          <span className="num">{plural(s.matchCount, 'transaction reconnue', 'transactions reconnues')}</span>
                          {s.example ? `, par exemple « ${s.example} »` : ''}
                          {template ? ` · ${vatTreatmentLabel(template)}` : ''}
                        </p>
                      </div>
                      {template ? (
                        <Button size="xs" variant="outline" onClick={() => add(template)} aria-label={`Ajouter la suggestion ${s.name}`}>
                          <Plus aria-hidden />
                          Ajouter
                        </Button>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="all-templates" className="space-y-3">
            <h2 id="all-templates" className="text-base font-semibold">
              Tous les modèles
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-0 flex-1 basis-56">
                <Search aria-hidden className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Fournisseur, dépense..." aria-label="Rechercher un modèle" className="pl-8" />
              </div>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger size="sm" className="w-56" aria-label="Catégorie">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les catégories</SelectItem>
                  {library.categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!library.hasChart ? (
              <p className="text-sm" role="note">
                La société n’a pas d’exercice ouvert&nbsp;: les comptes des modèles ne peuvent pas être rapprochés de votre plan.
              </p>
            ) : null}
            {visible.length === 0 ? (
              <EmptyState bordered icon={Search} title="Aucun modèle trouvé" description="Essayez un autre mot ou une autre catégorie." />
            ) : (
              library.categories
                .filter((c) => visible.some((t) => t.category === c.id))
                .map((c) => (
                  <div key={c.id} className="space-y-3">
                    <h3 className="text-muted-foreground text-sm font-medium">{c.label}</h3>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {visible
                        .filter((t) => t.category === c.id)
                        .map((t) => (
                          <TemplateCard key={t.id} template={t} onAdd={add} />
                        ))}
                    </div>
                  </div>
                ))
            )}
          </section>
        </>
      )}

      <CopySection companyId={companyId} onCopied={reload} />
      <AddTemplateDialog template={pending} companyId={companyId} onClose={() => setPending(null)} />
    </div>
  )
}
