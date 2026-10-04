/**
 * Create person form component
 * 
 * This component provides a form for creating a new person,
 * used when adding a physical shareholder.
 */

'use client'

import { useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DialogFooter } from '@/components/ui/dialog'
import { Loader2, User } from 'lucide-react'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { AddressSelector } from '@/components/ui/address-selector'
import { addressSchema } from '@/lib/utils/address'

const MAX_PHOTO_SIZE_BYTES = 2 * 1024 * 1024
import type { Address } from '@/lib/utils/address'

const personFormSchema = z.object({
  firstName: z.string().min(1, 'Le prénom est requis'),
  name: z.string().min(1, 'Le nom est requis'),
  email: z.string().email('Email invalide').optional().or(z.literal('')),
  phone: z.string().optional(),
  photo: z.string().optional(),
  address: addressSchema.optional().nullable(),
})

type PersonFormData = z.infer<typeof personFormSchema>

interface CreatePersonFormProps {
  /** Company whose addresses the address picker searches */
  companyId: string
  onSubmit: (data: {
    firstName: string
    name: string
    email?: string
    phone?: string
    photo?: string
    address?: Address
  }) => Promise<void>
  onCancel: () => void
  loading: boolean
}

/**
 * Component for creating a new person
 */
export function CreatePersonForm({
  companyId,
  onSubmit,
  onCancel,
  loading,
}: CreatePersonFormProps) {
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)

  const methods = useForm<PersonFormData>({
    resolver: zodResolver(personFormSchema),
    // No address until one is picked or created: an empty address object would
    // fail its own validation and block the form without a visible message.
    defaultValues: {
      address: null,
    },
  })

  const { register, handleSubmit, formState: { errors }, reset, setValue, watch } = methods
  const photoValue = watch('photo')

  const handlePhotoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Veuillez sélectionner un fichier image')
      return
    }
    if (file.size > MAX_PHOTO_SIZE_BYTES) {
      toast.error("L'image ne doit pas dépasser 2 Mo")
      return
    }
    const reader = new FileReader()
    reader.onloadend = () => {
      const base64String = reader.result as string
      setPhotoPreview(base64String)
      setValue('photo', base64String)
    }
    reader.readAsDataURL(file)
  }

  const onFormSubmit = async (data: PersonFormData) => {
    try {
      await onSubmit({
        firstName: data.firstName,
        name: data.name,
        email: data.email || undefined,
        phone: data.phone || undefined,
        photo: data.photo || undefined,
        address: data.address || undefined,
      })
      reset({
        firstName: '',
        name: '',
        email: '',
        phone: '',
        photo: '',
        address: null,
      })
      setPhotoPreview(null)
    } catch (error) {
      logger.error('Error in handleSubmit:', error)
    }
  }

  const displayPhoto = photoPreview ?? photoValue ?? null

  return (
    <FormProvider {...methods}>
      <form
        onSubmit={(event) => {
          // Rendered inside the shareholder form (through a dialog portal): React
          // would bubble this submit up to it and validate the shareholder too.
          event.stopPropagation()
          void handleSubmit(onFormSubmit)(event)
        }}
        className="space-y-4"
      >
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted">
            {displayPhoto ? (
              <img
                src={displayPhoto}
                alt="Photo"
                className="h-full w-full object-cover"
              />
            ) : (
              <User className="h-10 w-10 text-muted-foreground" />
            )}
          </div>
          <div className="space-y-2">
            <Label>Photo</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => document.getElementById('person-photo-input')?.click()}
              >
                Choisir une image
              </Button>
              {displayPhoto && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPhotoPreview(null)
                    setValue('photo', '')
                  }}
                >
                  Supprimer
                </Button>
              )}
            </div>
            <input
              id="person-photo-input"
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={handlePhotoUpload}
            />
            <p className="text-xs text-muted-foreground">Max 2 Mo, JPG ou PNG</p>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="person-firstName">Prénom *</Label>
        <Input
          id="person-firstName"
          {...register('firstName')}
          placeholder="Prénom"
        />
        {errors.firstName && (
          <p className="text-sm text-destructive">{errors.firstName.message}</p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="person-name">Nom *</Label>
        <Input
          id="person-name"
          {...register('name')}
          placeholder="Nom"
        />
        {errors.name && (
          <p className="text-sm text-destructive">{errors.name.message}</p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="person-email">Email</Label>
        <Input
          id="person-email"
          type="email"
          autoComplete="off"
          spellCheck={false}
          {...register('email')}
          placeholder="email@example.com"
        />
        {errors.email && (
          <p className="text-sm text-destructive">{errors.email.message}</p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="person-phone">Téléphone</Label>
        <Input
          id="person-phone"
          type="tel"
          autoComplete="off"
          {...register('phone')}
          placeholder="01 23 45 67 89"
        />
      </div>
      <AddressSelector companyId={companyId} fieldPrefix="address" label="Adresse" />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          Annuler
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Création...
            </>
          ) : (
            'Créer'
          )}
        </Button>
      </DialogFooter>
    </form>
    </FormProvider>
  )
}
