'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Workflow } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { logger } from '@/lib/logger'
import { RuleEditor } from './rule-editor'
import {
  VAT_DETECTING_PROVIDERS,
  newRuleState,
  parseJsonArray,
  savedRuleState,
  toConditions,
  toEntryLines,
  type Account,
  type Journal,
  type RuleFormState,
  type RulePrefill,
  type SavedRule,
} from './rule-form'

interface Loaded {
  initial: RuleFormState
  accounts: Account[]
  journals: Journal[]
  bankProvidesVat: boolean
  servicesVatOnDebits: boolean | null
  patternIssue?: string
}

async function loadAccounts(companyId: string): Promise<Account[]> {
  try {
    const response = await fetch(`/api/accounts?companyId=${companyId}`)
    if (!response.ok) throw new Error('accounts')
    const data = (await response.json()) as Account[] | { accounts?: Account[] }
    return Array.isArray(data) ? data : (data.accounts ?? [])
  } catch (error) {
    logger.error('Error loading accounts:', error)
    toast.error('Le plan de comptes ne s’est pas chargé. Rechargez la page.')
    return []
  }
}

async function loadJournals(companyId: string): Promise<Journal[]> {
  try {
    const response = await fetch(`/api/journals?companyId=${companyId}`)
    if (!response.ok) throw new Error('journals')
    const data: unknown = await response.json()
    return Array.isArray(data) ? (data as Journal[]) : []
  } catch (error) {
    logger.error('Error loading journals:', error)
    return []
  }
}

/** True when a bank connection of the company provides the VAT of its transactions (Qonto). */
async function loadBankProvidesVat(companyId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/banking/connections?companyId=${companyId}`)
    if (!response.ok) return false
    const data = (await response.json()) as { connections?: Array<{ provider?: string }> }
    return (data.connections ?? []).some((c) => !!c.provider && VAT_DETECTING_PROVIDERS.includes(c.provider))
  } catch {
    return false
  }
}

/** The company's option for VAT on services on debits; null when the user may not read the VAT settings. */
async function loadServicesVatOnDebits(companyId: string): Promise<boolean | null> {
  try {
    const response = await fetch(`/api/companies/${companyId}/vat-settings`)
    if (!response.ok) return null
    const data = (await response.json()) as { servicesVatOnDebits?: boolean }
    return typeof data.servicesVatOnDebits === 'boolean' ? data.servicesVatOnDebits : null
  } catch {
    return null
  }
}

/**
 * Prefill of a new rule from the address, as the rules page read it before:
 * "Créer une règle à partir de cette transaction" passes the suggested name,
 * conditions and lines as JSON; a link with the transaction only (Démarrer
 * checklist, subscriptions) asks the API for the suggested rule.
 */
async function loadPrefill(searchParams: URLSearchParams): Promise<RulePrefill> {
  const fromTransaction = searchParams.get('fromTransaction')
  if (!fromTransaction) return {}
  const conditionsParam = searchParams.get('conditions')
  const entryLinesParam = searchParams.get('entryLines')
  if (!conditionsParam && !entryLinesParam) {
    try {
      const response = await fetch(`/api/transactions/${encodeURIComponent(fromTransaction)}/create-rule`)
      if (!response.ok) return {}
      const data = (await response.json()) as {
        suggestedName?: string
        suggestedConditions?: Array<Record<string, unknown>>
        suggestedEntryLines?: Array<Record<string, unknown>>
      }
      return {
        name: data.suggestedName || undefined,
        conditions: toConditions(data.suggestedConditions ?? []),
        entryLines: toEntryLines(data.suggestedEntryLines ?? []),
      }
    } catch (error) {
      logger.error('Error loading the suggested rule:', error)
      return {}
    }
  }
  return {
    name: searchParams.get('ruleName') || undefined,
    conditions: toConditions(parseJsonArray(conditionsParam)),
    entryLines: toEntryLines(parseJsonArray(entryLinesParam)),
  }
}

/** Saved rule and its pattern issue, from the rules list (there is no single rule endpoint). */
async function loadRule(companyId: string, ruleId: string): Promise<{ rule: SavedRule; patternIssue?: string } | null> {
  const response = await fetch(`/api/transaction-rules?companyId=${companyId}`)
  if (!response.ok) throw new Error('La règle ne s’est pas chargée. Rechargez la page.')
  const data = (await response.json()) as {
    rules?: SavedRule[]
    patternIssues?: Array<{ ruleId: string; message: string }>
  }
  const rule = (data.rules ?? []).find((r) => r.id === ruleId)
  if (!rule) return null
  return { rule, patternIssue: data.patternIssues?.find((issue) => issue.ruleId === ruleId)?.message }
}

/** /[companyId]/rules/new and /[companyId]/rules/[id]: loads what the editor needs, then shows it. */
export function RuleEditorPage({ ruleId = null }: { ruleId?: string | null }) {
  const params = useParams()
  const searchParams = useSearchParams()
  const companyId = params?.companyId as string
  const search = searchParams.toString()
  const [loaded, setLoaded] = React.useState<Loaded | null>(null)
  const [state, setState] = React.useState<'loading' | 'missing' | 'error'>('loading')
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!companyId) return
    let cancelled = false
    setLoaded(null)
    setState('loading')
    void (async () => {
      try {
        const [accounts, journals, bankProvidesVat, servicesVatOnDebits, ruleOrPrefill] = await Promise.all([
          loadAccounts(companyId),
          loadJournals(companyId),
          loadBankProvidesVat(companyId),
          loadServicesVatOnDebits(companyId),
          ruleId ? loadRule(companyId, ruleId) : loadPrefill(new URLSearchParams(search)),
        ])
        if (cancelled) return
        if (ruleId) {
          const found = ruleOrPrefill as Awaited<ReturnType<typeof loadRule>>
          if (!found) {
            setState('missing')
            return
          }
          setLoaded({
            initial: savedRuleState(found.rule, accounts),
            accounts,
            journals,
            bankProvidesVat,
            servicesVatOnDebits,
            patternIssue: found.patternIssue,
          })
        } else {
          setLoaded({ initial: newRuleState(ruleOrPrefill as RulePrefill), accounts, journals, bankProvidesVat, servicesVatOnDebits })
        }
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'La règle ne s’est pas chargée. Rechargez la page.')
        setState('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [companyId, ruleId, search])

  if (!companyId) return <NoCompanySelected />

  if (loaded) {
    return (
      <RuleEditor
        key={ruleId ?? `new:${search}`}
        companyId={companyId}
        ruleId={ruleId}
        initial={loaded.initial}
        accounts={loaded.accounts}
        journals={loaded.journals}
        bankProvidesVat={loaded.bankProvidesVat}
        servicesVatOnDebits={loaded.servicesVatOnDebits}
        patternIssue={loaded.patternIssue}
      />
    )
  }

  if (state === 'missing') {
    return (
      <EmptyState
        bordered
        icon={Workflow}
        title="Règle introuvable"
        description="Elle a peut-être été supprimée. Retrouvez les règles de la société dans la liste."
        action={
          <Button size="sm" asChild>
            <Link href={`/${companyId}/rules`}>Règles d&apos;affectation</Link>
          </Button>
        }
      />
    )
  }

  if (state === 'error') {
    return (
      <p role="alert" className="text-sm">
        {error}
      </p>
    )
  }

  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-64" />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="space-y-6">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    </div>
  )
}
