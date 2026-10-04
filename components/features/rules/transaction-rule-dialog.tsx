/**
 * Transaction rule dialog component
 * 
 * This component handles creating and editing transaction rules with 4 tabs:
 * - General: Basic rule information
 * - Conditions: Matching conditions
 * - Template: Accounting entry lines
 * - Simulation: Test the rule with example transactions
 */

'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Info, Plus, X, GripVertical, PlayCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AccountCombobox } from '@/components/features/accounting/account-combobox'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { EntrySimulation, type SimulatedEntry } from './entry-simulation'

interface Account {
  id: string
  code: string
  label: string
}

interface Journal {
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
    vatRateSource?: string | null
    vatRate: number | null
    vatAccountCode: string | null
    vatAccount2Code: string | null
    vatOnDebit: boolean
  }>
}

interface Condition {
  id: string
  conditionType: string
  operator: string
  value: string
  value2?: string
}

interface EntryLine {
  id: string
  accountId: string
  lineType: 'debit' | 'credit'
  amountType: 'full' | 'percentage' | 'fixed' | 'remaining' | 'ht' | 'ttc' | 'vat'
  amountValue?: number
  description?: string
  order: number
  vatType?: 'none' | 'collectible' | 'deductible' | 'intracom' | 'import' | 'exempt' | 'reverse_charge'
  /** 'fixed' = taux saisi, 'transaction' = taux/montant détecté (ex. Qonto) */
  vatRateSource?: 'fixed' | 'transaction'
  vatRate?: number
  vatAccountId?: string
  vatAccount2Id?: string
  vatOnDebit?: boolean
}

/** Entry lines from parent may use lineType 'auto'; normalized to 'debit' when used in dialog */
type EntryLineInput = Omit<EntryLine, 'lineType'> & { lineType: 'debit' | 'credit' | 'auto' }

function normalizeEntryLines(lines: EntryLineInput[]): EntryLine[] {
  return lines.map((l) => ({
    ...l,
    lineType: l.lineType === 'auto' ? 'debit' : l.lineType,
  }))
}

interface TransactionRuleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingRule: TransactionRule | null
  companyId: string
  accounts: Account[]
  journals: Journal[]
  initialConditions?: Condition[]
  initialEntryLines?: EntryLineInput[]
  initialRuleName?: string
  initialRuleDescription?: string
  initialJournalCode?: string
  onSave: () => void
}

// Stable defaults: a new [] on every render would re-run the init effect
// (it depends on them) and reset what the user typed.
const NO_CONDITIONS: Condition[] = []
const NO_ENTRY_LINES: EntryLine[] = []

/**
 * Transaction rule dialog component
 */
