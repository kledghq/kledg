'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, ChevronDown, Copy, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Field, HelpTip, PageHeader, useConfirm } from '@/components/shared'
import { docsUrl } from '@/lib/docs-links'
import { logger } from '@/lib/logger'
import { fromCents, toCents } from '@/lib/utils/money'
import { RuleConditions } from './rule-conditions'
import { RuleEntryLines, type BalanceCheck } from './rule-entry-lines'
import { RulePreview, useRulePreview } from './rule-preview'
import { RuleSection } from './rule-section'
import {
  PRIORITY_PRESETS,
  hasBankLine,
  priorityOfPreset,
  priorityPresetOf,
  saveBlocker,
  savePayload,
  type Account,
  type Journal,
  type PriorityPreset,
  type RuleFormState,
} from './rule-form'

export interface RuleEditorProps {
  companyId: string
  /** The saved rule being edited, or null for a new rule. */
  ruleId: string | null
  initial: RuleFormState
  accounts: Account[]
  journals: Journal[]
  /** A connected bank provides the VAT of its transactions (Qonto). */
  bankProvidesVat: boolean
  /** Company option for VAT on services on debits, null when it could not be read. */
  servicesVatOnDebits?: boolean | null
  /** Saved regex the matcher refuses, from the rules list. */
  patternIssue?: string
}

/**
 * Page editor of an assignment rule: its sections stacked on the left
 * (Général, Conditions, Écriture proposée, Options), a live preview on the
 * right (below on phones), and a sticky bar with the actions. It sends the
 * requests of the former dialog, unchanged.
 */
