/**
 * Shareholders management component
 * 
 * This component handles all shareholder-related functionality including:
 * - Displaying shareholders list
 * - Adding/editing/deleting shareholders
 * - Managing person creation for physical shareholders
 */

'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Plus, Edit, Trash2, Loader2, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Amount, EmptyState, formatAmount, formatPercent, useConfirm } from '@/components/shared'
import { plural } from '@/lib/utils/plural'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { optionalNumberInput, shareholderSchema, type ShareholderFormData } from './company-informations-schemas'
import type { Shareholder } from './company-informations-types'
import { CreatePersonForm } from './create-person-form'
import { logger } from '@/lib/logger'
import type { Address } from '@/lib/utils/address'

// Extended Shareholder interface with nested relations
interface ShareholderWithRelations extends Shareholder {
  /** A company of this instance: the API selects its SIREN (a company has no SIRET, its establishments do). */
  companyShareholder?: {
    id: string
    name: string
    siren: string | null
    legalType: string | null
  } | null
  person?: {
    id: string
    firstName: string
    name: string
    email: string | null
    phone: string | null
    address: string | null
  } | null
}

/** "Personne physique", "Société" (a company of this instance) or "Personne morale". */
export function shareholderKindLabel(shareholder: Pick<ShareholderWithRelations, 'type' | 'companyShareholderId' | 'person'>): string {
  if (shareholder.type === 'PHYSICAL') return 'Personne physique'
  return shareholder.companyShareholderId ? 'Société' : 'Personne morale'
}

interface ShareholdersManagementProps {
  companyId: string
  initialShareholders?: ShareholderWithRelations[]
}

/**
 * Shareholders management component
 */
