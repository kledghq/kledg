'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Copy, MoreHorizontal, Pencil, Plus, Trash2, Workflow } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { TransactionRuleDialog } from '@/components/features/rules/transaction-rule-dialog'
import { EmptyState, PageHeader, StatusBadge, useConfirm } from '@/components/shared'
import { docsUrl } from '@/lib/docs-links'
import { logger } from '@/lib/logger'
import { plural } from '@/lib/utils/plural'

interface Account {
  id: string
  code: string
  label: string
}

interface TransactionRule {
  id: string
  name: string
  description: string | null
  enabled: boolean
  priority: number
  journalCode: string
  defaultVatAccountCode: string | null
  autoCreate: boolean
  usageCount: number
  conditions: Array<{
    id: string
    conditionType: string
    operator: string
    value: string | null
    value2: string | null
  }>
  entryLines: Array<{
    id: string
    accountCode: string
    lineType: string
    amountType: string
    amountValue: number | null
    description: string | null
    order: number
    vatType: string | null
    vatRateSource: string | null
    vatRate: number | null
    vatAccountCode: string | null
    vatAccount2Code: string | null
    vatOnDebit: boolean
  }>
}

type DialogProps = React.ComponentProps<typeof TransactionRuleDialog>
type Condition = NonNullable<DialogProps['initialConditions']>[number]
type EntryLine = NonNullable<DialogProps['initialEntryLines']>[number]

/** Parses a JSON array passed in the URL by "Créer une règle à partir de cette transaction". */
function parseJsonArray(raw: string | null): Array<Record<string, unknown>> {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null) : []
  } catch (error) {
    logger.error('Error parsing rule prefill:', error)
    return []
  }
}

const toConditions = (items: Array<Record<string, unknown>>): Condition[] =>
  items.map((c, idx) => ({ ...c, id: `temp-${idx}` }) as Condition)

const toEntryLines = (items: Array<Record<string, unknown>>): EntryLine[] =>
  items.map((l, idx) => ({ ...l, id: `temp-${idx}`, order: idx }) as EntryLine)

