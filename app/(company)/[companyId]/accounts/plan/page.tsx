'use client'

import { useState, useEffect, type CSSProperties } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { 
  ChevronRight, 
  ChevronDown, 
  Search,
  Settings,
  CheckCircle2,
  PlusCircle,
  Trash2,
  Plus
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/logger'
import Link from 'next/link'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { AccountCombobox } from '@/components/features/accounting/account-combobox'
import { PageHeader, StatusBadge } from '@/components/shared'
import { docsUrl } from '@/lib/docs-links'
import { ACCOUNT_CODE_MESSAGE, ACCOUNT_CODE_PATTERN } from '@/lib/accounting/account-code'

interface Account {
  id: string
  code: string
  label: string
  parentId: string | null
  isPCG: boolean
}

interface AccountNode extends Account {
  children: AccountNode[]
  level: number
}

const accountSchema = z.object({
  code: z.string().regex(ACCOUNT_CODE_PATTERN, ACCOUNT_CODE_MESSAGE),
  label: z.string().min(1, 'Le libellé est requis'),
  parentId: z.string().min(1, 'Le compte parent est requis'),
})

type AccountFormData = z.infer<typeof accountSchema>

const PCG_CLASSES = [
  { code: '1', label: 'Comptes de capitaux' },
  { code: '2', label: 'Comptes d\'immobilisations' },
  { code: '3', label: 'Comptes de stocks et en-cours' },
  { code: '4', label: 'Comptes de tiers' },
  { code: '5', label: 'Comptes financiers' },
  { code: '6', label: 'Comptes de charges' },
  { code: '7', label: 'Comptes de produits' },
]

function buildAccountTree(accounts: Account[]): AccountNode[] {
  const accountMap = new Map<string, AccountNode>()
  const rootAccounts: AccountNode[] = []

  // Créer tous les nœuds
  accounts.forEach(account => {
    accountMap.set(account.id, {
      ...account,
      children: [],
      level: 0,
    })
  })

  // Construire l'arbre
  accounts.forEach(account => {
    const node = accountMap.get(account.id)!
    if (account.parentId) {
      const parent = accountMap.get(account.parentId)
      if (parent) {
        parent.children.push(node)
        node.level = parent.level + 1
      } else {
        rootAccounts.push(node)
      }
    } else {
      rootAccounts.push(node)
    }
  })

  // Trier les comptes par code
  const sortAccounts = (accounts: AccountNode[]): AccountNode[] => {
    return accounts.sort((a, b) => {
      // Trier par code numérique
      const codeA = parseInt(a.code) || 0
      const codeB = parseInt(b.code) || 0
      if (codeA !== codeB) {
        return codeA - codeB
      }
      return a.code.localeCompare(b.code)
    }).map(account => ({
      ...account,
      children: sortAccounts(account.children),
    }))
  }

  return sortAccounts(rootAccounts)
}

function getAccountClass(code: string): string {
  if (code.length >= 1) {
    return code[0]
  }
  return ''
}

function AccountTreeNode({ 
  node, 
  expanded, 
  onToggle,
  searchTerm,
  companyId 
}: { 
  node: AccountNode
  expanded: Set<string>
  onToggle: (id: string) => void
  searchTerm: string
  companyId: string
}) {
  const hasChildren = node.children.length > 0
  const isExpanded = expanded.has(node.id)
  
  // Vérifier récursivement si le nœud ou un de ses descendants correspond à la recherche
  const hasMatchingDescendant = (n: AccountNode): boolean => {
    const nodeMatches = 
      n.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      n.label.toLowerCase().includes(searchTerm.toLowerCase())
    
    if (nodeMatches) {
      return true
    }
    
    // Vérifier récursivement tous les descendants
    return n.children.some(child => hasMatchingDescendant(child))
  }
  
  const isVisible = !searchTerm || 
    node.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    node.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
    hasMatchingDescendant(node)

  if (!isVisible && searchTerm) {
    return null
  }

  const classCode = getAccountClass(node.code)
  const isClassLevel = node.code.length === 1
  const isSubclassLevel = node.code.length === 2

  return (
    <div>
      <div
        className={cn(
          // Touch screens: 44px rows; phones: a smaller indent per level, so deep accounts keep their label
          'hover:bg-muted/50 flex min-h-9 items-center gap-2 pr-3 pl-[calc(0.5rem+var(--level)*0.75rem)] text-sm transition-colors pointer-coarse:min-h-11 sm:pl-[calc(0.5rem+var(--level)*1.25rem)]',
          isClassLevel && 'bg-muted/30 font-semibold',
          isSubclassLevel && 'font-medium'
        )}
        style={{ '--level': node.level } as CSSProperties}
      >
        {hasChildren ? (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onToggle(node.id)}
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Réduire' : 'Développer'} ${node.code} ${node.label}`}
          >
            {isExpanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
          </Button>
        ) : (
          <span aria-hidden className="w-7 shrink-0" />
        )}
        <Link
          href={`/${companyId}/accounts/${node.id}/entries`}
          className="flex min-w-0 flex-1 items-center gap-3 self-stretch rounded-sm py-1.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="text-muted-foreground w-14 shrink-0 font-mono text-xs sm:w-16">{node.code}</span>
          <span className="truncate">{node.label}</span>
          {!node.isPCG && (
            <StatusBadge className="ml-auto" tone="info">
              Personnalisé
            </StatusBadge>
          )}
        </Link>
      </div>
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <AccountTreeNode
              key={child.id}
              node={child}
              expanded={expanded}
              onToggle={onToggle}
              searchTerm={searchTerm}
              companyId={companyId}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function ChartOfAccountsPage() {
  const params = useParams()
  const router = useRouter()
  const companyId = params?.companyId as string
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [searchTerm, setSearchTerm] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkingCompliance, setCheckingCompliance] = useState(false)
  const [complianceResult, setComplianceResult] = useState<string | null>(null)
  const [deletingNonPCG, setDeletingNonPCG] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [codeExists, setCodeExists] = useState(false)
  const [checkingCode, setCheckingCode] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
    setValue,
  } = useForm<AccountFormData>({
    resolver: zodResolver(accountSchema),
  })

  const [selectedFiscalYearId, setSelectedFiscalYearId] = useState<string | undefined>(undefined)

  const watchedCode = watch('code')

  useEffect(() => {
    if (companyId && selectedFiscalYearId) {
      loadAccounts()
    }
  }, [companyId, selectedFiscalYearId])

  // Auto-développer les parents des comptes correspondants lors de la recherche
  useEffect(() => {
    if (!searchTerm || accounts.length === 0) {
      return
    }

    const accountMap = new Map<string, Account>()
    accounts.forEach(account => {
      accountMap.set(account.id, account)
    })

    // Trouver tous les comptes qui correspondent à la recherche
    const matchingAccountIds = new Set<string>()
    accounts.forEach(account => {
      const matches = 
        account.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        account.label.toLowerCase().includes(searchTerm.toLowerCase())
      if (matches) {
        matchingAccountIds.add(account.id)
      }
    })

    // Trouver tous les parents des comptes correspondants
    const parentIdsToExpand = new Set<string>()
    const findParents = (accountId: string) => {
      const account = accountMap.get(accountId)
      if (account && account.parentId) {
        parentIdsToExpand.add(account.parentId)
        findParents(account.parentId)
      }
    }

    matchingAccountIds.forEach(accountId => {
      findParents(accountId)
    })

    // Ajouter les parents à l'état expanded
    if (parentIdsToExpand.size > 0) {
      setExpanded(prev => {
        const newExpanded = new Set(prev)
        parentIdsToExpand.forEach(id => newExpanded.add(id))
        return newExpanded
      })
    }
  }, [searchTerm, accounts])

  // Vérifier si le code existe déjà
  useEffect(() => {
    const checkCodeExists = async () => {
      if (!watchedCode || watchedCode.length < 2 || !companyId || !selectedFiscalYearId) {
        setCodeExists(false)
        return
      }

      // The one account number format (lib/accounting/account-code.ts)
      if (!ACCOUNT_CODE_PATTERN.test(watchedCode)) {
        setCodeExists(false)
        return
      }

      setCheckingCode(true)
      try {
        const response = await fetch(
          `/api/accounts/check-exists?code=${encodeURIComponent(watchedCode)}&companyId=${companyId}&fiscalYearId=${selectedFiscalYearId}`
        )
        if (response.ok) {
          const data = await response.json()
          setCodeExists(data.exists)
        }
      } catch (error) {
        logger.error('Error checking code existence:', error)
      } finally {
        setCheckingCode(false)
      }
    }

    // Debounce pour éviter trop de requêtes
    const timeoutId = setTimeout(checkCodeExists, 500)
    return () => clearTimeout(timeoutId)
  }, [watchedCode, companyId, selectedFiscalYearId])

  const loadAccounts = async () => {
    if (!companyId || !selectedFiscalYearId) return

    setLoading(true)
    try {
      const response = await fetch(`/api/accounts?companyId=${companyId}&fiscalYearId=${selectedFiscalYearId}`)
      if (response.ok) {
        const data = await response.json()
        setAccounts(data)
        // Expand les classes principales par défaut
        const classIds = new Set<string>()
        data.forEach((account: Account) => {
          if (account.code.length === 1) {
            classIds.add(account.id)
          }
        })
        setExpanded(classIds)
      }
    } catch (error) {
      logger.error('Error loading accounts:', error)
    } finally {
      setLoading(false)
    }
  }

  const onSubmit = async (data: AccountFormData) => {
    if (!companyId) {
      setError('Veuillez sélectionner une société')
      return
    }

    if (!selectedFiscalYearId) {
      setError('Veuillez sélectionner un exercice fiscal')
      toast.error('Veuillez sélectionner un exercice fiscal avant de créer un compte')
      return
    }

    // Validation: le code doit commencer par le code du parent
    if (data.parentId) {
      const parentAccount = accounts.find(acc => acc.id === data.parentId)
      if (parentAccount && !data.code.startsWith(parentAccount.code)) {
        setError(`Le code du compte enfant doit commencer par le code du parent (${parentAccount.code})`)
        toast.error(`Le code doit commencer par ${parentAccount.code}`)
        return
      }
    }

    // Validation: vérifier que le code n'existe pas déjà
    if (codeExists) {
      setError('Un compte avec ce numéro existe déjà')
      toast.error('Un compte avec ce numéro existe déjà')
      return
    }

    setCreating(true)
    setError(null)

    try {
      const response = await fetch('/api/accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
          body: JSON.stringify({
            ...data,
            companyId: companyId,
            fiscalYearId: selectedFiscalYearId,
            parentId: data.parentId,
          }),
      })

      if (response.ok) {
        const newAccount = await response.json()
        setAccounts([...accounts, newAccount])
        toast.success('Compte créé avec succès')
        setDialogOpen(false)
        reset()
        router.refresh()
        await loadAccounts()
      } else {
        const errorData = await response.json()
        const errorMessage = errorData.error || 'Erreur lors de la création du compte'
        setError(errorMessage)
        toast.error(errorMessage)
      }
    } catch (error) {
      logger.error('Error creating account:', error)
      const errorMessage = 'Erreur lors de la création du compte'
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setCreating(false)
    }
  }

  const toggleExpanded = (id: string) => {
    const newExpanded = new Set(expanded)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpanded(newExpanded)
  }

  const expandAll = () => {
    const allIds = new Set<string>()
    accounts.forEach(account => {
      allIds.add(account.id)
    })
    setExpanded(allIds)
  }

  const collapseAll = () => {
    const classIds = new Set<string>()
    accounts.forEach((account: Account) => {
      if (account.code.length === 1) {
        classIds.add(account.id)
      }
    })
    setExpanded(classIds)
  }

  if (!companyId) {
    return (
      <NoCompanySelected 
        description="Veuillez sélectionner une société pour voir le plan de compte"
      />
    )
  }

  const accountTree = buildAccountTree(accounts)
  
  // Fonction récursive pour vérifier si un nœud ou un de ses descendants correspond
  const hasMatchingNode = (n: AccountNode): boolean => {
    const nodeMatches = 
      n.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      n.label.toLowerCase().includes(searchTerm.toLowerCase())
    
    if (nodeMatches) {
      return true
    }
    
    // Vérifier récursivement tous les descendants
    return n.children.some(child => hasMatchingNode(child))
  }
  
  // Fonction pour filtrer l'arbre en préservant tous les parents des nœuds correspondants
  const filterTree = (nodes: AccountNode[]): AccountNode[] => {
    return nodes
      .map(node => {
        const hasMatch = hasMatchingNode(node)
        if (!hasMatch) {
          return null
        }
        
        // Inclure le nœud et filtrer récursivement ses enfants
        return {
          ...node,
          children: filterTree(node.children),
        }
      })
      .filter((node): node is AccountNode => node !== null)
  }
  
  const filteredTree = searchTerm ? filterTree(accountTree) : accountTree

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plan de comptes"
        description="Les comptes de la société, classés selon le plan comptable général (PCG)&nbsp;: classes 1 à 5 pour le bilan, 6 et 7 pour le compte de résultat."
        docsHref={docsUrl('chartOfAccounts')}
        actions={
          <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={!selectedFiscalYearId}>
                <Settings aria-hidden />
                Conformité PCG
              </Button>
            </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Conformité PCG</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={async () => {
                      if (!companyId || !selectedFiscalYearId) {
                        toast.error('Veuillez sélectionner un exercice fiscal')
                        return
                      }
                      setCheckingCompliance(true)
                      setComplianceResult(null)
                      try {
                        const response = await fetch('/api/accounts/check-pcg-compliance', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            companyId: companyId,
                            fiscalYearId: selectedFiscalYearId,
                            includeOptionalAccounts: false,
                          }),
                        })
                        const data = await response.json()
                        if (response.ok) {
                          setComplianceResult(data.message)
                          toast.success(data.message)
                          await loadAccounts()
                        } else {
                          toast.error(data.error || 'Erreur lors de la vérification')
                        }
                      } catch (error) {
                        logger.error('Error checking compliance:', error)
                        toast.error('Erreur lors de la vérification')
                      } finally {
                        setCheckingCompliance(false)
                      }
                    }}
                    disabled={checkingCompliance}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    {checkingCompliance ? 'Vérification...' : 'Vérifier et ajouter les comptes manquants'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={async () => {
                      if (!companyId || !selectedFiscalYearId) {
                        toast.error('Veuillez sélectionner un exercice fiscal')
                        return
                      }
                      setCheckingCompliance(true)
                      setComplianceResult(null)
                      try {
                        const response = await fetch('/api/accounts/check-pcg-compliance', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            companyId: companyId,
                            fiscalYearId: selectedFiscalYearId,
                            includeOptionalAccounts: true,
                          }),
                        })
                        const data = await response.json()
                        if (response.ok) {
                          setComplianceResult(data.message)
                          toast.success(data.message)
                          await loadAccounts()
                        } else {
                          toast.error(data.error || 'Erreur lors de l\'ajout')
                        }
                      } catch (error) {
                        logger.error('Error adding optional accounts:', error)
                        toast.error('Erreur lors de l\'ajout')
                      } finally {
                        setCheckingCompliance(false)
                      }
                    }}
                    disabled={checkingCompliance}
                  >
                    <PlusCircle className="h-4 w-4 mr-2" />
                    {checkingCompliance ? 'Ajout...' : 'Ajouter les comptes facultatifs'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault()
                      setDeleteDialogOpen(true)
                    }}
                    disabled={deletingNonPCG}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Supprimer les comptes inconnus au PCG
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Supprimer les comptes inconnus au PCG&nbsp;?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Les comptes qui ne font pas partie du PCG et qui n&apos;ont aucune écriture seront
                      supprimés définitivement. Les comptes qui ont des écritures sont conservés.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={async () => {
                        if (!companyId || !selectedFiscalYearId) {
                          toast.error('Veuillez sélectionner un exercice fiscal')
                          return
                        }
                        setDeletingNonPCG(true)
                        setDeleteDialogOpen(false)
                        try {
                          const response = await fetch('/api/accounts/delete-non-pcg', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              companyId: companyId,
                              fiscalYearId: selectedFiscalYearId,
                            }),
                          })
                          const data = await response.json()
                          if (response.ok) {
                            toast.success(data.message)
                            await loadAccounts()
                          } else {
                            if (data.accountsWithEntries) {
                              toast.error(
                                `Impossible de supprimer certains comptes\u00a0: ${data.accountsWithEntries.join(', ')}`
                              )
                            } else {
                              toast.error(data.error || 'Erreur lors de la suppression')
                            }
                          }
                        } catch (error) {
                          logger.error('Error deleting non-PCG accounts:', error)
                          toast.error('Erreur lors de la suppression')
                        } finally {
                          setDeletingNonPCG(false)
                        }
                      }}
                      disabled={deletingNonPCG}
                    >
                      {deletingNonPCG ? 'Suppression...' : 'Supprimer'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button disabled={!selectedFiscalYearId}>
                    <Plus aria-hidden />
                    Créer un compte
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Créer un compte</DialogTitle>
              <DialogDescription>
                Ajoutez un nouveau compte pour l'exercice fiscal sélectionné
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)}>
              <div className="space-y-4 py-4">
                {!selectedFiscalYearId && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      Veuillez sélectionner un exercice fiscal avant de créer un compte
                    </AlertDescription>
                  </Alert>
                )}
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2">
                  <Label htmlFor="parentId">Compte parent *</Label>
                  <AccountCombobox
                    id="parentId"
                    accounts={accounts}
                    value={watch('parentId') || ''}
                    onValueChange={(value) => {
                      setValue('parentId', value)
                      // Préremplir le code avec le code du parent
                      if (value) {
                        const parentAccount = accounts.find(acc => acc.id === value)
                        if (parentAccount) {
                          // Préremplir avec le code du parent (l'utilisateur pourra l'étendre)
                          const parentCode = parentAccount.code
                          setValue('code', parentCode)
                        }
                      }
                    }}
                    placeholder="Sélectionner un compte parent"
                    showNoneOption={false}
                    className="w-full"
                  />
                  {errors.parentId && (
                    <p className="text-sm text-destructive">{errors.parentId.message}</p>
                  )}
                  {watch('parentId') && (
                    <p className="text-xs text-muted-foreground">
                      Le code du nouveau compte doit commencer par {accounts.find(acc => acc.id === watch('parentId'))?.code} ({accounts.find(acc => acc.id === watch('parentId'))?.label}).
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="code">Code *</Label>
                  <Input
                    id="code"
                    {...register('code')}
                    placeholder="Ex&nbsp;: 411"
                    maxLength={8}
                  />
                  {errors.code && (
                    <p className="text-sm text-destructive">{errors.code.message}</p>
                  )}
                  {codeExists && watchedCode && (
                    <p className="text-sm text-destructive">
                      Un compte avec ce numéro existe déjà
                    </p>
                  )}
                  {checkingCode && (
                    <p className="text-xs text-muted-foreground">Vérification...</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Entre 2 et 8 chiffres (format PCG)
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="label">Libellé *</Label>
                  <Input
                    id="label"
                    {...register('label')}
                    placeholder="Ex&nbsp;: Clients"
                  />
                  {errors.label && (
                    <p className="text-sm text-destructive">{errors.label.message}</p>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Annuler
                </Button>
                <Button type="submit" loading={creating} disabled={!selectedFiscalYearId}>
                  Créer le compte
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
          </>
        }
      />

      <FiscalYearSelector
        companyId={companyId}
        value={selectedFiscalYearId}
        onValueChange={setSelectedFiscalYearId}
        className="max-w-xs"
      />

      {complianceResult && (
        <Alert>
          <AlertDescription>{complianceResult}</AlertDescription>
        </Alert>
      )}

      <Card className="gap-4">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="whitespace-nowrap">
            Comptes{' '}
            {!loading && <span className="text-muted-foreground num font-normal">{accounts.length}</span>}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={expandAll}>
              Tout développer
            </Button>
            <Button variant="outline" size="sm" onClick={collapseAll}>
              Tout réduire
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="relative">
              <Search aria-hidden className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                type="search"
                aria-label="Rechercher un compte"
                placeholder="Rechercher par numéro ou libellé (ex. 512, banque)"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (
              // Phones: the tree scrolls with the page, not in a box of its own
              <div className="divide-y overflow-auto rounded-md border sm:max-h-[600px]">
                {filteredTree.length === 0 ? (
                  <div className="text-muted-foreground px-4 py-10 text-center text-sm">
                    {searchTerm
                      ? `Aucun compte ne correspond à « ${searchTerm} ».`
                      : 'Aucun compte pour cet exercice.'}
                  </div>
                ) : (
                  filteredTree.map((node) => (
                    <AccountTreeNode
                      key={node.id}
                      node={node}
                      expanded={expanded}
                      onToggle={toggleExpanded}
                      searchTerm={searchTerm}
                      companyId={companyId}
                    />
                  ))
                )}
              </div>
            )}

          </div>
        </CardContent>
      </Card>
    </div>
  )
}
