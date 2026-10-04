'use client'

import { useState, useEffect } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AccountCombobox } from '@/components/features/accounting/account-combobox'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { simplifyAccountCode, enhanceAccountMapping, type AccountMapping, type AccountPreview } from '@/components/features/import/account-mapping-utils'
import { analyzeFECAccounts, type ExistingAccount } from '@/components/features/import/account-analyzer'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import type { FECColumnMapping } from '@/lib/import/types'
import { Plus } from 'lucide-react'
import { plural, pluralWord } from '@/lib/utils/plural'

export interface JournalPreview {
  code: string
  label: string
}

interface AccountMappingProps {
  fileContent: string
  columnMapping: FECColumnMapping
  onMappingComplete: (data: { accountMapping: AccountMapping; journalMapping?: Record<string, string | null> }) => void
  onCancel: () => void
  companyId: string
  fiscalYearId?: string
  fiscalYearYear?: number
}

/** "Aucun nouveau compte ne sera créé.", "1 nouveau compte sera créé.", "3 nouveaux comptes seront créés." */
function newAccountsSentence(count: number): string {
  if (count === 0) return 'Aucun nouveau compte ne sera créé.'
  return `${plural(count, 'nouveau compte', 'nouveaux comptes')} ${pluralWord(count, 'sera créé', 'seront créés')}.`
}