export function TransactionRuleDialog({
  open,
  onOpenChange,
  editingRule,
  companyId,
  accounts,
  journals,
  initialConditions = NO_CONDITIONS,
  initialEntryLines = NO_ENTRY_LINES,
  initialRuleName = '',
  initialRuleDescription = '',
  initialJournalCode = 'BQ',
  onSave,
}: TransactionRuleDialogProps) {
  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [priority, setPriority] = useState(0)
  const [journalCode, setJournalCode] = useState('BQ')
  const [defaultVatAccountId, setDefaultVatAccountId] = useState<string>('')
  const [autoCreate, setAutoCreate] = useState(false)
  const [conditions, setConditions] = useState<Condition[]>(initialConditions)
  const [entryLines, setEntryLines] = useState<EntryLine[]>(() =>
    normalizeEntryLines(initialEntryLines)
  )
  
  // Simulation state
  const [simulationAmount, setSimulationAmount] = useState('100')
  const [simulationSide, setSimulationSide] = useState<'debit' | 'credit'>('debit')
  const [simulation, setSimulation] = useState<SimulatedEntry | null>(null)
  const [loadingSimulation, setLoadingSimulation] = useState(false)

  // Initialize form when dialog opens or editing rule changes
  useEffect(() => {
    if (open) {
      if (editingRule) {
        const codeToId = new Map(accounts.map((a) => [a.code, a.id]))
        const resolveCode = (code: string | null | undefined) =>
          code ? codeToId.get(code) ?? '' : ''

        setName(editingRule.name)
        setDescription(editingRule.description || '')
        setEnabled(editingRule.enabled)
        setPriority(editingRule.priority)
        setJournalCode(editingRule.journalCode)
        setDefaultVatAccountId(resolveCode(editingRule.defaultVatAccountCode))
        setAutoCreate(editingRule.autoCreate)
        setConditions(editingRule.conditions.map(c => ({
          id: c.id,
          conditionType: c.conditionType || 'label',
          operator: c.operator || 'contains',
          value: c.value || '',
          value2: c.value2 || '',
        })))
        setEntryLines(editingRule.entryLines.map(l => ({
          id: l.id,
          accountId: resolveCode(l.accountCode),
          lineType: (l.lineType === 'auto' ? 'debit' : l.lineType) as 'debit' | 'credit',
          amountType: l.amountType as EntryLine['amountType'],
          amountValue: l.amountValue ? Number(l.amountValue) : undefined,
          description: l.description || undefined,
          order: l.order,
          vatType: (l.vatType || 'none') as EntryLine['vatType'],
          vatRateSource: l.vatRateSource === 'transaction' ? 'transaction' : 'fixed',
          vatRate: l.vatRate ? Number(l.vatRate) : undefined,
          vatAccountId: resolveCode(l.vatAccountCode) || undefined,
          vatAccount2Id: resolveCode(l.vatAccount2Code) || undefined,
          vatOnDebit: l.vatOnDebit,
        })))
      } else {
        setName(initialRuleName || '')
        setDescription(initialRuleDescription || '')
        setEnabled(true)
        setPriority(0)
        setJournalCode(initialJournalCode || 'BQ')
        setDefaultVatAccountId('')
        setAutoCreate(false)
        setConditions(initialConditions)
        setEntryLines(normalizeEntryLines(initialEntryLines))
      }
      setSimulation(null)
    }
  }, [
    open,
    editingRule,
    accounts,
    initialConditions,
    initialEntryLines,
    initialRuleName,
    initialRuleDescription,
    initialJournalCode,
  ])

  const handleCloseDialog = () => {
    onOpenChange(false)
    setSimulation(null)
  }

  const handleAddCondition = () => {
    setConditions([...conditions, {
      id: `temp-${Date.now()}`,
      conditionType: 'label',
      operator: 'contains',
      value: '',
    }])
  }

  const handleRemoveCondition = (id: string) => {
    setConditions(conditions.filter(c => c.id !== id))
  }

  const handleUpdateCondition = (id: string, field: keyof Condition, value: string) => {
    setConditions(prevConditions => 
      prevConditions.map(c => 
        c.id === id ? { ...c, [field]: value } : c
      )
    )
  }

  const handleUpdateConditionMultiple = (id: string, updates: Partial<Condition>) => {
    setConditions(prevConditions => 
      prevConditions.map(c => 
        c.id === id ? { ...c, ...updates } : c
      )
    )
  }

  const handleAddEntryLine = () => {
    setEntryLines([...entryLines, {
      id: `temp-${Date.now()}`,
      accountId: '',
      lineType: 'debit',
      amountType: 'full',
      order: entryLines.length,
      vatType: 'none',
    }])
  }

  /** Find account by code (exact or prefix). Used for intracom preset (4452). */
  const findAccountByCode = (codePrefix: string): string => {
    const exact = accounts.find((a) => a.code === codePrefix)
    if (exact) return exact.id
    const prefixMatch = accounts.find(
      (a) => a.code.startsWith(codePrefix) && a.code.length > codePrefix.length
    )
    return prefixMatch?.id ?? ''
  }

  /** Preset: Achat intracommunautaire (2 lignes TVA: débit 445662, crédit 4452). */
  const handleApplyIntracomPurchaseTemplate = () => {
    const baseOrder = entryLines.length
    const vatAccountDebit = findAccountByCode('445662') || findAccountByCode('44566')
    const vatAccount2 = findAccountByCode('4452')
    setEntryLines([
      ...entryLines,
      {
        id: `temp-${Date.now()}-1`,
        accountId: '',
        lineType: 'credit',
        amountType: 'full',
        order: baseOrder,
        vatType: 'none',
        description: 'Fournisseur UE',
      },
      {
        id: `temp-${Date.now()}-2`,
        accountId: '',
        lineType: 'debit',
        amountType: 'full',
        order: baseOrder + 1,
        vatType: 'intracom',
        vatRate: 20,
        vatAccountId: vatAccountDebit || undefined,
        vatAccount2Id: vatAccount2 || undefined,
        description: 'Achat HT + TVA autoliquidation',
      },
    ])
    toast.success(
      'Modèle "Achat intracommunautaire" ajouté. Associez le compte de charge (6x), le compte TVA au débit (ex. 445662) et au crédit (ex. 4452).'
    )
  }

  /** Preset: Achat à l'import (banque 512101, TVA débit 445663, TVA crédit 445713 ; compte de charge non renseigné). */
  const handleApplyImportPurchaseTemplate = () => {
    const baseOrder = entryLines.length
    const bankAccount = findAccountByCode('512101') || findAccountByCode('512')
    const vatAccountDebit = findAccountByCode('445663') || findAccountByCode('44566')
    const vatAccountCredit = findAccountByCode('445713') || findAccountByCode('44571')
    setEntryLines([
      ...entryLines,
      {
        id: `temp-${Date.now()}-1`,
        accountId: bankAccount,
        lineType: 'credit',
        amountType: 'full',
        order: baseOrder,
        vatType: 'none',
        description: '',
      },
      {
        id: `temp-${Date.now()}-2`,
        accountId: '',
        lineType: 'debit',
        amountType: 'full',
        order: baseOrder + 1,
        vatType: 'import',
        vatRate: 20,
        vatAccountId: vatAccountDebit || undefined,
        vatAccount2Id: vatAccountCredit || undefined,
        description: 'Achat à l\'import HT + TVA déductible',
      },
    ])
    toast.success(
      'Modèle "Achat à l\'import" ajouté. Associez le compte de charge (6x) si besoin.'
    )
  }

  /** Preset: Achat avec TVA déductible, sans compte de charge (banque 512 + TVA 44566 ; compte de charge à associer par l'utilisateur). */
  const handleApplyPurchaseNoChargeTemplate = () => {
    const baseOrder = entryLines.length
    const bankAccount = findAccountByCode('512101') || findAccountByCode('512')
    const vatAccount = findAccountByCode('44566') || findAccountByCode('4456')
    setEntryLines([
      ...entryLines,
      {
        id: `temp-${Date.now()}-1`,
        accountId: bankAccount,
        lineType: 'credit',
        amountType: 'full',
        order: baseOrder,
        vatType: 'none',
        description: '',
      },
      {
        id: `temp-${Date.now()}-2`,
        accountId: '',
        lineType: 'debit',
        amountType: 'full',
        order: baseOrder + 1,
        vatType: 'deductible',
        vatRate: 20,
        vatAccountId: vatAccount || undefined,
        description: '',
      },
    ])
    toast.success(
      'Modèle "Achat" ajouté. Associez le compte de charge (6x) et le compte TVA (44566) si besoin.'
    )
  }

  const handleRemoveEntryLine = (id: string) => {
    setEntryLines(entryLines.filter(l => l.id !== id).map((l, idx) => ({
      ...l,
      order: idx,
    })))
  }

  const handleUpdateEntryLine = <K extends keyof EntryLine>(id: string, field: K, value: EntryLine[K]) => {
    setEntryLines(entryLines.map(l => 
      l.id === id ? { ...l, [field]: value } : l
    ))
  }

  const handleSimulate = async () => {
    if (entryLines.length === 0) {
      toast.error('Veuillez d\'abord définir au moins une ligne d\'écriture')
      return
    }

    setLoadingSimulation(true)
    try {
      const idToCode = new Map(accounts.map((a) => [a.id, a.code]))
      const codeOf = (id: string | undefined | null) =>
        id ? idToCode.get(id) ?? null : null

      // If rule is already saved, use endpoint with ID
      if (editingRule?.id) {
        const response = await fetch(`/api/transaction-rules/${editingRule.id}/simulate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transactionExample: {
              amount: parseFloat(simulationAmount),
              side: simulationSide,
              label: 'Transaction exemple',
            },
          }),
        })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.error || 'Erreur lors de la simulation')
        }
        const data = await response.json()
        setSimulation(data)
      } else {
        // Otherwise, use endpoint with data directly
        const response = await fetch('/api/transaction-rules/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            ruleData: {
              entryLines: entryLines.map(l => ({
                accountCode: codeOf(l.accountId) ?? '',
                lineType: l.lineType,
                amountType: l.amountType,
                amountValue: l.amountValue || null,
                description: l.description || null,
                order: l.order,
                vatType: l.vatType || null,
                vatRateSource: l.vatRateSource ?? 'fixed',
                vatRate: l.vatRate || null,
                vatAccountCode: codeOf(l.vatAccountId),
                vatAccount2Code: codeOf(l.vatAccount2Id),
                vatOnDebit: l.vatOnDebit || false,
              })),
              defaultVatAccountCode: codeOf(defaultVatAccountId),
            },
            transactionExample: {
              amount: parseFloat(simulationAmount),
              side: simulationSide,
              label: 'Transaction exemple',
            },
          }),
        })
        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Erreur lors de la simulation')
        }
        const data = await response.json()
        setSimulation(data)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "La simulation a échoué. Vérifiez les lignes de l'écriture.")
    } finally {
      setLoadingSimulation(false)
    }
  }

  const handleSave = async () => {
    if (!companyId || !name) {
      toast.error('Le nom est requis')
      return
    }

    if (conditions.length === 0) {
      toast.error('Au moins une condition est requise')
      return
    }

    if (entryLines.length === 0) {
      toast.error('Au moins une ligne d\'écriture est requise')
      return
    }

    if (simulation && !simulation.balanced) {
      toast.error('La simulation doit être équilibrée avant d\'enregistrer la règle')
      return
    }

    const idToCode = new Map(accounts.map((a) => [a.id, a.code]))
    const codeOf = (id: string | undefined | null) =>
      id ? idToCode.get(id) ?? null : null

    const missingAccountLine = entryLines.find((l) => !codeOf(l.accountId))
    if (missingAccountLine) {
      toast.error('Chaque ligne doit être associée à un compte du plan comptable')
      return
    }

    try {
      const url = editingRule
        ? `/api/transaction-rules/${editingRule.id}`
        : '/api/transaction-rules'

      const method = editingRule ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          name,
          description: description || null,
          enabled,
          priority,
          journalCode,
          defaultVatAccountCode: codeOf(defaultVatAccountId),
          autoCreate,
          conditions: conditions.map(c => ({
            conditionType: c.conditionType,
            operator: c.operator,
            value: c.value || null,
            value2: c.value2 || null,
          })),
          entryLines: entryLines.map(l => ({
            accountCode: codeOf(l.accountId) ?? '',
            lineType: l.lineType,
            amountType: l.amountType,
            amountValue: l.amountValue || null,
            description: l.description || null,
            order: l.order,
            vatType: l.vatType || null,
            vatRateSource: l.vatRateSource ?? 'fixed',
            vatRate: l.vatRate || null,
            vatAccountCode: codeOf(l.vatAccountId),
            vatAccount2Code: codeOf(l.vatAccount2Id),
            vatOnDebit: l.vatOnDebit || false,
          })),
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Erreur lors de l\'enregistrement')
      }

      toast.success(editingRule ? 'Règle modifiée' : 'Règle créée')
      handleCloseDialog()
      onSave()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "La règle n'a pas été enregistrée. Réessayez.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {editingRule ? 'Modifier la règle' : 'Nouvelle règle'}
          </DialogTitle>
          <DialogDescription>
            {editingRule
              ? 'Modifiez les conditions et les lignes de l’écriture proposée.'
              : 'Une règle reconnaît des transactions (conditions) et propose leur écriture (lignes).'}
          </DialogDescription>
        </DialogHeader>
        
        <Tabs defaultValue="general" className="w-full">
          <TabsList className="w-full justify-start overflow-x-auto sm:justify-center">
            <TabsTrigger value="general">Général</TabsTrigger>
            <TabsTrigger value="conditions">Conditions</TabsTrigger>
            <TabsTrigger value="template">Écriture</TabsTrigger>
            <TabsTrigger value="simulation">Simulation</TabsTrigger>
          </TabsList>
          
          <TabsContent value="general" className="space-y-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nom *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nom de la règle"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Description de la règle"
                />
              </div>
              
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="priority">Priorité</Label>
                  <Input
                    id="priority"
                    type="number"
                    inputMode="numeric"
                    value={priority}
                    onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="journalCode">Journal</Label>
                  <Select value={journalCode} onValueChange={setJournalCode}>
                    <SelectTrigger id="journalCode">
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
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="defaultVatAccount">Compte de TVA par défaut</Label>
                <AccountCombobox
                  accounts={accounts}
                  value={defaultVatAccountId || 'none'}
                  onValueChange={(value) => setDefaultVatAccountId(value === 'none' ? '' : value)}
                  placeholder="Sélectionner un compte"
                  showNoneOption
                  codePrefix="44"
                />
              </div>
              
              <div className="flex items-start gap-2">
                <Checkbox
                  id="enabled"
                  checked={enabled}
                  onCheckedChange={(checked) => setEnabled(checked as boolean)}
                  aria-describedby="enabled-hint"
                />
                <div className="space-y-1">
                  <Label htmlFor="enabled">Règle active</Label>
                  <p id="enabled-hint" className="text-muted-foreground text-xs">
                    Une règle active est proposée sur les transactions qui remplissent toutes ses conditions et appliquée par
                    «&nbsp;Appliquer les règles&nbsp;» sur la page Rapprochement.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Checkbox
                  id="autoCreate"
                  checked={autoCreate}
                  onCheckedChange={(checked) => setAutoCreate(checked as boolean)}
                  aria-describedby="autoCreate-hint"
                />
                <div className="space-y-1">
                  <Label htmlFor="autoCreate">Créer automatiquement l&apos;écriture</Label>
                  <p id="autoCreate-hint" className="text-muted-foreground text-xs">
                    Coché, chaque actualisation crée l&apos;écriture (en brouillon) sans clic&nbsp;; sinon, la règle reste une suggestion.
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="conditions" className="space-y-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Conditions</Label>
                <Button size="sm" onClick={handleAddCondition}>
                  <Plus aria-hidden />
                  Ajouter une condition
                </Button>
              </div>
              
              {conditions.length === 0 ? (
                <Alert>
                  <AlertDescription>
                    Aucune condition définie. Ajoutez au moins une condition pour que la règle fonctionne.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-3">
                  {conditions.map((condition) => (
                    <Card key={condition.id}>
                      <CardContent className="pt-4">
                        <div className="flex items-start gap-2">
                          <GripVertical className="h-5 w-5 text-muted-foreground mt-2" />
                          <div className="grid flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            <div className="space-y-1">
                              <Label className="text-xs">Type</Label>
                              <Select
                                value={condition.conditionType || 'label'}
                                onValueChange={(value) => {
                                  const restrictedTypes = ['side', 'operationType', 'status', 'attachment']
                                  const oldType = condition.conditionType
                                  const updates: Partial<Condition> = {
                                    conditionType: value,
                                  }
                                  
                                  // Reset operator if necessary
                                  if (restrictedTypes.includes(value) && condition.operator !== 'equals') {
                                    updates.operator = 'equals'
                                  }
                                  
                                  // Reset values if changing type
                                  if (value !== oldType) {
                                    updates.value = ''
                                    updates.value2 = ''
                                  }
                                  
                                  handleUpdateConditionMultiple(condition.id, updates)
                                }}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="label">Libellé</SelectItem>
                                  <SelectItem value="reference">Référence</SelectItem>
                                  <SelectItem value="counterparty">Contrepartie</SelectItem>
                                  <SelectItem value="category">Catégorie</SelectItem>
                                  <SelectItem value="cashflowCategory">Catégorie de flux</SelectItem>
                                  <SelectItem value="cashflowSubcategory">Sous-catégorie</SelectItem>
                                  <SelectItem value="operationType">Type d'opération</SelectItem>
                                  <SelectItem value="side">Sens (débit/crédit)</SelectItem>
                                  <SelectItem value="status">Statut</SelectItem>
                                  <SelectItem value="attachment">Justificatif</SelectItem>
                                  <SelectItem value="amount">Montant</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            
                            <div className="space-y-1">
                              <Label className="text-xs">Opérateur</Label>
                              <Select
                                value={condition.operator}
                                onValueChange={(value) => handleUpdateCondition(condition.id, 'operator', value)}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {condition.conditionType === 'amount' ? (
                                    <>
                                      <SelectItem value="equals">Égal à</SelectItem>
                                      <SelectItem value="gt">Supérieur à</SelectItem>
                                      <SelectItem value="gte">Supérieur ou égal à</SelectItem>
                                      <SelectItem value="lt">Inférieur à</SelectItem>
                                      <SelectItem value="lte">Inférieur ou égal à</SelectItem>
                                      <SelectItem value="between">Entre</SelectItem>
                                    </>
                                  ) : ['side', 'operationType', 'status', 'attachment'].includes(condition.conditionType) ? (
                                    <SelectItem value="equals">Égal à</SelectItem>
                                  ) : (
                                    <>
                                      <SelectItem value="equals">Égal à</SelectItem>
                                      <SelectItem value="contains">Contient</SelectItem>
                                      <SelectItem value="startsWith">Commence par</SelectItem>
                                      <SelectItem value="regex">Expression régulière</SelectItem>
                                    </>
                                  )}
                                </SelectContent>
                              </Select>
                            </div>
                            
                            <div className="space-y-1">
                              <Label className="text-xs">Valeur</Label>
                              {condition.conditionType === 'side' ? (
                                <Select
                                  value={condition.value || ''}
                                  onValueChange={(value) => handleUpdateCondition(condition.id, 'value', value)}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Sélectionner" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="debit">Débit</SelectItem>
                                    <SelectItem value="credit">Crédit</SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : condition.conditionType === 'status' ? (
                                <Select
                                  value={condition.value || ''}
                                  onValueChange={(value) => handleUpdateCondition(condition.id, 'value', value)}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Sélectionner" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="completed">Complétée</SelectItem>
                                    <SelectItem value="pending">En attente</SelectItem>
                                    <SelectItem value="declined">Refusée</SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : condition.conditionType === 'attachment' ? (
                                <Select
                                  value={condition.value || ''}
                                  onValueChange={(value) => handleUpdateCondition(condition.id, 'value', value)}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Sélectionner" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="yes">Avec justificatif</SelectItem>
                                    <SelectItem value="no">Sans justificatif</SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : condition.conditionType === 'operationType' ? (
                                <Select
                                  value={condition.value || ''}
                                  onValueChange={(value) => handleUpdateCondition(condition.id, 'value', value)}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Sélectionner" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="card">Carte</SelectItem>
                                    <SelectItem value="transfer">Virement</SelectItem>
                                    <SelectItem value="direct_debit">Prélèvement</SelectItem>
                                    <SelectItem value="sepa">SEPA</SelectItem>
                                    <SelectItem value="check">Chèque</SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : condition.operator === 'between' ? (
                                <div className="flex gap-1">
                                  <Input
                                    value={condition.value}
                                    onChange={(e) => handleUpdateCondition(condition.id, 'value', e.target.value)}
                                    placeholder={condition.conditionType === 'amount' ? 'Montant min (€)' : 'Valeur min'}
                                    className="flex-1"
                                    type={condition.conditionType === 'amount' ? 'number' : 'text'}
                                    step={condition.conditionType === 'amount' ? '0.01' : undefined}
                                  />
                                  <Input
                                    value={condition.value2 || ''}
                                    onChange={(e) => handleUpdateCondition(condition.id, 'value2', e.target.value)}
                                    placeholder={condition.conditionType === 'amount' ? 'Montant max (€)' : 'Valeur max'}
                                    className="flex-1"
                                    type={condition.conditionType === 'amount' ? 'number' : 'text'}
                                    step={condition.conditionType === 'amount' ? '0.01' : undefined}
                                  />
                                </div>
                              ) : (
                                <Input
                                  value={condition.value}
                                  onChange={(e) => handleUpdateCondition(condition.id, 'value', e.target.value)}
                                  placeholder={
                                    condition.conditionType === 'label' ? 'Ex\u00a0: Qonto, Stripe...' :
                                    condition.conditionType === 'reference' ? 'Ex\u00a0: REF-12345...' :
                                    condition.conditionType === 'counterparty' ? 'Ex\u00a0: Insify, Microsoft...' :
                                    condition.conditionType === 'category' ? 'Ex\u00a0: insurance, software...' :
                                    condition.conditionType === 'cashflowCategory' ? 'Ex\u00a0: Dépenses administratives...' :
                                    condition.conditionType === 'cashflowSubcategory' ? 'Ex\u00a0: Frais d\'assurance...' :
                                    condition.conditionType === 'status' ? 'Statut (ex. completed)' :
                                    condition.conditionType === 'attachment' ? 'Justificatif' :
                                    condition.conditionType === 'amount' ? 'Montant (€)' :
                                    'Valeur'
                                  }
                                  type={condition.conditionType === 'amount' ? 'number' : 'text'}
                                  step={condition.conditionType === 'amount' ? '0.01' : undefined}
                                />
                              )}
                            </div>
                            
                            <div className="flex items-end">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="Supprimer la condition"
                                title="Supprimer la condition"
                                onClick={() => handleRemoveCondition(condition.id)}
                              >
                                <X aria-hidden />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
          
          <TabsContent value="template" className="space-y-4">
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Label>Lignes d'écriture</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground mr-1">Modèles&nbsp;:</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleApplyIntracomPurchaseTemplate}
                  >
                    Achat intracommunautaire
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleApplyImportPurchaseTemplate}
                  >
                    Achat à l'import
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleApplyPurchaseNoChargeTemplate}
                  >
                    Achat
                  </Button>
                  <Button size="sm" onClick={handleAddEntryLine}>
                    <Plus aria-hidden />
                    Ajouter une ligne
                  </Button>
                </div>
              </div>

              {entryLines.length === 0 ? (
                <Alert>
                  <AlertDescription>
                    Aucune ligne d'écriture définie. Ajoutez au moins une ligne pour définir l'écriture proposée.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-3">
                  {entryLines.map((line) => (
                    <Card key={line.id}>
                      <CardContent className="pt-4">
                        <div className="flex items-start gap-2">
                          <GripVertical className="h-5 w-5 text-muted-foreground mt-2" />
                          <div className="flex-1 space-y-3">
                            <div className="space-y-1">
                              <Label className="text-xs">
                                {(line.vatType === 'intracom' || line.vatType === 'import')
                                  ? 'Compte de charge ou produit (HT) *'
                                  : 'Compte *'}
                              </Label>
                              <AccountCombobox
                                accounts={accounts}
                                value={line.accountId || 'none'}
                                onValueChange={(value) => handleUpdateEntryLine(line.id, 'accountId', value === 'none' ? '' : value)}
                                placeholder={(line.vatType === 'intracom' || line.vatType === 'import')
                                  ? (line.vatType === 'intracom' ? 'Ex. 6x (charges) ou 70x (ventes)' : 'Ex. 6x (charges)')
                                  : 'Sélectionner un compte'}
                                showNoneOption
                                noneOptionLabel="Aucun compte"
                              />
                            </div>

                            <div className="grid gap-2 sm:grid-cols-2">
                              <div className="space-y-1">
                                <Label className="text-xs">Type de ligne</Label>
                                <Select
                                  value={line.lineType}
                                  onValueChange={(value) => handleUpdateEntryLine(line.id, 'lineType', value as EntryLine['lineType'])}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="debit">Débit</SelectItem>
                                    <SelectItem value="credit">Crédit</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              
                              <div className="space-y-1">
                                <Label className="text-xs">Type de montant</Label>
                                <Select
                                  value={line.amountType}
                                  onValueChange={(value) => handleUpdateEntryLine(line.id, 'amountType', value as EntryLine['amountType'])}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="full">Montant complet</SelectItem>
                                    <SelectItem value="percentage">Pourcentage</SelectItem>
                                    <SelectItem value="fixed">Montant fixe</SelectItem>
                                    <SelectItem value="remaining">Reste</SelectItem>
                                    <SelectItem value="ht">HT</SelectItem>
                                    <SelectItem value="ttc">TTC</SelectItem>
                                    <SelectItem value="vat">TVA</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            
                            {(line.amountType === 'percentage' || line.amountType === 'fixed') && (
                              <div className="space-y-1">
                                <Label className="text-xs">
                                  {line.amountType === 'percentage' ? 'Pourcentage' : 'Montant fixe'}
                                </Label>
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  value={line.amountValue || ''}
                                  onChange={(e) => handleUpdateEntryLine(line.id, 'amountValue', parseFloat(e.target.value) || undefined)}
                                  placeholder={line.amountType === 'percentage' ? 'Ex\u00a0: 50 pour 50%' : 'Ex\u00a0: 100.00'}
                                />
                              </div>
                            )}
                            
                            <div className="space-y-1">
                              <Label className="text-xs">Description</Label>
                              <Input
                                value={line.description || ''}
                                onChange={(e) => handleUpdateEntryLine(line.id, 'description', e.target.value)}
                                placeholder="Description de la ligne"
                              />
                            </div>
                            
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5">
                                  <Label className="text-xs">Type de TVA</Label>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          type="button"
                                          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-muted-foreground/30 bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                                          aria-label="Explication des types de TVA"
                                        >
                                          <Info className="h-3 w-3" />
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent side="right" className="max-w-xs">
                                        <p className="font-medium mb-1">Comptabilisation de la TVA</p>
                                        <ul className="text-xs space-y-0.5 list-disc list-inside">
                                          <li><strong>Collectée</strong> : crédit (vente) ou débit (avoir client), ex. 44571</li>
                                          <li><strong>Déductible</strong> : débit (ex. 44566)</li>
                                          <li><strong>Intracommunautaire</strong> : débit, ex. 4452 (TVA due intracommunautaire / autoliquidation)</li>
                                          <li><strong>Import</strong> : débit, ex. 44566 (TVA déductible à l&apos;import)</li>
                                          <li><strong>Exonérée</strong> : pas de ligne TVA</li>
                                          <li><strong>Autoliquidation</strong> : pas de ligne TVA (marquage uniquement)</li>
                                        </ul>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </div>
                                <Select
                                  value={line.vatType || 'none'}
                                  onValueChange={(value) => handleUpdateEntryLine(line.id, 'vatType', value as EntryLine['vatType'])}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">Aucune</SelectItem>
                                    <SelectItem value="collectible">Collectée</SelectItem>
                                    <SelectItem value="deductible">Déductible</SelectItem>
                                    <SelectItem value="intracom">Intracommunautaire</SelectItem>
                                    <SelectItem value="import">Import</SelectItem>
                                    <SelectItem value="exempt">Exonérée</SelectItem>
                                    <SelectItem value="reverse_charge">Autoliquidation</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              
                              {line.vatType && line.vatType !== 'none' && line.vatType !== 'intracom' && line.vatType !== 'import' && (
                                <>
                                  <div className="space-y-1">
                                    <Label className="text-xs">Source du taux</Label>
                                    <Select
                                      value={line.vatRateSource ?? 'fixed'}
                                      onValueChange={(value: 'fixed' | 'transaction') =>
                                        handleUpdateEntryLine(line.id, 'vatRateSource', value)
                                      }
                                    >
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="fixed">Taux fixe</SelectItem>
                                        <SelectItem value="transaction">
                                          Détecté (transaction)
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  {(line.vatRateSource ?? 'fixed') === 'fixed' ? (
                                    <div className="space-y-1">
                                      <Label className="text-xs">Taux TVA (%)</Label>
                                      <Input
                                        type="number"
                                        inputMode="decimal"
                                        step="0.01"
                                        value={line.vatRate || ''}
                                        onChange={(e) =>
                                          handleUpdateEntryLine(
                                            line.id,
                                            'vatRate',
                                            parseFloat(e.target.value) || undefined
                                          )
                                        }
                                        placeholder="Ex&nbsp;: 20"
                                      />
                                    </div>
                                  ) : (
                                    <p className="text-xs text-muted-foreground">
                                      Les montants HT et TVA seront pris depuis la transaction (ex. détection Qonto).
                                    </p>
                                  )}
                                </>
                              )}
                            </div>
                            
                            {(line.vatType === 'intracom' || line.vatType === 'import') && (
                              <div className="grid grid-cols-1 gap-3">
                                <p className="text-xs font-medium text-muted-foreground">
                                  Taux et comptes TVA (débit + crédit)
                                </p>
                                <div className="space-y-1">
                                  <Label className="text-xs">Source du taux</Label>
                                  <Select
                                    value={line.vatRateSource ?? 'fixed'}
                                    onValueChange={(value: 'fixed' | 'transaction') =>
                                      handleUpdateEntryLine(line.id, 'vatRateSource', value)
                                    }
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="fixed">Taux fixe</SelectItem>
                                      <SelectItem value="transaction">
                                        Détecté (transaction)
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                {(line.vatRateSource ?? 'fixed') === 'fixed' ? (
                                  <div className="space-y-1">
                                    <Label className="text-xs">Taux TVA (%)</Label>
                                    <Input
                                      type="number"
                                      inputMode="decimal"
                                      step="0.01"
                                      value={line.vatRate || ''}
                                      onChange={(e) =>
                                        handleUpdateEntryLine(
                                          line.id,
                                          'vatRate',
                                          parseFloat(e.target.value) || undefined
                                        )
                                      }
                                      placeholder="Ex&nbsp;: 20"
                                    />
                                  </div>
                                ) : (
                                  <p className="text-xs text-muted-foreground">
                                    Les montants HT et TVA seront pris depuis la transaction (ex. Qonto).
                                  </p>
                                )}
                                <div className="space-y-1">
                                  <Label className="text-xs">Compte TVA au débit *</Label>
                                  <AccountCombobox
                                    accounts={accounts}
                                    value={line.vatAccountId || defaultVatAccountId || 'none'}
                                    onValueChange={(value) => handleUpdateEntryLine(line.id, 'vatAccountId', value === 'none' ? undefined : value)}
                                    placeholder={line.vatType === 'intracom' ? 'Ex. 445662 - TVA déductible intracommunautaire' : 'Ex. 44566 - TVA déductible'}
                                    showNoneOption
                                    noneOptionLabel="Aucun compte"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Compte TVA au crédit *</Label>
                                  <AccountCombobox
                                    accounts={accounts}
                                    value={line.vatAccount2Id || 'none'}
                                    onValueChange={(value) => handleUpdateEntryLine(line.id, 'vatAccount2Id', value === 'none' ? undefined : value)}
                                    placeholder={line.vatType === 'intracom' ? 'Ex. 4452 - TVA due intracommunautaire' : 'Ex. 4452 si applicable'}
                                    showNoneOption
                                    noneOptionLabel="Aucun compte"
                                  />
                                </div>
                              </div>
                            )}
                            
                            {line.vatType && line.vatType !== 'none' && line.vatType !== 'intracom' && line.vatType !== 'import' && (
                              <>
                                <div className="space-y-1">
                                  <Label className="text-xs">Compte TVA</Label>
                                  <AccountCombobox
                                    accounts={accounts}
                                    value={line.vatAccountId || defaultVatAccountId || 'none'}
                                    onValueChange={(value) => handleUpdateEntryLine(line.id, 'vatAccountId', value === 'none' ? undefined : value)}
                                    placeholder="Par défaut"
                                    showNoneOption
                                  />
                                </div>
                                
                                {line.vatType === 'collectible' && (
                                  <div className="flex items-center space-x-2">
                                    <Checkbox
                                      checked={line.vatOnDebit || false}
                                      onCheckedChange={(checked) => handleUpdateEntryLine(line.id, 'vatOnDebit', checked === true)}
                                    />
                                    <Label className="text-xs">TVA sur débit</Label>
                                  </div>
                                )}
                              </>
                            )}
                            
                            <div className="flex justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveEntryLine(line.id)}
                              >
                                <X aria-hidden />
                                Supprimer la ligne
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
          
          <TabsContent value="simulation" className="space-y-4">
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  Testez la règle avec une transaction exemple pour voir les écritures qui seront créées.
                </AlertDescription>
              </Alert>
              
              {entryLines.length > 0 ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="simAmount">Montant</Label>
                      <Input
                        id="simAmount"
                        type="number"
                        inputMode="decimal"
                        value={simulationAmount}
                        onChange={(e) => setSimulationAmount(e.target.value)}
                        placeholder="100.00"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="simSide">Sens</Label>
                      <Select value={simulationSide} onValueChange={(value) => setSimulationSide(value as 'debit' | 'credit')}>
                        <SelectTrigger id="simSide">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="debit">Débit</SelectItem>
                          <SelectItem value="credit">Crédit</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <Button onClick={handleSimulate} loading={loadingSimulation}>
                    <PlayCircle aria-hidden />
                    Simuler
                  </Button>
                  
                  {simulation && (
                    <EntrySimulation
                      entryLines={simulation.entryLines}
                      totalDebit={simulation.totalDebit}
                      totalCredit={simulation.totalCredit}
                      balanced={simulation.balanced}
                    />
                  )}
                </>
              ) : (
                <Alert>
                  <AlertDescription>
                    Veuillez d'abord définir au moins une ligne d'écriture dans l'onglet « Écriture » pour pouvoir simuler.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </TabsContent>
        </Tabs>
        
        <DialogFooter>
          <Button variant="outline" onClick={handleCloseDialog}>
            Annuler
          </Button>
          {simulation !== null && !simulation.balanced ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button disabled>
                      {editingRule ? 'Enregistrer' : 'Créer'}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Exécutez une simulation équilibrée pour pouvoir enregistrer
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <Button onClick={handleSave}>
              {editingRule ? 'Enregistrer' : 'Créer'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
