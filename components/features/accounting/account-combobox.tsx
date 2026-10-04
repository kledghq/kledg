'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CommandEmpty, CommandGroup } from '@/components/ui/command'
import { Autocomplete, AutocompleteItem } from '@/components/ui/autocomplete'
import { extractPCGClass } from '@/lib/shared/helpers'

interface Account {
  id: string
  code: string
  label: string
  parentId?: string | null
  isPCG?: boolean
}

interface AccountComboboxProps {
  accounts: Account[]
  value?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  showNoneOption?: boolean
  noneOptionLabel?: string
  className?: string
  id?: string
  codePrefix?: string // Filtre les comptes par préfixe de code (ex: '2', '28', '68')
  accountClass?: string | number // Filtre par classe de compte PCG (1-7)
  accountClasses?: (string | number)[] // Filtre par plusieurs classes de compte PCG
  isPCG?: boolean // Filtre par compte PCG (true) ou non-PCG (false)
  excludeAccountIds?: string[] // Liste d'IDs de comptes à exclure
  includeAccountIds?: string[] // Liste d'IDs de comptes à inclure uniquement (prioritaire sur les autres filtres)
}

/**
 * Compare deux codes de compte de manière numérique
 */
function compareAccountCodes(codeA: string, codeB: string): number {
  const numA = parseInt(codeA, 10)
  const numB = parseInt(codeB, 10)
  
  if (!isNaN(numA) && !isNaN(numB)) {
    return numA - numB
  }
  
  return codeA.localeCompare(codeB)
}

/**
 * Calcule le niveau d'indentation d'un compte
 */
function getAccountIndentLevel(account: Account, accounts: Account[]): number {
  if (!account.parentId) return 0
  const parent = accounts.find(a => a.id === account.parentId)
  if (!parent) return 0
  return 1 + getAccountIndentLevel(parent, accounts)
}

/**
 * Trie les comptes de manière hiérarchique (parents avant enfants)
 */
function sortAccountsHierarchically(accounts: Account[]): Account[] {
  const accountMap = new Map(accounts.map(acc => [acc.id, acc]))
  const sorted: Account[] = []
  const processed = new Set<string>()

  function addAccountAndChildren(account: Account) {
    if (processed.has(account.id)) return
    
    if (account.parentId) {
      const parent = accountMap.get(account.parentId)
      if (parent && !processed.has(parent.id)) {
        addAccountAndChildren(parent)
      }
    }
    
    sorted.push(account)
    processed.add(account.id)
    
    const children = accounts.filter(acc => acc.parentId === account.id)
    children.sort((a, b) => compareAccountCodes(a.code, b.code))
    children.forEach(child => addAccountAndChildren(child))
  }

  // Consider as "roots" any account without a parent, OR whose parent isn't
  // in the (filtered) list, otherwise a filter on code prefix hides every
  // account since real roots have been removed by the filter.
  const rootAccounts = accounts.filter(
    acc => !acc.parentId || !accountMap.has(acc.parentId)
  )
  rootAccounts.sort((a, b) => compareAccountCodes(a.code, b.code))
  rootAccounts.forEach(account => addAccountAndChildren(account))

  // Safety net: if any filtered account slipped through (cycles, etc.),
  // append it at the end so nothing is silently dropped.
  for (const acc of accounts) {
    if (!processed.has(acc.id)) {
      sorted.push(acc)
      processed.add(acc.id)
    }
  }

  return sorted
}

export function AccountCombobox({
  accounts,
  value,
  onValueChange,
  placeholder = 'Sélectionner un compte...',
  showNoneOption = false,
  noneOptionLabel = 'Aucun compte',
  className,
  id,
  codePrefix,
  accountClass,
  accountClasses,
  isPCG,
  excludeAccountIds,
  includeAccountIds,
}: AccountComboboxProps) {
  const selectedAccount = value && value !== 'none'
    ? accounts.find(acc => acc.id === value)
    : null

  // Filtrer les comptes selon les critères spécifiés
  // Toujours inclure le compte sélectionné même s'il ne correspond pas aux filtres
  let filteredAccounts = accounts

  // Filtre par IDs inclus (prioritaire)
  if (includeAccountIds && includeAccountIds.length > 0) {
    filteredAccounts = accounts.filter(acc => 
      includeAccountIds.includes(acc.id) || acc.id === value
    )
  } else {
    // Appliquer les autres filtres seulement si includeAccountIds n'est pas spécifié
    
    // Filtre par préfixe de code
    if (codePrefix) {
      filteredAccounts = filteredAccounts.filter(acc => 
        acc.code.startsWith(codePrefix) || acc.id === value
      )
    }

    // Filtre par classe(s) de compte PCG
    if (accountClasses && accountClasses.length > 0) {
      const classStrings = accountClasses.map(c => String(c))
      filteredAccounts = filteredAccounts.filter(acc => {
        const accountClassCode = extractPCGClass(acc.code)
        return (accountClassCode && classStrings.includes(accountClassCode)) || acc.id === value
      })
    } else if (accountClass !== undefined) {
      const classString = String(accountClass)
      filteredAccounts = filteredAccounts.filter(acc => {
        const accountClassCode = extractPCGClass(acc.code)
        return (accountClassCode === classString) || acc.id === value
      })
    }

    // Filtre par isPCG
    if (isPCG !== undefined) {
      filteredAccounts = filteredAccounts.filter(acc => 
        acc.isPCG === isPCG || acc.id === value
      )
    }

    // Exclure certains comptes
    if (excludeAccountIds && excludeAccountIds.length > 0) {
      filteredAccounts = filteredAccounts.filter(acc => 
        !excludeAccountIds.includes(acc.id) || acc.id === value
      )
    }
  }

  const sortedAccounts = sortAccountsHierarchically(filteredAccounts)

  const selectedLabel = selectedAccount
    ? `${selectedAccount.code} - ${selectedAccount.label}`
    : value === 'none'
      ? noneOptionLabel
      : undefined

  return (
    <Autocomplete
      id={id}
      className={className}
      selectedLabel={selectedLabel}
      placeholder={placeholder}
    >
      <CommandEmpty>Aucun compte trouvé.</CommandEmpty>
      <CommandGroup className="pt-1">
        {showNoneOption && (
          <AutocompleteItem
            value={noneOptionLabel}
            onSelect={() => onValueChange?.(value === 'none' ? '' : 'none')}
          >
            <Check className={cn('mr-2 h-4 w-4', value === 'none' ? 'opacity-100' : 'opacity-0')} />
            {noneOptionLabel}
          </AutocompleteItem>
        )}
        {sortedAccounts.map((account) => {
          const indentLevel = getAccountIndentLevel(account, accounts)
          return (
            <AutocompleteItem
              key={account.id}
              // Code and label in the value so typing either one matches.
              value={`${account.code} ${account.label}`}
              onSelect={() => onValueChange?.(account.id === value ? '' : account.id)}
            >
              <Check className={cn('mr-2 h-4 w-4', value === account.id ? 'opacity-100' : 'opacity-0')} />
              <div
                className="flex min-w-0 flex-1 items-center gap-2"
                style={{ paddingLeft: `${indentLevel * 16}px` }}
              >
                <span className="font-mono text-sm font-medium">{account.code}</span>
                <span className="text-muted-foreground">-</span>
                <span className="truncate">{account.label}</span>
              </div>
            </AutocompleteItem>
          )
        })}
      </CommandGroup>
    </Autocomplete>
  )
}
