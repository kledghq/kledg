'use client'

import { Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { compileRulePattern } from '@/lib/transactions/rule-regex'
import {
  CONDITION_TYPES,
  CONDITION_VALUE_OPTIONS,
  LIST_CONDITION_TYPES,
  conditionPlaceholder,
  describeCondition,
  operatorsOf,
  type Condition,
} from './rule-form'
import { RuleSection } from './rule-section'

/**
 * Conditions of a rule, one row each: field, operator, value. A transaction
 * is recognised when every condition holds (AND), said once in the section
 * description; rows are joined by "et".
 */
export function RuleConditions({
  conditions,
  onChange,
  patternIssue,
}: {
  conditions: Condition[]
  onChange: (conditions: Condition[]) => void
  /** Saved regex the matcher refuses (GET /api/transaction-rules patternIssues). */
  patternIssue?: string
}) {
  const update = (id: string, updates: Partial<Condition>) =>
    onChange(conditions.map((c) => (c.id === id ? { ...c, ...updates } : c)))

  const changeType = (condition: Condition, value: string) => {
    const updates: Partial<Condition> = { conditionType: value }
    // Lists compare with "equals" only
    if (LIST_CONDITION_TYPES.includes(value) && condition.operator !== 'equals') updates.operator = 'equals'
    if (value !== condition.conditionType) {
      updates.value = ''
      updates.value2 = ''
    }
    update(condition.id, updates)
  }

  const add = () =>
    onChange([...conditions, { id: `temp-${Date.now()}`, conditionType: 'label', operator: 'contains', value: '' }])

  return (
    <RuleSection
      id="rule-conditions"
      title="Conditions"
      description="Une transaction est reconnue quand toutes les conditions sont remplies."
    >
      {patternIssue ? (
        <Alert>
          <AlertDescription>{patternIssue}</AlertDescription>
        </Alert>
      ) : null}

      {conditions.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Aucune condition définie. Ajoutez au moins une condition pour que la règle fonctionne.
        </p>
      ) : (
        <ol className="space-y-2" aria-label="Conditions de la règle">
          <li aria-hidden className="text-muted-foreground hidden gap-2 text-xs sm:grid sm:grid-cols-[10rem_11rem_minmax(0,1fr)_2.25rem]">
            <span>Champ</span>
            <span>Opérateur</span>
            <span>Valeur</span>
          </li>
          {conditions.map((condition, index) => {
            const n = index + 1
            const sentence = describeCondition(condition)
            const regexError =
              condition.operator === 'regex' && condition.value ? compileRulePattern(condition.value) : null
            return (
              <li key={condition.id} data-testid="rule-condition" className="space-y-1">
                {index > 0 ? (
                  <span aria-hidden className="text-muted-foreground block text-xs font-medium">
                    et
                  </span>
                ) : null}
                <div
                  role="group"
                  aria-label={`Condition ${n}${sentence ? ` : ${sentence}` : ''}`}
                  className="grid grid-cols-[minmax(0,1fr)_2.25rem] gap-2 sm:grid-cols-[10rem_11rem_minmax(0,1fr)_2.25rem]"
                >
                  <Select value={condition.conditionType || 'label'} onValueChange={(value) => changeType(condition, value)}>
                    <SelectTrigger aria-label={`Champ de la condition ${n}`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITION_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={condition.operator} onValueChange={(value) => update(condition.id, { operator: value })}>
                    <SelectTrigger aria-label={`Opérateur de la condition ${n}`} className="col-start-1 w-full sm:col-start-auto">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {operatorsOf(condition.conditionType).map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="col-start-1 min-w-0 sm:col-start-auto">
                    <ConditionValue condition={condition} n={n} onChange={(updates) => update(condition.id, updates)} />
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="col-start-2 row-start-1"
                    aria-label={`Supprimer la condition ${n}`}
                    title="Supprimer la condition"
                    onClick={() => onChange(conditions.filter((c) => c.id !== condition.id))}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
                {regexError && !regexError.ok ? (
                  <p className="text-muted-foreground text-xs" role="note">
                    {regexError.message}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ol>
      )}

      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus aria-hidden />
        Ajouter une condition
      </Button>
    </RuleSection>
  )
}

function ConditionValue({
  condition,
  n,
  onChange,
}: {
  condition: Condition
  n: number
  onChange: (updates: Partial<Condition>) => void
}) {
  const options = CONDITION_VALUE_OPTIONS[condition.conditionType]
  const isAmount = condition.conditionType === 'amount'
  if (options) {
    return (
      <Select value={condition.value || ''} onValueChange={(value) => onChange({ value })}>
        <SelectTrigger aria-label={`Valeur de la condition ${n}`} className="w-full">
          <SelectValue placeholder="Sélectionner" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (condition.operator === 'between') {
    return (
      <div className="flex gap-2">
        <Input
          aria-label={`Minimum de la condition ${n}`}
          value={condition.value}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder={isAmount ? 'Montant min (€)' : 'Valeur min'}
          type={isAmount ? 'number' : 'text'}
          inputMode={isAmount ? 'decimal' : undefined}
          step={isAmount ? '0.01' : undefined}
        />
        <Input
          aria-label={`Maximum de la condition ${n}`}
          value={condition.value2 || ''}
          onChange={(e) => onChange({ value2: e.target.value })}
          placeholder={isAmount ? 'Montant max (€)' : 'Valeur max'}
          type={isAmount ? 'number' : 'text'}
          inputMode={isAmount ? 'decimal' : undefined}
          step={isAmount ? '0.01' : undefined}
        />
      </div>
    )
  }
  return (
    <Input
      aria-label={`Valeur de la condition ${n}`}
      value={condition.value}
      onChange={(e) => onChange({ value: e.target.value })}
      placeholder={conditionPlaceholder(condition.conditionType)}
      type={isAmount ? 'number' : 'text'}
      inputMode={isAmount ? 'decimal' : undefined}
      step={isAmount ? '0.01' : undefined}
    />
  )
}
