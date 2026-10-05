/**
 * Establishments management component
 * 
 * This component handles all establishment-related functionality including:
 * - Displaying establishments list
 * - Adding/editing/deleting establishments
 * - Managing training organization status and declaration numbers
 */

'use client'

import { useState, useEffect } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Plus, Edit, Trash2, Loader2, CheckCircle2, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/shared'
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
import { Checkbox } from '@/components/ui/checkbox'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { logger } from '@/lib/logger'
import * as z from 'zod'
import { formatAddress } from '@/lib/utils/address'
import { AddressSelector } from '@/components/ui/address-selector'
import type { Address } from '@/lib/utils/address'

const establishmentSchema = z.object({
  siret: z.string().min(14, 'Le SIRET doit contenir 14 chiffres').max(14, 'Le SIRET doit contenir 14 chiffres').regex(/^\d{14}$/, 'Le SIRET doit contenir exactement 14 chiffres'),
  name: z.string().optional(),
  addressId: z.string().nullable().optional(),
  activityCode: z.string().optional(),
  isMain: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
  isTrainingOrganization: z.boolean().optional(),
  trainingActivityDeclarationNumber: z.string().optional(),
  trainingActivityDeclarationDate: z.string().optional(),
})

type EstablishmentFormData = z.infer<typeof establishmentSchema>

interface Establishment {
  id: string
  companyId: string
  siret: string
  siren: string | null
  name: string | null
  address: Address | null
  addressId: string | null
  activityCode: string | null
  isMain: boolean
  isActive: boolean
  notes: string | null
  isTrainingOrganization: boolean
  trainingActivityDeclarationNumber: string | null
  trainingActivityDeclarationDate: string | null
  createdAt: string
  updatedAt: string
}

interface EstablishmentsManagementProps {
  companyId: string
}