export function ShareholdersManagement({
  companyId,
  initialShareholders = [],
}: ShareholdersManagementProps) {
  const [shareholders, setShareholders] = useState<ShareholderWithRelations[]>(initialShareholders)
  const [shareholdersLoading, setShareholdersLoading] = useState(true)
  const [shareholderDialogOpen, setShareholderDialogOpen] = useState(false)
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [persons, setPersons] = useState<Array<{ id: string; firstName: string; name: string; email: string | null }>>([])
  const [loadingPersons, setLoadingPersons] = useState(false)
  const [createPersonDialogOpen, setCreatePersonDialogOpen] = useState(false)
  const [creatingPerson, setCreatingPerson] = useState(false)
  const [editingShareholder, setEditingShareholder] = useState<ShareholderWithRelations | null>(null)
  const [shareholderLoading, setShareholderLoading] = useState(false)
  const [allCompanies, setAllCompanies] = useState<Array<{ id: string; name: string; slug?: string | null }>>([])

  const {
    register: registerShareholder,
    handleSubmit: handleSubmitShareholder,
    formState: { errors: errorsShareholder },
    reset: resetShareholder,
    watch: watchShareholder,
    setValue: setValueShareholder,
  } = useForm<ShareholderFormData>({
    resolver: zodResolver(shareholderSchema),
    defaultValues: {
      type: 'PHYSICAL',
      sharePercentage: 0,
    },
  })

  // Load companies for legal shareholder selection
  useEffect(() => {
    async function loadCompanies() {
      try {
        const response = await fetch('/api/companies')
        if (response.ok) {
          const companies = await response.json()
          setAllCompanies(
            companies.map((c: { id: string; name: string; slug?: string | null }) => ({
              id: c.id,
              name: c.name,
              slug: c.slug,
            })),
          )
        }
      } catch (error) {
        logger.error('Error loading companies:', error)
      }
    }
    loadCompanies()
  }, [])

  // Load the persons of the company
  useEffect(() => {
    if (companyId) void loadPersons()
  }, [companyId])

  // Always load the list with its persons and companies: rows given by the
  // company read carry only ids, so a natural person would show no name
  useEffect(() => {
    if (companyId) void loadShareholders()
  }, [companyId])

  const loadPersons = async () => {
    try {
      setLoadingPersons(true)
      const response = await fetch(`/api/companies/${companyId}/persons`)
      if (response.ok) {
        const data = await response.json()
        setPersons(data.map((p: any) => ({
          id: p.id,
          firstName: p.firstName,
          name: p.name,
          email: p.email,
        })))
      }
    } catch (error) {
      logger.error('Error loading persons:', error)
    } finally {
      setLoadingPersons(false)
    }
  }

  const loadShareholders = async () => {
    try {
      const response = await fetch(`/api/companies/${companyId}/shareholders`)
      if (response.ok) {
        const shareholdersData = await response.json()
        setShareholders(shareholdersData)
      }
    } catch (error) {
      logger.error('Error loading shareholders:', error)
    } finally {
      setShareholdersLoading(false)
    }
  }

  const handleCreatePerson = async (data: {
    firstName: string
    name: string
    email?: string
    phone?: string
    photo?: string
    address?: Address
  }) => {
    setCreatingPerson(true)
    try {
      const response = await fetch(`/api/companies/${companyId}/persons`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        logger.error('Error creating person:', errorData)
        toast.error(errorData.error || 'Erreur lors de la création de la personne')
        throw new Error(errorData.error || 'Failed to create person')
      }

      const newPerson = await response.json()
      logger.info('Person created successfully:', newPerson)
      
      // Reload persons list
      await loadPersons()
      
      // Select the newly created person
      setValueShareholder('personId', newPerson.id)
      setValueShareholder('createPerson', false)
      
      // Close dialog
      setCreatePersonDialogOpen(false)
      
      toast.success('Personne créée avec succès')
    } catch (error) {
      logger.error('Error creating person:', error)
      toast.error('Erreur lors de la création de la personne')
    } finally {
      setCreatingPerson(false)
    }
  }

  const handleDeleteShareholder = async (shareholder: ShareholderWithRelations) => {
    const shareholderName =
      shareholder.type === 'PHYSICAL' && shareholder.person
        ? `${shareholder.person.firstName} ${shareholder.person.name}`
        : shareholder.name || shareholder.companyShareholder?.name || 'cet actionnaire'
    const ok = await confirm({
      title: `Supprimer ${shareholderName} des actionnaires ?`,
      description: 'Les parts détenues seront retirées de la répartition du capital.',
      confirmLabel: 'Supprimer',
    })
    if (!ok) return

    try {
      const response = await fetch(
        `/api/companies/${companyId}/shareholders/${shareholder.id}`,
        {
          method: 'DELETE',
        }
      )

      if (response.ok) {
        setShareholders(shareholders.filter((s) => s.id !== shareholder.id))
        toast.success('Actionnaire supprimé avec succès')
      } else {
        const error = await response.json()
        toast.error(error.error || 'Erreur lors de la suppression')
      }
    } catch (error) {
      logger.error('Error deleting shareholder:', error)
      toast.error('Erreur lors de la suppression de l\'actionnaire')
    }
  }

  const handleEditShareholder = (shareholder: ShareholderWithRelations) => {
    setEditingShareholder(shareholder)
    resetShareholder({
      type: shareholder.type,
      name: shareholder.name || undefined,
      siret: shareholder.siret || undefined,
      sharePercentage: parseFloat(shareholder.sharePercentage.toString()),
      numberOfShares: shareholder.numberOfShares || undefined,
      capitalAmount: shareholder.capitalAmount
        ? parseFloat(shareholder.capitalAmount.toString())
        : undefined,
      companyShareholderId: shareholder.companyShareholderId || undefined,
      notes: shareholder.notes || undefined,
      personId: shareholder.personId || shareholder.person?.id || undefined,
    })
    setShareholderDialogOpen(true)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-64">
            <CardTitle>Actionnaires</CardTitle>
            <CardDescription>
              Gestion des actionnaires de la société (personnes physiques ou morales)
            </CardDescription>
          </div>
          <Dialog open={shareholderDialogOpen} onOpenChange={setShareholderDialogOpen}>
            <DialogTrigger asChild>
              <Button
                type="button"
                onClick={() => {
                  setEditingShareholder(null)
                  resetShareholder({
                    type: 'PHYSICAL',
                    sharePercentage: 0,
                  })
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Ajouter un actionnaire
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingShareholder ? 'Modifier l\'actionnaire' : 'Ajouter un actionnaire'}
                </DialogTitle>
                <DialogDescription>
                  {editingShareholder
                    ? 'Modifiez les informations de l\'actionnaire'
                    : 'Ajoutez un nouvel actionnaire à la société'}
                </DialogDescription>
                {editingShareholder && (
                  <div className="mt-4 p-4 bg-muted rounded-lg space-y-2 text-left">
                    <div className="text-sm font-medium">Actionnaire actuel&nbsp;:</div>
                    <div className="text-sm">
                      {editingShareholder.type === 'PHYSICAL' && editingShareholder.person ? (
                        <div>
                          <div className="font-medium">
                            {editingShareholder.person.firstName} {editingShareholder.person.name}
                          </div>
                          {editingShareholder.person.email && (
                            <div className="text-xs text-muted-foreground">
                              {editingShareholder.person.email}
                            </div>
                          )}
                          {editingShareholder.person.phone && (
                            <div className="text-xs text-muted-foreground">
                              {editingShareholder.person.phone}
                            </div>
                          )}
                        </div>
                      ) : editingShareholder.type === 'LEGAL' && editingShareholder.companyShareholder ? (
                        <div>
                          <div className="font-medium">
                            {editingShareholder.companyShareholder.name}
                          </div>
                          {editingShareholder.companyShareholder.siren && (
                            <div className="text-xs text-muted-foreground">
                              SIREN&nbsp;: {editingShareholder.companyShareholder.siren}
                            </div>
                          )}
                          {editingShareholder.companyShareholder.legalType && (
                            <div className="text-xs text-muted-foreground">
                              {editingShareholder.companyShareholder.legalType}
                            </div>
                          )}
                        </div>
                      ) : editingShareholder.name ? (
                        <div>
                          <div className="font-medium">{editingShareholder.name}</div>
                          {editingShareholder.siret && (
                            <div className="text-xs text-muted-foreground">
                              SIRET&nbsp;: {editingShareholder.siret}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-muted-foreground">Actionnaire sans nom</div>
                      )}
                      <div className="text-xs text-muted-foreground mt-2">
                        Participation actuelle&nbsp;: {formatPercent(editingShareholder.sharePercentage.toString())}
                        {editingShareholder.numberOfShares ? (
                          <> ({plural(editingShareholder.numberOfShares, 'part')})</>
                        ) : null}
                        {editingShareholder.capitalAmount ? (
                          <>, {formatAmount(editingShareholder.capitalAmount.toString())}</>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}
              </DialogHeader>
              <form
                onSubmit={handleSubmitShareholder(async (data) => {
                  if (!companyId) return

                  setShareholderLoading(true)
                  try {
                    const url = editingShareholder
                      ? `/api/companies/${companyId}/shareholders/${editingShareholder.id}`
                      : `/api/companies/${companyId}/shareholders`
                    const method = editingShareholder ? 'PATCH' : 'POST'

                    // Prepare request data
                    const requestData = {
                      ...data,
                      // If personId is provided, don't create a new person
                      createPerson: data.type === 'PHYSICAL' && !data.personId && data.createPerson !== false,
                    }

                    const response = await fetch(url, {
                      method,
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify(requestData),
                    })

                    if (response.ok) {
                      const shareholder = await response.json()
                      if (editingShareholder) {
                        setShareholders(
                          shareholders.map((s) => (s.id === shareholder.id ? shareholder : s))
                        )
                      } else {
                        setShareholders([...shareholders, shareholder])
                      }
                      setShareholderDialogOpen(false)
                      setEditingShareholder(null)
                      resetShareholder()
                      toast.success(
                        editingShareholder
                          ? 'Actionnaire modifié avec succès'
                          : 'Actionnaire ajouté avec succès'
                      )
                    } else {
                      const error = await response.json()
                      toast.error(error.error || 'Erreur lors de l\'enregistrement')
                    }
                  } catch (error) {
                    logger.error('Error saving shareholder:', error)
                    toast.error('Erreur lors de l\'enregistrement de l\'actionnaire')
                  } finally {
                    setShareholderLoading(false)
                  }
                })}
              >
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="shareholder-type">Type *</Label>
                    <Select
                      value={watchShareholder('type')}
                      onValueChange={(value) => setValueShareholder('type', value as 'PHYSICAL' | 'LEGAL')}
                    >
                      <SelectTrigger id="shareholder-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PHYSICAL">Personne physique</SelectItem>
                        <SelectItem value="LEGAL">Personne morale</SelectItem>
                      </SelectContent>
                    </Select>
                    {errorsShareholder.type && (
                      <p className="text-sm text-destructive">{errorsShareholder.type.message}</p>
                    )}
                  </div>

                  {watchShareholder('type') === 'PHYSICAL' && (
                    <div className="space-y-2">
                      <Label htmlFor="shareholder-personId">Personne *</Label>
                      <div className="flex gap-2 items-center">
                        <Select
                          value={watchShareholder('personId') || undefined}
                          onValueChange={(value) => {
                            if (value) {
                              const selectedPerson = persons.find((p) => p.id === value)
                              if (selectedPerson) {
                                setValueShareholder('personId', value)
                                setValueShareholder('createPerson', false)
                              }
                            } else {
                              setValueShareholder('personId', undefined)
                            }
                          }}
                        >
                          <SelectTrigger id="shareholder-personId" className="flex-1">
                            <SelectValue placeholder="Sélectionner une personne existante" />
                          </SelectTrigger>
                          <SelectContent>
                            {persons.length > 0 ? (
                              persons.map((person) => (
                                <SelectItem key={person.id} value={person.id}>
                                  {person.firstName} {person.name} {person.email && `(${person.email})`}
                                </SelectItem>
                              ))
                            ) : (
                              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                Aucune personne disponible
                              </div>
                            )}
                          </SelectContent>
                        </Select>
                        <Dialog open={createPersonDialogOpen} onOpenChange={setCreatePersonDialogOpen}>
                          <DialogTrigger asChild>
                            <Button type="button" variant="outline" size="icon" className="shrink-0">
                              <Plus className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-md">
                            <DialogHeader>
                              <DialogTitle>Créer une nouvelle personne</DialogTitle>
                              <DialogDescription>
                                Créez une nouvelle personne physique qui sera automatiquement liée à cet actionnaire.
                              </DialogDescription>
                            </DialogHeader>
                            <CreatePersonForm
                              companyId={companyId}
                              onSubmit={handleCreatePerson}
                              onCancel={() => setCreatePersonDialogOpen(false)}
                              loading={creatingPerson}
                            />
                          </DialogContent>
                        </Dialog>
                      </div>
                      {errorsShareholder.personId ? (
                        <p className="text-sm text-destructive">{errorsShareholder.personId.message}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Sélectionnez une personne existante ou créez-en une nouvelle avec le bouton +
                        </p>
                      )}
                    </div>
                  )}

                  {watchShareholder('type') === 'LEGAL' && !watchShareholder('companyShareholderId') && (
                    <div className="space-y-2">
                      <Label htmlFor="shareholder-name">Raison sociale *</Label>
                      <Input
                        id="shareholder-name"
                        {...registerShareholder('name')}
                        placeholder="Raison sociale"
                      />
                      {errorsShareholder.name && (
                        <p className="text-sm text-destructive">{errorsShareholder.name.message}</p>
                      )}
                    </div>
                  )}

                  {watchShareholder('type') === 'LEGAL' && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="shareholder-companyShareholderId">Société actionnaire (optionnel)</Label>
                        <Select
                          value={watchShareholder('companyShareholderId') || 'none'}
                          onValueChange={(value) => {
                            setValueShareholder('companyShareholderId', value === 'none' ? undefined : value)
                            if (value && value !== 'none') {
                              const selectedCompany = allCompanies.find((c) => c.id === value)
                              if (selectedCompany) {
                                setValueShareholder('name', '')
                              }
                            }
                          }}
                        >
                          <SelectTrigger id="shareholder-companyShareholderId">
                            <SelectValue placeholder="Sélectionner une société (ou laisser vide pour une personne morale externe)" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Personne morale externe</SelectItem>
                            {allCompanies
                              // companyId comes from the URL: an id or a slug
                              .filter((c) => c.id !== companyId && c.slug !== companyId)
                              .map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          Si une société est sélectionnée, elle sera utilisée comme actionnaire. Sinon, saisissez les informations manuellement.
                        </p>
                      </div>
                      {!watchShareholder('companyShareholderId') && (
                        <div className="space-y-2">
                          <Label htmlFor="shareholder-siret">SIRET</Label>
                          <Input
                            id="shareholder-siret"
                            {...registerShareholder('siret')}
                            placeholder="12345678901234"
                            maxLength={14}
                            inputMode="numeric"
                            autoComplete="off"
                          />
                        </div>
                      )}
                    </>
                  )}

                  <div className="grid grid-cols-3 gap-4 items-start">
                    <div className="space-y-2 min-w-0">
                      <Label htmlFor="shareholder-sharePercentage" className="block">
                        Pourcentage de participation *
                      </Label>
                      <Input
                        id="shareholder-sharePercentage"
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        {...registerShareholder('sharePercentage', { valueAsNumber: true })}
                        placeholder="0.00"
                        className="w-full"
                      />
                      {errorsShareholder.sharePercentage && (
                        <p className="text-sm text-destructive">
                          {errorsShareholder.sharePercentage.message}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2 min-w-0">
                      <Label htmlFor="shareholder-numberOfShares" className="block">
                        Nombre de parts
                      </Label>
                      <Input
                        id="shareholder-numberOfShares"
                        type="number"
                        step="1"
                        min="1"
                        {...registerShareholder('numberOfShares', { setValueAs: optionalNumberInput })}
                        placeholder="0"
                        className="w-full"
                      />
                    </div>

                    <div className="space-y-2 min-w-0">
                      <Label htmlFor="shareholder-capitalAmount" className="block">
                        Montant du capital (€)
                      </Label>
                      <Input
                        id="shareholder-capitalAmount"
                        type="number"
                        step="0.01"
                        min="0"
                        {...registerShareholder('capitalAmount', { setValueAs: optionalNumberInput })}
                        placeholder="0.00"
                        className="w-full"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="shareholder-notes">Notes</Label>
                    <Textarea
                      id="shareholder-notes"
                      {...registerShareholder('notes')}
                      placeholder="Notes optionnelles"
                      rows={3}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShareholderDialogOpen(false)
                      setEditingShareholder(null)
                      resetShareholder()
                    }}
                  >
                    Annuler
                  </Button>
                  <Button type="submit" disabled={shareholderLoading}>
                    {shareholderLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Enregistrement...
                      </>
                    ) : (
                      'Enregistrer'
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent aria-busy={shareholdersLoading || undefined}>
        {shareholdersLoading && shareholders.length === 0 ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : shareholders.length === 0 ? (
          <EmptyState
            className="py-2"
            title="Aucun actionnaire enregistré"
            description="Ajoutez les associés de la société et leur part du capital avec « Ajouter un actionnaire »."
          />
        ) : (
          <div className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Nom / Raison sociale</TableHead>
                  <TableHead numeric>Participation</TableHead>
                  <TableHead numeric>Capital</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shareholders.map((shareholder) => {
                  const isCompanyShareholder = shareholder.type === 'LEGAL' && shareholder.companyShareholderId
                  return (
                    <TableRow key={shareholder.id}>
                      <TableCell>{shareholderKindLabel(shareholder)}</TableCell>
                      <TableCell>
                        {isCompanyShareholder && shareholder.companyShareholder ? (
                          <div>
                            <div className="font-medium">{shareholder.companyShareholder.name}</div>
                            {shareholder.companyShareholder.siren && (
                              <div className="text-xs text-muted-foreground">SIREN&nbsp;: {shareholder.companyShareholder.siren}</div>
                            )}
                          </div>
                        ) : shareholder.type === 'PHYSICAL' && shareholder.person ? (
                          <div>
                            <div className="font-medium">{shareholder.person.firstName} {shareholder.person.name}</div>
                            <div className="text-xs text-success flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              <span>Personne liée</span>
                            </div>
                          </div>
                        ) : shareholder.type === 'PHYSICAL' ? (
                          <div className="text-muted-foreground">Personne non liée</div>
                        ) : (
                          shareholder.name || shareholder.companyShareholder?.name || 'Personne morale'
                        )}
                      </TableCell>
                      <TableCell numeric>
                        <span className="num whitespace-nowrap">{formatPercent(shareholder.sharePercentage.toString())}</span>
                        {shareholder.numberOfShares ? (
                          <div className="text-xs text-muted-foreground">{plural(shareholder.numberOfShares, 'part')}</div>
                        ) : null}
                      </TableCell>
                      <TableCell numeric>
                        <Amount value={shareholder.capitalAmount?.toString()} empty="Non renseigné" />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleEditShareholder(shareholder)}
                            aria-label="Modifier"
                            title="Modifier"
                          >
                            <Edit aria-hidden />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleDeleteShareholder(shareholder)}
                            aria-label="Supprimer"
                            title="Supprimer"
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <div className="text-sm text-muted-foreground">
              Total des participations&nbsp;:{' '}
              <span className="num font-semibold">
                {formatPercent(
                  // Hundredths of a percent are summed as integers: 33,33 + 33,33 + 33,34 reads 100 %
                  shareholders.reduce((sum, s) => sum + Math.round(Number(s.sharePercentage.toString()) * 100), 0) / 100,
                )}
              </span>
            </div>
          </div>
        )}
      </CardContent>
      {confirmDialog}
    </Card>
  )
}