export function RuleEditor({
  companyId,
  ruleId,
  initial,
  accounts,
  journals,
  bankProvidesVat,
  servicesVatOnDebits = null,
  patternIssue,
}: RuleEditorProps) {
  const router = useRouter()
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [state, setState] = React.useState<RuleFormState>(initial)
  const [saving, setSaving] = React.useState(false)
  const [initialSnapshot, setInitialSnapshot] = React.useState(() => JSON.stringify(initial))
  const dirty = JSON.stringify(state) !== initialSnapshot
  const listHref = `/${companyId}/rules`

  const set = <K extends keyof RuleFormState>(key: K, value: RuleFormState[K]) =>
    setState((current) => ({ ...current, [key]: value }))

  const preview = useRulePreview({
    companyId,
    conditions: state.conditions,
    entryLines: state.entryLines,
    defaultVatAccountId: state.defaultVatAccountId,
    accounts,
  })

  const bankLine = hasBankLine(state.entryLines, accounts)
  const balance: BalanceCheck = preview.simulation
    ? preview.simulation.balanced
      ? { status: 'balanced' }
      : {
          status: 'gap',
          gap: fromCents(Math.abs((toCents(preview.simulation.totalDebit) ?? 0) - (toCents(preview.simulation.totalCredit) ?? 0))),
          hasBankLine: bankLine,
        }
    : preview.simulating
      ? { status: 'loading' }
      : { status: 'idle' }
  // A rule that books its own bank line must balance; otherwise the engine adds the bank line.
  const unbalanced = balance.status === 'gap' && balance.hasBankLine

  // Never lose input: the browser asks before leaving with unsaved changes
  React.useEffect(() => {
    if (!dirty || saving) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, saving])

  const leave = async (href: string) => {
    if (dirty) {
      const ok = await confirm({
        title: 'Quitter sans enregistrer ?',
        description: 'Les modifications de la règle seront perdues.',
        confirmLabel: 'Quitter sans enregistrer',
      })
      if (!ok) return
    }
    router.push(href)
  }

  const handleSave = async () => {
    const blocker = saveBlocker(state, companyId, accounts, unbalanced)
    if (blocker) {
      toast.error(blocker)
      return
    }
    setSaving(true)
    try {
      const response = await fetch(ruleId ? `/api/transaction-rules/${ruleId}` : '/api/transaction-rules', {
        method: ruleId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(savePayload(state, companyId, accounts)),
      })
      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(error?.error || "Erreur lors de l'enregistrement")
      }
      toast.success(ruleId ? 'Règle modifiée' : 'Règle créée')
      setInitialSnapshot(JSON.stringify(state))
      router.push(listHref)
    } catch (error) {
      setSaving(false)
      toast.error(error instanceof Error ? error.message : "La règle n'a pas été enregistrée. Réessayez.")
    }
  }

  const handleDelete = async () => {
    if (!ruleId) return
    const ok = await confirm({
      title: `Supprimer la règle « ${initial.name} » ?`,
      description:
        'Les transactions ne seront plus reconnues par cette règle. Les écritures déjà créées avec elle sont conservées.',
      confirmLabel: 'Supprimer la règle',
    })
    if (!ok) return
    try {
      const response = await fetch(`/api/transaction-rules/${ruleId}`, { method: 'DELETE' })
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(data?.error || "La règle n'a pas été supprimée. Réessayez.")
      }
      toast.success('Règle supprimée')
      setSaving(true)
      router.push(listHref)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "La règle n'a pas été supprimée. Réessayez.")
    }
  }

  const handleDuplicate = async () => {
    if (!ruleId) return
    try {
      const response = await fetch(`/api/transaction-rules/${ruleId}/duplicate`, { method: 'POST' })
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(data?.error || "La règle n'a pas été dupliquée. Réessayez.")
      }
      const data = (await response.json().catch(() => null)) as { rule?: { id?: string } } | null
      toast.success('Règle dupliquée')
      router.push(data?.rule?.id ? `${listHref}/${data.rule.id}` : listHref)
    } catch (error) {
      logger.error('Error duplicating rule:', error)
      toast.error(error instanceof Error ? error.message : "La règle n'a pas été dupliquée. Réessayez.")
    }
  }

  const preset = priorityPresetOf(state.priority)
  const blockedByBalance = unbalanced

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          href={listHref}
          onClick={(event) => {
            if (!dirty) return
            event.preventDefault()
            void leave(listHref)
          }}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded-sm text-sm outline-none focus-visible:ring-[3px]"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Règles d&apos;affectation
        </Link>
        <PageHeader
          title={ruleId ? initial.name || 'Règle' : 'Nouvelle règle'}
          description={
            ruleId
              ? 'Modifiez les conditions et les lignes de l’écriture proposée.'
              : 'Une règle reconnaît des transactions (conditions) et propose leur écriture (lignes).'
          }
          docsHref={docsUrl('bankReconciliation')}
        />
      </div>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void handleSave()
        }}
        className="space-y-6"
      >
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
          <div className="min-w-0 space-y-6">
            <RuleSection id="rule-general" title="Général">
              <Field label="Nom" required>
                <Input id="rule-name" value={state.name} onChange={(e) => set('name', e.target.value)} placeholder="ex. Abonnement Adobe" />
              </Field>
              <Field label="Description" optional>
                <Textarea
                  id="rule-description"
                  rows={2}
                  value={state.description}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="ex. Licences Creative Cloud, prélevées chaque mois"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Journal" htmlFor="rule-journal">
                  <Select value={state.journalCode} onValueChange={(value) => set('journalCode', value)}>
                    <SelectTrigger id="rule-journal" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {journals.map((journal) => (
                        <SelectItem key={journal.id} value={journal.code}>
                          {journal.code} - {journal.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <div className="space-y-2">
                  <p id="rule-priority-label" className="text-sm leading-none font-medium">
                    Priorité
                  </p>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={preset ?? ''}
                    onValueChange={(value) => value && set('priority', priorityOfPreset(value as PriorityPreset))}
                    aria-labelledby="rule-priority-label"
                    aria-describedby="rule-priority-hint"
                    className="w-full"
                  >
                    {PRIORITY_PRESETS.map((p) => (
                      <ToggleGroupItem key={p.id} value={p.id} className="flex-1">
                        {p.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <p id="rule-priority-hint" className="text-muted-foreground text-xs">
                    {preset
                      ? 'Quand plusieurs règles reconnaissent une transaction, la plus haute l’emporte.'
                      : `Priorité personnalisée : ${state.priority}.`}
                  </p>
                </div>
              </div>
              <Collapsible defaultOpen={!preset}>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="group -ml-2">
                    Avancé
                    <ChevronDown aria-hidden className="transition-transform group-data-[state=open]:rotate-180" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <Field
                    label="Priorité exacte"
                    hint="Le nombre le plus grand passe en premier. Haute vaut 10, Normale 0, Basse -10."
                    className="max-w-48"
                  >
                    <Input
                      id="rule-priority"
                      type="number"
                      inputMode="numeric"
                      step={1}
                      value={state.priority}
                      onChange={(e) => set('priority', parseInt(e.target.value) || 0)}
                    />
                  </Field>
                </CollapsibleContent>
              </Collapsible>
            </RuleSection>

            <RuleConditions conditions={state.conditions} onChange={(conditions) => set('conditions', conditions)} patternIssue={patternIssue} />

            <RuleEntryLines
              lines={state.entryLines}
              onChange={(lines) => set('entryLines', lines)}
              accounts={accounts}
              defaultVatAccountId={state.defaultVatAccountId}
              onDefaultVatAccountChange={(id) => set('defaultVatAccountId', id)}
              bankProvidesVat={bankProvidesVat}
              balance={balance}
            />

            <RuleSection id="rule-options" title="Options">
              <SwitchRow
                id="rule-enabled"
                label="Règle active"
                hint="Proposée sur les transactions qui remplissent toutes ses conditions."
                checked={state.enabled}
                onCheckedChange={(checked) => set('enabled', checked)}
              />
              <SwitchRow
                id="rule-auto-create"
                label="Créer automatiquement l'écriture"
                hint="L’actualisation crée l’écriture en brouillon, sans clic. Sinon, la règle reste une suggestion."
                help={
                  <HelpTip term="Créer automatiquement l'écriture" docsHref={docsUrl('bankReconciliation')}>
                    Cochée, chaque actualisation (en-tête de l&apos;application) crée l&apos;écriture en brouillon pour les transactions
                    reconnues. Décochée, la règle est proposée dans la file du Rapprochement et appliquée par «&nbsp;Appliquer les
                    règles&nbsp;».
                  </HelpTip>
                }
                checked={state.autoCreate}
                onCheckedChange={(checked) => set('autoCreate', checked)}
              />
            </RuleSection>
          </div>

          <aside className="min-w-0 lg:sticky lg:top-20" aria-label="Aperçu de la règle">
            <RulePreview preview={preview} entryLines={state.entryLines} servicesVatOnDebits={servicesVatOnDebits} />
          </aside>
        </div>

        <div className="bg-background sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            {ruleId ? (
              <>
                <Button type="button" variant="ghost" className="hover:text-destructive" onClick={() => void handleDelete()}>
                  <Trash2 aria-hidden />
                  Supprimer
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void handleDuplicate()}
                  disabled={dirty}
                  title={dirty ? 'Enregistrez d’abord vos modifications' : undefined}
                >
                  <Copy aria-hidden />
                  Dupliquer
                </Button>
              </>
            ) : null}
            {dirty ? (
              <span className="text-muted-foreground text-sm" role="status">
                Modifications non enregistrées
              </span>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => void leave(listHref)}>
              Annuler
            </Button>
            {blockedByBalance ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button type="submit" disabled>
                        Enregistrer
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Équilibrez l&apos;écriture pour pouvoir enregistrer</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <Button type="submit" loading={saving}>
                Enregistrer
              </Button>
            )}
          </div>
        </div>
      </form>
      {confirmDialog}
    </div>
  )
}

function SwitchRow({
  id,
  label,
  hint,
  help,
  checked,
  onCheckedChange,
}: {
  id: string
  label: string
  hint: string
  help?: React.ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} aria-describedby={`${id}-hint`} />
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={id}>{label}</Label>
          {help}
        </div>
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      </div>
    </div>
  )
}
