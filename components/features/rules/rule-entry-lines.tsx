'use client'

import { CheckCircle2, Info, Plus, X, XCircle } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { AccountCombobox } from '@/components/features/accounting/account-combobox'
import { Amount, Field, HelpTip } from '@/components/shared'
import { docsUrl } from '@/lib/docs-links'
import {
  VAT_TYPES,
  defaultVatRateSource,
  hasVat,
  isSelfAssessed,
  type Account,
  type EntryLine,
  type VatRateSource,
  type VatType,
} from './rule-form'
import { RuleSection } from './rule-section'

/** Balance of the entry the preview computed for its example transaction. */
export type BalanceCheck =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'balanced' }
  | { status: 'gap'; gap: number; hasBankLine: boolean }

/**
 * "Écriture proposée": the lines of the entry a rule books, with the VAT of
 * each line in view (detected by the bank or entered rate) and the balance
 * of the entry computed by the preview.
 */
export function RuleEntryLines({
  lines,
  onChange,
  accounts,
  defaultVatAccountId,
  onDefaultVatAccountChange,
  bankProvidesVat,
  balance,
}: {
  lines: EntryLine[]
  onChange: (lines: EntryLine[]) => void
  accounts: Account[]
  defaultVatAccountId: string
  onDefaultVatAccountChange: (id: string) => void
  /** A connected bank provides the VAT of its transactions (Qonto). */
  bankProvidesVat: boolean
  balance: BalanceCheck
}) {
  const update = (id: string, updates: Partial<EntryLine>) =>
    onChange(lines.map((l) => (l.id === id ? { ...l, ...updates } : l)))

  const changeVatType = (line: EntryLine, vatType: VatType) => {
    const updates: Partial<EntryLine> = { vatType }
    // A line that starts carrying VAT takes the source that fits the company's bank
    if (!hasVat(line) && vatType !== 'none') updates.vatRateSource = defaultVatRateSource(vatType, bankProvidesVat)
    update(line.id, updates)
  }

  const add = () =>
    onChange([
      ...lines,
      { id: `temp-${Date.now()}`, accountId: '', lineType: 'debit', amountType: 'full', order: lines.length, vatType: 'none' },
    ])

  const remove = (id: string) => onChange(lines.filter((l) => l.id !== id).map((l, idx) => ({ ...l, order: idx })))

  /** Account by code (exact, else the first sub-account). Used by the presets. */
  const findAccountByCode = (codePrefix: string): string => {
    const exact = accounts.find((a) => a.code === codePrefix)
    if (exact) return exact.id
    return accounts.find((a) => a.code.startsWith(codePrefix) && a.code.length > codePrefix.length)?.id ?? ''
  }

  /** Preset: Achat intracommunautaire (2 lignes TVA: débit 445662, crédit 4452). */
  const applyIntracomPurchase = () => {
    const baseOrder = lines.length
    const vatAccountDebit = findAccountByCode('445662') || findAccountByCode('44566')
    const vatAccount2 = findAccountByCode('4452')
    onChange([
      ...lines,
      { id: `temp-${Date.now()}-1`, accountId: '', lineType: 'credit', amountType: 'full', order: baseOrder, vatType: 'none', description: 'Fournisseur UE' },
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
      'Modèle "Achat intracommunautaire" ajouté. Associez le compte de charge (6x), le compte TVA au débit (ex. 445662) et au crédit (ex. 4452).',
    )
  }

  /** Preset: Achat à l'import (banque 512101, TVA débit 445663, TVA crédit 445713 ; compte de charge non renseigné). */
  const applyImportPurchase = () => {
    const baseOrder = lines.length
    const bankAccount = findAccountByCode('512101') || findAccountByCode('512')
    const vatAccountDebit = findAccountByCode('445663') || findAccountByCode('44566')
    const vatAccountCredit = findAccountByCode('445713') || findAccountByCode('44571')
    onChange([
      ...lines,
      { id: `temp-${Date.now()}-1`, accountId: bankAccount, lineType: 'credit', amountType: 'full', order: baseOrder, vatType: 'none', description: '' },
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
        description: "Achat à l'import HT + TVA déductible",
      },
    ])
    toast.success('Modèle "Achat à l\'import" ajouté. Associez le compte de charge (6x) si besoin.')
  }

  /** Preset: Achat avec TVA déductible (banque 512 + TVA 44566 ; compte de charge à associer). */
  const applyPurchase = () => {
    const baseOrder = lines.length
    const bankAccount = findAccountByCode('512101') || findAccountByCode('512')
    const vatAccount = findAccountByCode('44566') || findAccountByCode('4456')
    const source = defaultVatRateSource('deductible', bankProvidesVat)
    onChange([
      ...lines,
      { id: `temp-${Date.now()}-1`, accountId: bankAccount, lineType: 'credit', amountType: 'full', order: baseOrder, vatType: 'none', description: '' },
      {
        id: `temp-${Date.now()}-2`,
        accountId: '',
        lineType: 'debit',
        amountType: 'full',
        order: baseOrder + 1,
        vatType: 'deductible',
        // Detected VAT when the bank provides it; 20 % stays the rate when it detects none
        ...(source === 'transaction' ? { vatRateSource: source } : {}),
        vatRate: 20,
        vatAccountId: vatAccount || undefined,
        description: '',
      },
    ])
    toast.success('Modèle "Achat" ajouté. Associez le compte de charge (6x) et le compte TVA (44566) si besoin.')
  }

  const showDefaultVatAccount = lines.some(hasVat) || !!defaultVatAccountId

  return (
    <RuleSection
      id="rule-entry"
      title="Écriture proposée"
      description="Les lignes passées pour chaque transaction reconnue, en brouillon à valider dans Écritures."
    >
      {lines.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Aucune ligne d&apos;écriture définie. Ajoutez au moins une ligne pour définir l&apos;écriture proposée.
        </p>
      ) : (
        <ol className="space-y-3" aria-label="Lignes de l'écriture">
          {lines.map((line, index) => (
            <EntryLineRow
              key={line.id}
              n={index + 1}
              line={line}
              accounts={accounts}
              defaultVatAccountId={defaultVatAccountId}
              bankProvidesVat={bankProvidesVat}
              onUpdate={(updates) => update(line.id, updates)}
              onVatTypeChange={(vatType) => changeVatType(line, vatType)}
              onRemove={() => remove(line.id)}
            />
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus aria-hidden />
          Ajouter une ligne
        </Button>
        <span className="text-muted-foreground ml-1 text-xs">Modèles&nbsp;:</span>
        <Button type="button" size="sm" variant="ghost" onClick={applyIntracomPurchase}>
          Achat intracommunautaire
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={applyImportPurchase}>
          Achat à l&apos;import
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={applyPurchase}>
          Achat
        </Button>
      </div>

      {showDefaultVatAccount ? (
        <Field
          label="Compte de TVA par défaut"
          optional
          hint="Pris par les lignes avec TVA qui n’ont pas leur propre compte de TVA."
          className="max-w-md"
        >
          <AccountCombobox
            id="rule-default-vat-account"
            accounts={accounts}
            value={defaultVatAccountId || 'none'}
            onValueChange={(value) => onDefaultVatAccountChange(value === 'none' ? '' : value)}
            placeholder="Sélectionner un compte"
            showNoneOption
            codePrefix="44"
          />
        </Field>
      ) : null}

      {lines.length > 0 ? <BalanceMessage balance={balance} /> : null}
    </RuleSection>
  )
}

function EntryLineRow({
  n,
  line,
  accounts,
  defaultVatAccountId,
  bankProvidesVat,
  onUpdate,
  onVatTypeChange,
  onRemove,
}: {
  n: number
  line: EntryLine
  accounts: Account[]
  defaultVatAccountId: string
  bankProvidesVat: boolean
  onUpdate: (updates: Partial<EntryLine>) => void
  onVatTypeChange: (vatType: VatType) => void
  onRemove: () => void
}) {
  const id = `rule-line-${line.id}`
  const selfAssessed = isSelfAssessed(line)
  return (
    <li data-testid="rule-entry-line" className="space-y-4 rounded-md border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Ligne {n}</h3>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Supprimer la ligne ${n}`}
          title="Supprimer la ligne"
          onClick={onRemove}
        >
          <X aria-hidden />
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={selfAssessed ? 'Compte de charge ou produit (HT)' : 'Compte'} required className="sm:col-span-2">
          <AccountCombobox
            id={`${id}-account`}
            accounts={accounts}
            value={line.accountId || 'none'}
            onValueChange={(value) => onUpdate({ accountId: value === 'none' ? '' : value })}
            placeholder={
              selfAssessed
                ? line.vatType === 'intracom'
                  ? 'Ex. 6x (charges) ou 70x (ventes)'
                  : 'Ex. 6x (charges)'
                : 'Sélectionner un compte'
            }
            showNoneOption
            noneOptionLabel="Aucun compte"
          />
        </Field>

        <Field label="Sens" htmlFor={`${id}-side`}>
          <Select value={line.lineType} onValueChange={(value) => onUpdate({ lineType: value as EntryLine['lineType'] })}>
            <SelectTrigger id={`${id}-side`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="debit">Débit</SelectItem>
              <SelectItem value="credit">Crédit</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="Montant" htmlFor={`${id}-amount-type`}>
          <Select value={line.amountType} onValueChange={(value) => onUpdate({ amountType: value as EntryLine['amountType'] })}>
            <SelectTrigger id={`${id}-amount-type`} className="w-full">
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
        </Field>

        {line.amountType === 'percentage' || line.amountType === 'fixed' ? (
          <Field label={line.amountType === 'percentage' ? 'Pourcentage' : 'Montant fixe'}>
            <Input
              id={`${id}-amount-value`}
              type="number"
              inputMode="decimal"
              value={line.amountValue || ''}
              onChange={(e) => onUpdate({ amountValue: parseFloat(e.target.value) || undefined })}
              placeholder={line.amountType === 'percentage' ? 'Ex : 50 pour 50%' : 'Ex : 100.00'}
            />
          </Field>
        ) : null}

        <Field label="Libellé" optional className={line.amountType === 'percentage' || line.amountType === 'fixed' ? undefined : 'sm:col-span-2'}>
          <Input
            id={`${id}-description`}
            value={line.description || ''}
            onChange={(e) => onUpdate({ description: e.target.value })}
            placeholder="Description de la ligne"
          />
        </Field>
      </div>

      <VatControls
        id={id}
        line={line}
        accounts={accounts}
        defaultVatAccountId={defaultVatAccountId}
        bankProvidesVat={bankProvidesVat}
        onUpdate={onUpdate}
        onVatTypeChange={onVatTypeChange}
      />
    </li>
  )
}

/**
 * VAT of a line, in view: its type, then where the VAT comes from (the bank
 * or an entered rate) and the accounts it is booked on.
 */
function VatControls({
  id,
  line,
  accounts,
  defaultVatAccountId,
  bankProvidesVat,
  onUpdate,
  onVatTypeChange,
}: {
  id: string
  line: EntryLine
  accounts: Account[]
  defaultVatAccountId: string
  bankProvidesVat: boolean
  onUpdate: (updates: Partial<EntryLine>) => void
  onVatTypeChange: (vatType: VatType) => void
}) {
  const source: VatRateSource = line.vatRateSource ?? 'fixed'
  const selfAssessed = isSelfAssessed(line)
  return (
    <div className="bg-muted/40 space-y-4 rounded-md p-3" data-testid="rule-line-vat">
      <Field
        label="TVA"
        htmlFor={`${id}-vat-type`}
        className="max-w-xs"
        help={
          <HelpTip term="TVA de la ligne" docsHref={docsUrl('vat')}>
            Collectée&nbsp;: ventes (ex. 44571). Déductible&nbsp;: achats (ex. 44566). Intracommunautaire et import&nbsp;: TVA
            autoliquidée, au débit et au crédit (ex. 445662 et 4452). Exonérée et autoliquidation&nbsp;: pas de ligne de TVA.
          </HelpTip>
        }
      >
        <Select value={line.vatType || 'none'} onValueChange={(value) => onVatTypeChange(value as VatType)}>
          <SelectTrigger id={`${id}-vat-type`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VAT_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {hasVat(line) ? (
        <>
          <div className="space-y-2">
            <p id={`${id}-vat-source-label`} className="text-sm font-medium">
              Montant de TVA
            </p>
            <ToggleGroup
              type="single"
              variant="outline"
              value={source}
              onValueChange={(value) => value && onUpdate({ vatRateSource: value as VatRateSource })}
              aria-labelledby={`${id}-vat-source-label`}
              aria-describedby={`${id}-vat-source-hint`}
              className="w-full sm:w-auto"
            >
              <ToggleGroupItem value="transaction" className="flex-1 sm:flex-none">
                TVA détectée par la banque
              </ToggleGroupItem>
              <ToggleGroupItem value="fixed" className="flex-1 sm:flex-none">
                Taux saisi
              </ToggleGroupItem>
            </ToggleGroup>
            <p id={`${id}-vat-source-hint`} className="text-muted-foreground text-xs">
              {source === 'transaction'
                ? 'Kledg reprend la TVA fournie par la banque (Qonto aujourd’hui). Si elle n’en détecte pas, le taux de secours s’applique ; sans taux, la ligne est passée sans TVA.'
                : 'Ce taux s’applique à chaque transaction, quelle que soit la TVA détectée par la banque.'}
              {source === 'transaction' && !bankProvidesVat ? ' Aucune banque connectée ne fournit la TVA pour l’instant.' : null}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={source === 'transaction' ? 'Taux de secours (%)' : 'Taux de TVA (%)'}
              optional={source === 'transaction'}
            >
              <Input
                id={`${id}-vat-rate`}
                type="number"
                inputMode="decimal"
                step="0.01"
                value={line.vatRate || ''}
                onChange={(e) => onUpdate({ vatRate: parseFloat(e.target.value) || undefined })}
                placeholder="Ex&nbsp;: 20"
              />
            </Field>

            {selfAssessed ? (
              <>
                <Field label="Compte TVA au débit" required className="sm:col-start-1">
                  <AccountCombobox
                    id={`${id}-vat-account`}
                    accounts={accounts}
                    value={line.vatAccountId || defaultVatAccountId || 'none'}
                    onValueChange={(value) => onUpdate({ vatAccountId: value === 'none' ? undefined : value })}
                    placeholder={line.vatType === 'intracom' ? 'Ex. 445662 - TVA déductible intracommunautaire' : 'Ex. 44566 - TVA déductible'}
                    showNoneOption
                    noneOptionLabel="Aucun compte"
                  />
                </Field>
                <Field label="Compte TVA au crédit" required>
                  <AccountCombobox
                    id={`${id}-vat-account2`}
                    accounts={accounts}
                    value={line.vatAccount2Id || 'none'}
                    onValueChange={(value) => onUpdate({ vatAccount2Id: value === 'none' ? undefined : value })}
                    placeholder={line.vatType === 'intracom' ? 'Ex. 4452 - TVA due intracommunautaire' : 'Ex. 4452 si applicable'}
                    showNoneOption
                    noneOptionLabel="Aucun compte"
                  />
                </Field>
              </>
            ) : (
              <Field label="Compte de TVA">
                <AccountCombobox
                  id={`${id}-vat-account`}
                  accounts={accounts}
                  value={line.vatAccountId || defaultVatAccountId || 'none'}
                  onValueChange={(value) => onUpdate({ vatAccountId: value === 'none' ? undefined : value })}
                  placeholder="Par défaut"
                  showNoneOption
                />
              </Field>
            )}
          </div>

          {line.vatType === 'collectible' ? (
            // vatOnDebit puts the collected VAT on the debit side (a customer credit
            // note, calculateVATLineAmounts in lib/transactions/entry-line-calculator.ts):
            // it is not the option for VAT on debits of the company (exigibility).
            <div className="flex items-start gap-2">
              <Checkbox
                id={`${id}-vat-on-debit`}
                checked={line.vatOnDebit || false}
                onCheckedChange={(checked) => onUpdate({ vatOnDebit: checked === true })}
                aria-describedby={`${id}-vat-on-debit-hint`}
              />
              <div className="space-y-0.5">
                <Label htmlFor={`${id}-vat-on-debit`} className="font-normal">
                  TVA collectée au débit (avoir client)
                </Label>
                <p id={`${id}-vat-on-debit-hint`} className="text-muted-foreground text-xs">
                  Sans rapport avec l’exigibilité d’après les débits, réglée dans les paramètres de TVA.
                </p>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function BalanceMessage({ balance }: { balance: BalanceCheck }) {
  if (balance.status === 'idle') return null
  return (
    <p role="status" className="flex items-start gap-2 text-sm">
      {balance.status === 'loading' ? (
        <span className="text-muted-foreground">Vérification de l&apos;équilibre sur l&apos;exemple de l&apos;aperçu…</span>
      ) : balance.status === 'balanced' ? (
        <>
          <CheckCircle2 aria-hidden className="text-success mt-0.5 size-4 shrink-0" />
          <span>Écriture équilibrée sur l&apos;exemple de l&apos;aperçu.</span>
        </>
      ) : balance.hasBankLine ? (
        <>
          <XCircle aria-hidden className="text-destructive mt-0.5 size-4 shrink-0" />
          <span>
            Écriture non équilibrée&nbsp;: écart de <Amount value={balance.gap} />. Corrigez les montants pour enregistrer.
          </span>
        </>
      ) : (
        <>
          <Info aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <span>
            Écart de <Amount value={balance.gap} /> sur l&apos;exemple&nbsp;: à l&apos;application, Kledg le solde par une ligne sur le
            compte de banque.
          </span>
        </>
      )}
    </p>
  )
}
