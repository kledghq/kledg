/**
 * Address form component
 * 
 * Reusable component for entering structured address information
 */

'use client'

import { useFormContext, Controller, type Control, type FieldErrors } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Address } from '@/lib/utils/address'
import { createEmptyAddress } from '@/lib/utils/address'

// Common country codes (ISO 3166-1 alpha-2)
const COUNTRIES = [
  { code: 'FR', name: 'France' },
  { code: 'BE', name: 'Belgique' },
  { code: 'CH', name: 'Suisse' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'DE', name: 'Allemagne' },
  { code: 'ES', name: 'Espagne' },
  { code: 'IT', name: 'Italie' },
  { code: 'GB', name: 'Royaume-Uni' },
  { code: 'US', name: 'États-Unis' },
  { code: 'CA', name: 'Canada' },
  { code: 'PT', name: 'Portugal' },
  { code: 'NL', name: 'Pays-Bas' },
]

interface AddressFormProps {
  /**
   * Field name prefix for the form (e.g., "address" or "headquartersAddress")
   * The component will use: {prefix}.street, {prefix}.street2, etc.
   */
  fieldPrefix?: string
  /**
   * Whether all fields are required
   */
  required?: boolean
  /**
   * Custom label for the address section
   */
  label?: string
  /**
   * Show country selector (default: true)
   */
  showCountry?: boolean
  /**
   * Default country code (default: "FR")
   */
  defaultCountry?: string
  /**
   * Optional control from react-hook-form
   * If not provided, will use useFormContext()
   */
  control?: Control<any>
  /**
   * Optional errors from react-hook-form
   * If not provided, will use useFormContext()
   */
  errors?: FieldErrors<any>
}

export function AddressForm({
  fieldPrefix = 'address',
  required = false,
  label,
  showCountry = true,
  defaultCountry = 'FR',
  control: controlProp,
  errors: errorsProp,
}: AddressFormProps) {
  // Try to use form context if control/errors not provided
  // useFormContext returns null outside of a FormProvider.
  const formContext = useFormContext() as {
    control: Control<any>
    formState: { errors: FieldErrors<any> }
  } | null

  // Use provided props or fallback to form context
  const control = controlProp || formContext?.control
  const errors = errorsProp || formContext?.formState.errors

  if (!control) {
    throw new Error(
      'AddressForm requires either a `control` prop or to be used within a FormProvider from react-hook-form'
    )
  }

  const getFieldName = (field: keyof Address) => {
    return `${fieldPrefix}.${field}` as const
  }

  const getError = (field: keyof Address) => {
    const fieldName = getFieldName(field)
    if (!errors) return undefined
    const error = errors[fieldPrefix as string]
    if (error && typeof error === 'object') {
      // Check if error has nested field errors (react-hook-form structure)
      const nestedError = error as Record<string, { message?: string } | undefined>
      const fieldError = nestedError[field]
      if (fieldError && typeof fieldError === 'object' && 'message' in fieldError) {
        return fieldError.message
      }
    }
    return undefined
  }

  return (
    <div className="space-y-4">
      {label && (
        <div>
          <Label className="text-base font-semibold">{label}</Label>
        </div>
      )}
      
      <div className="space-y-2">
        <Label htmlFor={`${fieldPrefix}-street`}>
          Rue et numéro {required && <span className="text-destructive">*</span>}
        </Label>
        <Controller
          name={getFieldName('street')}
          control={control}
          rules={{ required: required ? 'La rue est requise' : false }}
          render={({ field }) => (
            <Input
              id={`${fieldPrefix}-street`}
              {...field}
              placeholder="Ex&nbsp;: 123 Rue de la République"
              aria-invalid={!!getError('street')}
            />
          )}
        />
        {getError('street') && (
          <p className="text-sm text-destructive">{getError('street')}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${fieldPrefix}-street2`}>Complément d'adresse</Label>
        <Controller
          name={getFieldName('street2')}
          control={control}
          render={({ field }) => (
            <Input
              id={`${fieldPrefix}-street2`}
              {...field}
              placeholder="Ex&nbsp;: Appartement 4B, Bâtiment A, etc."
              aria-invalid={!!getError('street2')}
            />
          )}
        />
        {getError('street2') && (
          <p className="text-sm text-destructive">{getError('street2')}</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor={`${fieldPrefix}-postalCode`}>
            Code postal {required && <span className="text-destructive">*</span>}
          </Label>
          <Controller
            name={getFieldName('postalCode')}
            control={control}
            rules={{ required: required ? 'Le code postal est requis' : false }}
            render={({ field }) => (
              <Input
                id={`${fieldPrefix}-postalCode`}
                {...field}
                placeholder="75001"
                maxLength={10}
                aria-invalid={!!getError('postalCode')}
              />
            )}
          />
          {getError('postalCode') && (
            <p className="text-sm text-destructive">{getError('postalCode')}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${fieldPrefix}-city`}>
            Ville {required && <span className="text-destructive">*</span>}
          </Label>
          <Controller
            name={getFieldName('city')}
            control={control}
            rules={{ required: required ? 'La ville est requise' : false }}
            render={({ field }) => (
              <Input
                id={`${fieldPrefix}-city`}
                {...field}
                placeholder="Paris"
                aria-invalid={!!getError('city')}
              />
            )}
          />
          {getError('city') && (
            <p className="text-sm text-destructive">{getError('city')}</p>
          )}
        </div>
      </div>

      {showCountry && (
        <div className="space-y-2">
          <Label htmlFor={`${fieldPrefix}-country`}>
            Pays {required && <span className="text-destructive">*</span>}
          </Label>
          <Controller
            name={getFieldName('country')}
            control={control}
            rules={{ required: required ? 'Le pays est requis' : false }}
            defaultValue={defaultCountry}
            render={({ field }) => (
              <Select
                value={field.value || defaultCountry}
                onValueChange={field.onChange}
              >
                <SelectTrigger
                  id={`${fieldPrefix}-country`}
                  className="w-full"
                  aria-invalid={!!getError('country')}
                >
                  <SelectValue placeholder="Sélectionner un pays" />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map((country) => (
                    <SelectItem key={country.code} value={country.code}>
                      {country.name} ({country.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {getError('country') && (
            <p className="text-sm text-destructive">{getError('country')}</p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Helper function to get default address values for form initialization
 * Handles both Address objects and AddressModel relations from Prisma
 */
export function getDefaultAddressValue(
  address: Address | { street: string; street2?: string | null; postalCode: string; city: string; country: string } | null | undefined,
  defaultCountry: string = 'FR'
): Address {
  if (address) {
    return {
      street: address.street || '',
      street2: address.street2 || '',
      postalCode: address.postalCode || '',
      city: address.city || '',
      country: address.country || defaultCountry,
    }
  }
  return createEmptyAddress(defaultCountry)
}