export function EstablishmentsManagement({ companyId }: EstablishmentsManagementProps) {
  const [establishments, setEstablishments] = useState<Establishment[]>([])
  const [loading, setLoading] = useState(true)
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEstablishment, setEditingEstablishment] = useState<Establishment | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const methods = useForm<EstablishmentFormData>({
    resolver: zodResolver(establishmentSchema),
    defaultValues: {
      isMain: false,
      isActive: true,
      isTrainingOrganization: false,
    },
  })

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
    setValue,
  } = methods

  useEffect(() => {
    loadEstablishments()
  }, [companyId])

  async function loadEstablishments() {
    try {
      setLoading(true)
      const response = await fetch(`/api/companies/${companyId}/establishments`)
      if (response.ok) {
        const data = await response.json()
        setEstablishments(data)
      } else {
        toast.error('Erreur lors du chargement des établissements')
      }
    } catch (error) {
      logger.error('Error loading establishments:', error)
      toast.error('Erreur lors du chargement des établissements')
    } finally {
      setLoading(false)
    }
  }

  function openAddDialog() {
    setEditingEstablishment(null)
    reset({
      siret: '',
      name: '',
      addressId: null,
      activityCode: '',
      isMain: false,
      isActive: true,
      notes: '',
      isTrainingOrganization: false,
      trainingActivityDeclarationNumber: '',
      trainingActivityDeclarationDate: '',
    })
    setDialogOpen(true)
  }

  function openEditDialog(establishment: Establishment) {
    setEditingEstablishment(establishment)
    reset({
      siret: establishment.siret,
      name: establishment.name || '',
      addressId: establishment.addressId || null,
      activityCode: establishment.activityCode || '',
      isMain: establishment.isMain,
      isActive: establishment.isActive,
      notes: establishment.notes || '',
      isTrainingOrganization: establishment.isTrainingOrganization,
      trainingActivityDeclarationNumber: establishment.trainingActivityDeclarationNumber || '',
      trainingActivityDeclarationDate: establishment.trainingActivityDeclarationDate
        ? establishment.trainingActivityDeclarationDate.split('T')[0]
        : '',
    })
    setDialogOpen(true)
  }

  async function onSubmit(data: EstablishmentFormData) {
    if (!companyId) return

    setSubmitting(true)
    try {
      const url = editingEstablishment
        ? `/api/companies/${companyId}/establishments/${editingEstablishment.id}`
        : `/api/companies/${companyId}/establishments`
      
      const method = editingEstablishment ? 'PATCH' : 'POST'

      // Send data with addressId and clean date fields
      // Ensure addressId is explicitly set (string, null, or undefined)
      const cleanedData: any = {
        ...data,
        // Clean date fields - convert empty strings to null
        trainingActivityDeclarationDate: data.trainingActivityDeclarationDate?.trim() || null,
      }
      
      // Explicitly handle addressId - convert undefined/empty string to null
      if (data.addressId === undefined || data.addressId === '') {
        cleanedData.addressId = null
      } else {
        cleanedData.addressId = data.addressId
      }

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          companyId: companyId,
          ...cleanedData,
        }),
      })

      if (response.ok) {
        toast.success(
          editingEstablishment
            ? 'Établissement modifié avec succès'
            : 'Établissement créé avec succès'
        )
        setDialogOpen(false)
        reset() // Réinitialiser le formulaire
        loadEstablishments()
      } else {
        const errorData = await response.json()
        const errorMessage = errorData.error || 'Erreur lors de la sauvegarde'
        logger.error('Error creating establishment:', { error: errorData, status: response.status })
        toast.error(errorMessage)
      }
    } catch (error) {
      logger.error('Error saving establishment:', error)
      toast.error('Erreur lors de la sauvegarde')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(establishment: Establishment) {
    const ok = await confirm({
      title: `Supprimer l'établissement ${establishment.name || establishment.siret} ?`,
      description: "L'établissement et son statut d'organisme de formation seront supprimés.",
      confirmLabel: 'Supprimer',
    })
    if (!ok) return

    try {
      const response = await fetch(
        `/api/companies/${companyId}/establishments/${establishment.id}`,
        {
          method: 'DELETE',
        }
      )

      if (response.ok) {
        toast.success('Établissement supprimé avec succès')
        loadEstablishments()
      } else {
        const error = await response.json()
        toast.error(error.error || 'Erreur lors de la suppression')
      }
    } catch (error) {
      logger.error('Error deleting establishment:', error)
      toast.error('Erreur lors de la suppression')
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-64">
            <CardTitle>Établissements</CardTitle>
            <CardDescription>
              Gestion des établissements (SIRET) de la société. Chaque établissement peut avoir son propre statut d'organisme de formation.
            </CardDescription>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button type="button" onClick={openAddDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Ajouter un établissement
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingEstablishment ? 'Modifier l\'établissement' : 'Ajouter un établissement'}
                </DialogTitle>
                <DialogDescription>
                  {editingEstablishment
                    ? 'Modifiez les informations de l\'établissement'
                    : 'Ajoutez un nouvel établissement à la société'}
                </DialogDescription>
              </DialogHeader>
              <FormProvider {...methods}>
                <form onSubmit={handleSubmit(onSubmit)}>
                  <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="siret">SIRET *</Label>
                    <Input
                      id="siret"
                      {...register('siret')}
                      placeholder="12345678901234"
                      maxLength={14}
                      inputMode="numeric"
                      autoComplete="off"
                      disabled={!!editingEstablishment}
                    />
                    {errors.siret && (
                      <p className="text-sm text-destructive">{errors.siret.message}</p>
                    )}
                    {editingEstablishment && (
                      <p className="text-xs text-muted-foreground">
                        Le SIRET ne peut pas être modifié après création
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="name">Nom de l'établissement</Label>
                    <Input
                      id="name"
                      {...register('name')}
                      placeholder="Ex&nbsp;: Siège social, Agence Paris, etc."
                    />
                  </div>

                  <AddressSelector companyId={companyId} fieldPrefix="addressId" label="Adresse" defaultCountry="FR" />

                  <div className="space-y-2">
                    <Label htmlFor="activityCode">Code APE/NAF</Label>
                    <Input
                      id="activityCode"
                      {...register('activityCode')}
                      placeholder="Ex&nbsp;: 6201Z"
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="isMain"
                      checked={watch('isMain') || false}
                      onCheckedChange={(checked) => setValue('isMain', checked === true)}
                    />
                    <Label htmlFor="isMain" className="text-sm font-normal cursor-pointer">
                      Établissement principal
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="isActive"
                      checked={watch('isActive') !== false}
                      onCheckedChange={(checked) => setValue('isActive', checked === true)}
                    />
                    <Label htmlFor="isActive" className="text-sm font-normal cursor-pointer">
                      Établissement actif
                    </Label>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="isTrainingOrganization"
                        checked={watch('isTrainingOrganization') || false}
                        onCheckedChange={(checked) => setValue('isTrainingOrganization', checked === true)}
                      />
                      <Label htmlFor="isTrainingOrganization" className="text-sm font-normal cursor-pointer">
                        Organisme de formation
                      </Label>
                    </div>
                    {watch('isTrainingOrganization') && (
                      <div className="ml-6 space-y-2">
                        <Label htmlFor="trainingActivityDeclarationNumber" className="text-sm">
                          Numéro de déclaration d'activité
                        </Label>
                        <Input
                          id="trainingActivityDeclarationNumber"
                          {...register('trainingActivityDeclarationNumber')}
                          placeholder="Ex&nbsp;: 11 75 12345 75"
                        />
                        <div className="space-y-2">
                          <Label htmlFor="trainingActivityDeclarationDate" className="text-sm">
                            Date de déclaration d'activité
                          </Label>
                          <DatePicker
                            id="trainingActivityDeclarationDate"
                            date={
                              watch('trainingActivityDeclarationDate')
                                ? (() => {
                                    const dateStr = watch('trainingActivityDeclarationDate')
                                    if (!dateStr) return undefined
                                    const date = new Date(dateStr + 'T00:00:00')
                                    return isNaN(date.getTime()) ? undefined : date
                                  })()
                                : undefined
                            }
                            onDateChange={(date) => {
                              if (date) {
                                const year = date.getFullYear()
                                const month = String(date.getMonth() + 1).padStart(2, '0')
                                const day = String(date.getDate()).padStart(2, '0')
                                setValue(
                                  'trainingActivityDeclarationDate',
                                  `${year}-${month}-${day}`
                                )
                              } else {
                                setValue('trainingActivityDeclarationDate', '')
                              }
                            }}
                          />
                          <p className="text-xs text-muted-foreground">
                            Date de l'enregistrement de la déclaration d'activité. Chaque année, avant le 30 avril, l'organisme adresse le bilan pédagogique et financier (BPF) de son dernier exercice clos sur Mon Activité Formation (Code du travail, art. R6352-23)&nbsp;; sans BPF, la déclaration devient caduque (art. L6351-6).
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          La déclaration d'activité est enregistrée par la DREETS (DRIEETS en Île-de-France), qui a remplacé la DIRECCTE le 1er avril 2021.
                          Kledg prépare le bilan pédagogique et financier (BPF) dans États, Bilan pédagogique et financier.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="notes">Notes</Label>
                    <Textarea
                      id="notes"
                      {...register('notes')}
                      placeholder="Notes optionnelles sur l'établissement"
                      rows={3}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDialogOpen(false)}
                  >
                    Annuler
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Enregistrement...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        {editingEstablishment ? 'Modifier' : 'Créer'}
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </form>
              </FormProvider>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            Chargement des établissements...
          </div>
        ) : establishments.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Aucun établissement. Cliquez sur "Ajouter un établissement" pour en créer un.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SIRET</TableHead>
                <TableHead>Nom</TableHead>
                <TableHead>Adresse</TableHead>
                <TableHead>Code APE</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Organisme de formation</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {establishments.map((establishment) => (
                <TableRow key={establishment.id}>
                  <TableCell className="font-mono">{establishment.siret}</TableCell>
                  <TableCell>{establishment.name || '-'}</TableCell>
                  <TableCell>{establishment.address ? formatAddress(establishment.address) : '-'}</TableCell>
                  <TableCell>{establishment.activityCode || '-'}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      {establishment.isMain && (
                        <Badge variant="default">Principal</Badge>
                      )}
                      {!establishment.isActive && (
                        <Badge variant="secondary">Inactif</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {establishment.isTrainingOrganization ? (
                      <div className="space-y-1">
                        <Badge variant="success">
                          <Building2 className="mr-1 h-3 w-3" />
                          Oui
                        </Badge>
                        {establishment.trainingActivityDeclarationNumber && (
                          <p className="text-xs text-muted-foreground">
                            NDA&nbsp;: {establishment.trainingActivityDeclarationNumber}
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Non</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEditDialog(establishment)}
                        aria-label="Modifier"
                        title="Modifier"
                      >
                        <Edit aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(establishment)}
                        aria-label="Supprimer"
                        title="Supprimer"
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {confirmDialog}
    </Card>
  )
}