export default function RulesPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const companyId = params?.companyId as string
  const [loading, setLoading] = useState(true)
  const [rules, setRules] = useState<TransactionRule[]>([])
  // Regex conditions saved before patterns were checked: they never match until corrected
  const [patternIssues, setPatternIssues] = useState<Map<string, string>>(new Map())
  const [accounts, setAccounts] = useState<Account[]>([])
  const [journals, setJournals] = useState<Array<{ id: string; code: string; label: string }>>([])
  const [openDialog, setOpenDialog] = useState(false)
  const [editingRule, setEditingRule] = useState<TransactionRule | null>(null)
  const [initialConditions, setInitialConditions] = useState<Condition[]>([])
  const [initialEntryLines, setInitialEntryLines] = useState<EntryLine[]>([])
  const [initialRuleName, setInitialRuleName] = useState<string>('')
  const { confirm, dialog: confirmDialog } = useConfirm()

  const loadRules = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      const response = await fetch(`/api/transaction-rules?companyId=${companyId}`)
      if (!response.ok) throw new Error('Les règles ne se sont pas chargées. Rechargez la page.')
      const data = (await response.json()) as {
        rules?: TransactionRule[]
        patternIssues?: Array<{ ruleId: string; message: string }>
      }
      setRules(data.rules ?? [])
      setPatternIssues(new Map((data.patternIssues ?? []).map((issue) => [issue.ruleId, issue.message])))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Les règles ne se sont pas chargées. Rechargez la page.')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  const loadAccounts = useCallback(async () => {
    if (!companyId) return
    try {
      const response = await fetch(`/api/accounts?companyId=${companyId}`)
      if (!response.ok) throw new Error('accounts')
      const data = (await response.json()) as Account[] | { accounts?: Account[] }
      setAccounts(Array.isArray(data) ? data : (data.accounts ?? []))
    } catch (error) {
      logger.error('Error loading accounts:', error)
      toast.error('Le plan de comptes ne s’est pas chargé. Rechargez la page.')
    }
  }, [companyId])

  const loadJournals = useCallback(async () => {
    if (!companyId) return
    try {
      const response = await fetch(`/api/journals?companyId=${companyId}`)
      if (!response.ok) throw new Error('journals')
      const data: unknown = await response.json()
      setJournals(Array.isArray(data) ? data : [])
    } catch (error) {
      logger.error('Error loading journals:', error)
    }
  }, [companyId])

  useEffect(() => {
    void loadRules()
    void loadAccounts()
    void loadJournals()
  }, [loadRules, loadAccounts, loadJournals])

  // "Créer une règle à partir de cette transaction" opens the dialog prefilled.
  useEffect(() => {
    const fromTransaction = searchParams.get('fromTransaction')
    if (!companyId || !fromTransaction) return
    const conditionsParam = searchParams.get('conditions')
    const entryLinesParam = searchParams.get('entryLines')

    if (!conditionsParam && !entryLinesParam) {
      // Link with only the transaction (the Démarrer checklist): ask the API for the suggested rule.
      void (async () => {
        try {
          const response = await fetch(`/api/transactions/${encodeURIComponent(fromTransaction)}/create-rule`)
          if (response.ok) {
            const data = (await response.json()) as {
              suggestedName?: string
              suggestedConditions?: Array<Record<string, unknown>>
              suggestedEntryLines?: Array<Record<string, unknown>>
            }
            if (data.suggestedName) setInitialRuleName(data.suggestedName)
            setInitialConditions(toConditions(data.suggestedConditions ?? []))
            setInitialEntryLines(toEntryLines(data.suggestedEntryLines ?? []))
          }
        } catch (error) {
          logger.error('Error loading the suggested rule:', error)
        } finally {
          setOpenDialog(true)
        }
      })()
      return
    }

    const ruleName = searchParams.get('ruleName')
    if (ruleName) setInitialRuleName(ruleName)
    setInitialConditions(toConditions(parseJsonArray(conditionsParam)))
    setInitialEntryLines(toEntryLines(parseJsonArray(entryLinesParam)))
    setOpenDialog(true)
  }, [companyId, searchParams])

  const handleDelete = async (rule: TransactionRule) => {
    const ok = await confirm({
      title: `Supprimer la règle « ${rule.name} » ?`,
      description:
        'Les transactions ne seront plus reconnues par cette règle. Les écritures déjà créées avec elle sont conservées.',
      confirmLabel: 'Supprimer la règle',
    })
    if (!ok) return
    try {
      const response = await fetch(`/api/transaction-rules/${rule.id}`, { method: 'DELETE' })
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(data?.error || "La règle n'a pas été supprimée. Réessayez.")
      }
      toast.success('Règle supprimée')
      void loadRules()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "La règle n'a pas été supprimée. Réessayez.")
    }
  }

  const handleDuplicate = async (rule: TransactionRule) => {
    try {
      const response = await fetch(`/api/transaction-rules/${rule.id}/duplicate`, { method: 'POST' })
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(data?.error || "La règle n'a pas été dupliquée. Réessayez.")
      }
      toast.success('Règle dupliquée')
      void loadRules()
    } catch (error) {
      logger.error('Error duplicating rule:', error)
      toast.error(error instanceof Error ? error.message : "La règle n'a pas été dupliquée. Réessayez.")
    }
  }

  const handleOpenDialog = (rule?: TransactionRule) => {
    setEditingRule(rule ?? null)
    if (!rule) {
      setInitialConditions([])
      setInitialEntryLines([])
      setInitialRuleName('')
    }
    setOpenDialog(true)
  }

  if (!companyId) {
    return <NoCompanySelected />
  }

  const newRuleButton = (size: 'default' | 'sm') => (
    <Button size={size} onClick={() => handleOpenDialog()}>
      <Plus aria-hidden />
      Nouvelle règle
    </Button>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Règles d'affectation"
        description="Une règle reconnaît des transactions qui se ressemblent et propose leur écriture&nbsp;: vous n'avez plus qu'à valider."
        docsHref={docsUrl('bankReconciliation')}
        actions={newRuleButton('default')}
      />

      {!loading && rules.length === 0 ? (
        <EmptyState
          bordered
          icon={Workflow}
          title="Aucune règle d'affectation"
          description="Créez une règle pour les opérations qui reviennent (abonnements, loyer, frais bancaires). Vous pouvez aussi partir d'une transaction depuis le rapprochement."
          action={newRuleButton('sm')}
        />
      ) : (
        <Table containerClassName="rounded-lg border" aria-busy={loading || undefined}>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead numeric className="hidden sm:table-cell">
                Priorité
              </TableHead>
              <TableHead numeric className="hidden lg:table-cell">
                Conditions
              </TableHead>
              <TableHead numeric className="hidden lg:table-cell">
                Lignes
              </TableHead>
              <TableHead numeric className="hidden lg:table-cell">
                Utilisations
              </TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeleton columns={7} rows={4} />
            ) : (
              rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell className="max-w-80 whitespace-normal lg:whitespace-nowrap">
                    <button
                      type="button"
                      className="hover:text-link focus-visible:ring-ring/50 pointer-coarse:min-h-11 block max-w-full rounded-sm text-left font-medium break-words outline-none focus-visible:ring-[3px] lg:truncate"
                      onClick={() => handleOpenDialog(rule)}
                    >
                      {rule.name}
                    </button>
                    {rule.description ? (
                      <div className="text-muted-foreground line-clamp-2 text-xs lg:truncate">{rule.description}</div>
                    ) : null}
                    {/* The counts hidden with their columns on narrow screens */}
                    <div className="text-muted-foreground num text-xs lg:hidden">
                      <span className="sm:hidden">Priorité {rule.priority}, </span>
                      {plural(rule.conditions.length, 'condition')}, {plural(rule.entryLines.length, 'ligne')},{' '}
                      {plural(rule.usageCount, 'utilisation')}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal sm:whitespace-nowrap">
                    <StatusBadge tone={rule.enabled ? 'success' : 'neutral'}>
                      {rule.enabled ? 'Active' : 'Inactive'}
                    </StatusBadge>
                    {patternIssues.has(rule.id) ? (
                      <StatusBadge tone="warning" className="mt-1 sm:mt-0 sm:ml-1.5" title={patternIssues.get(rule.id)}>
                        Expression à corriger
                      </StatusBadge>
                    ) : null}
                  </TableCell>
                  <TableCell numeric className="hidden sm:table-cell">
                    {rule.priority}
                  </TableCell>
                  <TableCell numeric className="hidden lg:table-cell">
                    {rule.conditions.length}
                  </TableCell>
                  <TableCell numeric className="hidden lg:table-cell">
                    {rule.entryLines.length}
                  </TableCell>
                  <TableCell numeric className="hidden lg:table-cell">
                    {rule.usageCount}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="max-sm:hidden"
                        onClick={() => handleOpenDialog(rule)}
                        aria-label={`Modifier la règle ${rule.name}`}
                        title="Modifier"
                      >
                        <Pencil aria-hidden />
                      </Button>
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Autres actions sur la règle ${rule.name}`}
                            title="Autres actions"
                          >
                            <MoreHorizontal aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem className="sm:hidden" onSelect={() => handleOpenDialog(rule)}>
                            <Pencil aria-hidden />
                            Modifier
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void handleDuplicate(rule)}>
                            <Copy aria-hidden />
                            Dupliquer
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onSelect={() => void handleDelete(rule)}>
                            <Trash2 aria-hidden />
                            Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}

      <TransactionRuleDialog
        open={openDialog}
        onOpenChange={(open) => {
          setOpenDialog(open)
          if (!open) setEditingRule(null)
        }}
        editingRule={editingRule}
        companyId={companyId}
        accounts={accounts}
        journals={journals}
        initialConditions={initialConditions}
        initialEntryLines={initialEntryLines}
        initialRuleName={initialRuleName}
        onSave={loadRules}
      />

      {confirmDialog}
    </div>
  )
}