export function AccountMappingComponent({ 
  fileContent, 
  columnMapping, 
  onMappingComplete, 
  onCancel, 
  companyId,
  fiscalYearId,
  fiscalYearYear
}: AccountMappingProps) {
  const [accountsPreview, setAccountsPreview] = useState<AccountPreview[]>([])
  const [existingAccounts, setExistingAccounts] = useState<Set<string>>(new Set())
  const [existingAccountsList, setExistingAccountsList] = useState<ExistingAccount[]>([])
  const [accountMapping, setAccountMapping] = useState<AccountMapping>({})
  const [journalsPreview, setJournalsPreview] = useState<JournalPreview[]>([])
  const [existingJournals, setExistingJournals] = useState<Array<{ id: string; code: string; label: string }>>([])
  const [journalMapping, setJournalMapping] = useState<Record<string, string | null>>({})
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [createAccountDialogOpen, setCreateAccountDialogOpen] = useState(false)
  const [creatingAccount, setCreatingAccount] = useState(false)
  const [accountToCreateFor, setAccountToCreateFor] = useState<string | null>(null)
  const [codeExists, setCodeExists] = useState(false)
  const [checkingCode, setCheckingCode] = useState(false)
  
  const accountSchema = z.object({
    code: z.string().min(2, 'Le code doit contenir au moins 2 chiffres').regex(/^\d{2,8}$/, 'Le code doit contenir entre 2 et 8 chiffres'),
    label: z.string().min(1, 'Le libellé est requis'),
    parentId: z.string().min(1, 'Le compte parent est requis'),
  })
  
  type AccountFormData = z.infer<typeof accountSchema>
  
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
    setValue,
  } = useForm<AccountFormData>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      code: '',
      label: '',
      parentId: undefined,
    },
  })

  // Charger les comptes et journaux existants, analyser le fichier
  useEffect(() => {
    if (!columnMapping?.CompteNum || !companyId) return

    const analyzeAccounts = async () => {
      setLoadingAccounts(true)
      try {
        // Load existing accounts, filtered by fiscal year if specified
        let accounts: ExistingAccount[] = []
        const accountsUrl = fiscalYearId 
          ? `/api/accounts?companyId=${companyId}&fiscalYearId=${fiscalYearId}`
          : `/api/accounts?companyId=${companyId}`
        const accountsResponse = await fetch(accountsUrl)
        if (accountsResponse.ok) {
          accounts = await accountsResponse.json()
          const existingCodes = new Set(accounts.map((acc) => acc.code))
          setExistingAccounts(existingCodes)
          setExistingAccountsList(accounts)
        }

        // Load existing journals (company-level)
        let existingJournalsList: Array<{ id: string; code: string; label: string }> = []
        const journalsResponse = await fetch(`/api/journals?companyId=${companyId}`)
        if (journalsResponse.ok) {
          const journals = await journalsResponse.json()
          existingJournalsList = Array.isArray(journals) ? journals : []
          setExistingJournals(existingJournalsList)
        }

        // Analyze accounts and journals from file
        const lines = fileContent.split('\n').filter((line) => line.trim())
        if (lines.length < 2) return

        const separator = lines[0].includes('\t') ? '\t' : ';'
        const header = lines[0].split(separator).map((col) => col.trim())
        const compteNumIndex = columnMapping.CompteNum ? header.indexOf(columnMapping.CompteNum) : -1
        const compteLibIndex = columnMapping.CompteLib ? header.indexOf(columnMapping.CompteLib) : -1
        const journalCodeIndex = columnMapping.JournalCode ? header.indexOf(columnMapping.JournalCode) : -1
        const journalLibIndex = columnMapping.JournalLib ? header.indexOf(columnMapping.JournalLib) : -1

        if (compteNumIndex === -1) return

        // Extract unique accounts and journals from all FEC lines
        const accountsMap = new Map<string, { label: string }>()
        const journalsMap = new Map<string, { label: string }>()
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(separator)
          const code = values[compteNumIndex]?.trim()
          const label = compteLibIndex !== -1 ? values[compteLibIndex]?.trim() || '' : ''
          if (code && !accountsMap.has(code)) {
            accountsMap.set(code, { label })
          }
          if (journalCodeIndex !== -1) {
            const jCode = values[journalCodeIndex]?.trim()
            const jLabel = journalLibIndex !== -1 ? values[journalLibIndex]?.trim() || '' : ''
            if (jCode && !journalsMap.has(jCode)) {
              journalsMap.set(jCode, { label: jLabel })
            }
          }
        }

        const journalsPreviewList = Array.from(journalsMap.entries()).map(([code, { label }]) => ({ code, label }))
        setJournalsPreview(journalsPreviewList)

        // Pre-fill journal mapping: match FEC code to existing journal by code (e.g. BQ -> BQ)
        const initialJournalMapping: Record<string, string | null> = {}
        journalsMap.forEach((_, code) => {
          const normalized = code.trim().toUpperCase()
          const match = existingJournalsList.find((j) => j.code === normalized || j.code === code)
          if (match) initialJournalMapping[code] = match.id
        })
        setJournalMapping((prev) => ({ ...initialJournalMapping, ...prev }))

        // Analyze FEC accounts
        const preview = analyzeFECAccounts(accountsMap, accounts)

        setAccountsPreview(preview)
        
        // Pre-select existing or similar accounts automatically detected
        // But DO NOT overwrite manual user choices
        setAccountMapping((prevMapping) => {
          const newMapping = { ...prevMapping }
          preview.forEach((account) => {
            // Only add if not already defined by user
            if (account.mappedToAccountId && !newMapping[account.code]) {
              newMapping[account.code] = account.mappedToAccountId
            }
          })
          return newMapping
        })
      } catch (error) {
        logger.error('Error analyzing accounts:', error)
      } finally {
        setLoadingAccounts(false)
      }
    }

    analyzeAccounts()
     
  }, [columnMapping?.CompteNum, columnMapping?.CompteLib, columnMapping?.JournalCode, columnMapping?.JournalLib, fileContent, companyId, fiscalYearId, fiscalYearYear])

  const watchedCode = watch('code')

  // Vérifier si le code existe déjà
  useEffect(() => {
    const checkCodeExists = async () => {
      if (!watchedCode || watchedCode.length < 2 || !companyId) {
        setCodeExists(false)
        return
      }

      // Vérifier que le code est valide (2-8 chiffres)
      if (!/^\d{2,8}$/.test(watchedCode)) {
        setCodeExists(false)
        return
      }

      setCheckingCode(true)
      try {
        const url = fiscalYearId
          ? `/api/accounts/check-exists?code=${encodeURIComponent(watchedCode)}&companyId=${companyId}&fiscalYearId=${fiscalYearId}`
          : `/api/accounts/check-exists?code=${encodeURIComponent(watchedCode)}&companyId=${companyId}`
        const response = await fetch(url)
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
  }, [watchedCode, companyId, fiscalYearId])

  const handleAccountMappingChange = (fecAccountCode: string, kledgAccountId: string) => {
    setAccountMapping((prev) => {
      const newMapping = { ...prev }
      if (kledgAccountId === '__none__') {
        delete newMapping[fecAccountCode]
      } else {
        newMapping[fecAccountCode] = kledgAccountId
      }
      return newMapping
    })
  }

  const handleJournalMappingChange = (fecJournalCode: string, kledgJournalId: string | null) => {
    setJournalMapping((prev) => {
      const next = { ...prev }
      if (kledgJournalId == null || kledgJournalId === '') {
        delete next[fecJournalCode]
      } else {
        next[fecJournalCode] = kledgJournalId
      }
      return next
    })
  }

  const handleOpenCreateAccountDialog = (fecAccountCode: string) => {
    const account = accountsPreview.find(a => a.code === fecAccountCode)
    setAccountToCreateFor(fecAccountCode)
    // Pre-fill with FEC account values
    reset({
      code: fecAccountCode,
      label: account?.label || '',
      parentId: '',
    })
    setCreateAccountDialogOpen(true)
  }

  const handleCreateAccount = async (data: AccountFormData) => {
    if (!companyId || !accountToCreateFor) return

    // Validation: le code doit commencer par le code du parent
    if (data.parentId) {
      const parentAccount = existingAccountsList.find(acc => acc.id === data.parentId)
      if (parentAccount && !data.code.startsWith(parentAccount.code)) {
        toast.error(`Le code du compte enfant doit commencer par le code du parent (${parentAccount.code})`)
        return
      }
    }

    // Validation: vérifier que le code n'existe pas déjà
    if (codeExists) {
      toast.error('Un compte avec ce numéro existe déjà')
      return
    }

    setCreatingAccount(true)
    try {
      const response = await fetch('/api/accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...data,
          companyId,
          parentId: data.parentId,
          ...(fiscalYearId && { fiscalYearId }),
        }),
      })

      if (response.ok) {
        const newAccount = await response.json()
        
        // Add new account to list
        setExistingAccountsList((prev) => [...prev, { id: newAccount.id, code: newAccount.code, label: newAccount.label }])
        setExistingAccounts((prev) => new Set([...prev, newAccount.code]))
        
        // Automatically map FEC account to newly created account
        handleAccountMappingChange(accountToCreateFor, newAccount.id)
        
        toast.success('Compte créé avec succès')
        setCreateAccountDialogOpen(false)
        reset()
        setAccountToCreateFor(null)
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Erreur lors de la création du compte')
      }
    } catch (error) {
      logger.error('Error creating account:', error)
      toast.error('Erreur lors de la création du compte')
    } finally {
      setCreatingAccount(false)
    }
  }

  const handleConfirm = () => {
    // Filter account mapping to keep only valid redirects (not null/undefined)
    const finalMapping: AccountMapping = {}
    Object.entries(accountMapping).forEach(([fecCode, kledgAccountId]) => {
      if (kledgAccountId) {
        finalMapping[fecCode] = kledgAccountId
      }
    })
    const completeMapping = enhanceAccountMapping(finalMapping)

    // Filter journal mapping to keep only non-null
    const finalJournalMapping: Record<string, string | null> = {}
    Object.entries(journalMapping).forEach(([fecCode, kledgJournalId]) => {
      if (kledgJournalId) {
        finalJournalMapping[fecCode] = kledgJournalId
      }
    })

    onMappingComplete({ accountMapping: completeMapping, journalMapping: finalJournalMapping })
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Correspondance des comptes</CardTitle>
          <CardDescription>
            {newAccountsSentence(accountsPreview.filter(a => !a.exists && !accountMapping[a.code]).length)}{' '}
            Vous pouvez rediriger les écritures vers un compte existant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingAccounts ? (
            <div className="text-sm text-muted-foreground">Chargement des comptes...</div>
          ) : accountsPreview.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Aucun compte trouvé dans le fichier. Assurez-vous que le mapping des colonnes est correct.
            </div>
          ) : (
            <div className="border rounded-md overflow-auto max-h-96">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs w-32">Fichier FEC</TableHead>
                    <TableHead className="text-xs w-32">Compte Kledg</TableHead>
                    <TableHead className="text-xs w-24">Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accountsPreview.map((account) => {
                    // Trouver le compte mappé (explicite ou automatique)
                    const mappedAccountId = accountMapping[account.code] || account.mappedToAccountId
                    const mappedAccount = mappedAccountId 
                      ? existingAccountsList.find(acc => acc.id === mappedAccountId)
                      : null
                    
                    // Déterminer si le compte existe (détecté automatiquement)
                    const isExisting = account.exists
                    
                    return (
                      <TableRow key={account.code}>
                        <TableCell className="text-xs">
                          <div className="font-mono font-semibold">{account.code}</div>
                          <div className="text-muted-foreground text-[10px] mt-0.5">{account.label}</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <div className="flex-1">
                                <AccountCombobox
                                  accounts={existingAccountsList}
                                  value={mappedAccountId || 'none'}
                                  onValueChange={(value) => handleAccountMappingChange(account.code, value === 'none' ? '__none__' : value)}
                                  placeholder={isExisting && mappedAccount ? `${mappedAccount.code} - ${mappedAccount.label}` : `Créer\u00a0: ${account.code}`}
                                  showNoneOption={true}
                                  noneOptionLabel={isExisting && mappedAccount ? `Créer\u00a0: ${account.code}` : `Créer\u00a0: ${account.code}`}
                                  className="h-8 text-xs"
                                />
                              </div>
                              <Button
                                type="button"
                                variant={!mappedAccount ? "default" : "outline"}
                                size="icon-sm"
                                className="shrink-0"
                                onClick={() => handleOpenCreateAccountDialog(account.code)}
                                aria-label={`Créer un compte pour ${account.code}`}
                                title="Créer un nouveau compte"
                              >
                                <Plus aria-hidden />
                              </Button>
                            </div>
                            {mappedAccount && (
                              <div className="text-[10px]">
                                <span className={`font-mono ${isExisting ? 'text-success' : 'text-info'}`}>
                                  {mappedAccount.code}
                                </span>
                                <span className="text-muted-foreground ml-1">{mappedAccount.label}</span>
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {isExisting ? (
                            <Badge variant="outline" className="text-xs">Existant</Badge>
                          ) : mappedAccount ? (
                            <Badge variant="secondary" className="text-xs">Redirigé</Badge>
                          ) : (
                            <Badge variant="default" className="text-xs">Nouveau</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {journalsPreview.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Correspondance des journaux</CardTitle>
            <CardDescription>
              Liez les codes journaux du fichier FEC aux journaux Kledg. Si aucun n&apos;est choisi, le journal sera créé ou utilisé tel quel.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md overflow-auto max-h-64">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs w-24">Fichier FEC</TableHead>
                    <TableHead className="text-xs">Journal Kledg</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {journalsPreview.map((journal) => {
                    const mappedId = journalMapping[journal.code] ?? ''
                    const mappedJournal = mappedId
                      ? existingJournals.find((j) => j.id === mappedId)
                      : null
                    return (
                      <TableRow key={journal.code}>
                        <TableCell className="text-xs">
                          <div className="font-mono font-semibold">{journal.code}</div>
                          <div className="text-muted-foreground text-[10px] mt-0.5">{journal.label}</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <Select
                            value={mappedId || '__none__'}
                            onValueChange={(value) =>
                              handleJournalMappingChange(
                                journal.code,
                                value === '__none__' ? null : value
                              )
                            }
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Créer / garder tel quel" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__" className="text-xs">
                                Créer ou garder tel quel
                              </SelectItem>
                              {existingJournals.map((j) => (
                                <SelectItem key={j.id} value={j.id} className="text-xs">
                                  {j.code} - {j.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {mappedJournal && (
                            <div className="text-[10px] text-muted-foreground mt-1">
                              → {mappedJournal.code} - {mappedJournal.label}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel}>
          Annuler
        </Button>
        <Button onClick={handleConfirm} disabled={loadingAccounts}>
          Confirmer et continuer
        </Button>
      </div>

      {/* Dialog de création de compte */}
      <Dialog open={createAccountDialogOpen} onOpenChange={setCreateAccountDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Créer un nouveau compte</DialogTitle>
            <DialogDescription>
              Créez un nouveau compte pour mapper le compte FEC "{accountToCreateFor}"
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(handleCreateAccount)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="account-code">Code *</Label>
              <Input
                id="account-code"
                {...register('code')}
                placeholder="Ex&nbsp;: 41100001"
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="account-label">Libellé *</Label>
              <Input
                id="account-label"
                {...register('label')}
                placeholder="Ex&nbsp;: Clients"
              />
              {errors.label && (
                <p className="text-sm text-destructive">{errors.label.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="account-parent">Compte parent *</Label>
              <AccountCombobox
                id="account-parent"
                accounts={existingAccountsList}
                value={watch('parentId') || ''}
                onValueChange={(value) => {
                  setValue('parentId', value)
                  // Préremplir le code avec le code du parent
                  if (value) {
                    const parentAccount = existingAccountsList.find(acc => acc.id === value)
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
                  Compte parent sélectionné&nbsp;: {existingAccountsList.find(acc => acc.id === watch('parentId'))?.code} - {existingAccountsList.find(acc => acc.id === watch('parentId'))?.label}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreateAccountDialogOpen(false)
                  reset()
                  setAccountToCreateFor(null)
                }}
                disabled={creatingAccount}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={creatingAccount}>
                {creatingAccount ? 'Création...' : 'Créer le compte'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
