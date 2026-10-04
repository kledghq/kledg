/**
 * Address selector component
 * 
 * Allows users to search and select existing addresses or create new ones
 */

'use client'

import { useState, useEffect, useCallback } from 'react'
import { useFormContext, Controller } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { CommandEmpty, CommandGroup } from '@/components/ui/command'
import { Autocomplete, AutocompleteItem } from '@/components/ui/autocomplete'
import { Check, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Address } from '@/lib/utils/address'
import { formatAddress } from '@/lib/utils/address'
import { AddressForm } from './address-form'

interface AddressSelectorProps {
  /**
   * Company whose addresses are searched and created (id or slug)
   */
  companyId: string
  /**
   * Field name prefix for the form (e.g., "address" or "headquartersAddress")
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
}

interface AddressOption {
  id: string
  street: string
  street2?: string | null
  postalCode: string
  city: string
  country: string
}

export function AddressSelector({
  companyId,
  fieldPrefix = 'address',
  required = false,
  label,
  showCountry = true,
  defaultCountry = 'FR',
}: AddressSelectorProps) {
  const { control, setValue, watch } = useFormContext()
  const [searchTerm, setSearchTerm] = useState('')
  const [addresses, setAddresses] = useState<AddressOption[]>([])
  const [loading, setLoading] = useState(false)
  const [savingAddress, setSavingAddress] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [selectedAddressData, setSelectedAddressData] = useState<AddressOption | null>(null)

  // Check if we're storing ID (fieldPrefix ends with "Id") or Address object
  const isStoringId = fieldPrefix.endsWith('Id')
  const addressFieldPrefix = isStoringId ? fieldPrefix.replace(/Id$/, '') : fieldPrefix

  const currentAddressId = isStoringId ? watch(fieldPrefix) as string | null | undefined : null
  const currentAddress = !isStoringId ? watch(fieldPrefix) as Address | null | undefined : null

  // Load address data when addressId is set (for display purposes)
  useEffect(() => {
    if (isStoringId && currentAddressId) {
      // Check if we already have this address loaded
      if (selectedAddressData?.id === currentAddressId) {
        return
      }
      
      // Find the address in the addresses list first
      const found = addresses.find(a => a.id === currentAddressId)
      if (found) {
        setSelectedAddressData(found)
        return
      }
      
      // Fetch address by ID if not in list
      let cancelled = false
      const loadAddress = async () => {
        try {
          const res = await fetch(`/api/addresses/${encodeURIComponent(currentAddressId)}?companyId=${encodeURIComponent(companyId)}`)
          if (res.ok) {
            const data = await res.json()
            if (!cancelled && data && data.id === currentAddressId) {
              setSelectedAddressData({
                id: data.id,
                street: data.street,
                street2: data.street2 || null,
                postalCode: data.postalCode,
                city: data.city,
                country: data.country,
              })
            }
          }
        } catch (error) {
          // Silently fail
        }
      }
      
      loadAddress()
      
      return () => {
        cancelled = true
      }
    } else if (!currentAddressId) {
      setSelectedAddressData(null)
    }
  }, [companyId, currentAddressId, addresses, isStoringId, selectedAddressData])

  // Search addresses when search term changes
  const searchAddresses = useCallback(async (term: string) => {
    if (term.length < 2) {
      setAddresses([])
      return
    }

    setLoading(true)
    try {
      const response = await fetch(
        `/api/addresses?companyId=${encodeURIComponent(companyId)}&search=${encodeURIComponent(term)}&limit=10`,
      )
      if (response.ok) {
        const data = await response.json()
        setAddresses(data)
      }
    } catch (error) {
      // Silently fail - user can retry
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchTerm) {
        searchAddresses(searchTerm)
      }
    }, 300) // Debounce search

    return () => clearTimeout(timeoutId)
  }, [searchTerm, searchAddresses])

  const selectAddress = (address: AddressOption) => {
    if (isStoringId) {
      // Store the ID
      setValue(fieldPrefix, address.id, { shouldValidate: true })
      setSelectedAddressData(address)
    } else {
      // Store the Address object (legacy behavior)
      const addressValue: Address = {
        street: address.street,
        street2: address.street2 || undefined,
        postalCode: address.postalCode,
        city: address.city,
        country: address.country,
      }
      setValue(fieldPrefix, addressValue, { shouldValidate: true })
    }
    setSearchTerm('')
    setShowNewForm(false)
  }

  const handleSaveNewAddress = async () => {
    // Get address data from form
    const addressFormData = watch(addressFieldPrefix) as Address | null | undefined
    if (!addressFormData || !addressFormData.street || !addressFormData.postalCode || !addressFormData.city) {
      return
    }

    setSavingAddress(true)
    try {
      // Create address via API
      const response = await fetch('/api/addresses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...addressFormData, companyId }),
      })

      if (response.ok) {
        const { id } = await response.json()
        if (isStoringId) {
          setValue(fieldPrefix, id, { shouldValidate: true })
          // Find the created address in the list or set it manually
          const createdAddress: AddressOption = {
            id,
            street: addressFormData.street,
            street2: addressFormData.street2 || null,
            postalCode: addressFormData.postalCode,
            city: addressFormData.city,
            country: addressFormData.country || 'FR',
          }
          setSelectedAddressData(createdAddress)
        } else {
          setValue(fieldPrefix, addressFormData, { shouldValidate: true })
        }
        setShowNewForm(false)
        setSearchTerm('')
      } else {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create address')
      }
    } catch (error) {
      // Silently fail - user can retry
    } finally {
      setSavingAddress(false)
    }
  }

  const handleNewAddress = () => {
    setShowNewForm(true)
  }

  // Determine display address
  const displayAddress: Address | null = isStoringId && selectedAddressData
    ? {
        street: selectedAddressData.street,
        street2: selectedAddressData.street2 || undefined,
        postalCode: selectedAddressData.postalCode,
        city: selectedAddressData.city,
        country: selectedAddressData.country,
      }
    : (currentAddress || null)


  return (
    <div className="space-y-4">
      {label && (
        <div>
          <Label className="text-base font-semibold">{label}</Label>
        </div>
      )}

      {!showNewForm ? (
        <div className="flex gap-2">
          <Autocomplete
            className="flex-1 min-w-0"
            shouldFilter={false}
            query={searchTerm}
            onQueryChange={setSearchTerm}
            selectedLabel={displayAddress ? formatAddress(displayAddress) : undefined}
            placeholder="Rechercher une adresse (code postal, ville, rue)..."
          >
                  <CommandEmpty>
                    {loading ? (
                      'Recherche en cours...'
                    ) : searchTerm.length < 2 ? (
                      'Tapez au moins 2 caractères pour rechercher'
                    ) : (
                      <div className="py-2">
                        <p className="text-sm text-muted-foreground mb-2">
                          Aucune adresse trouvée
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={handleNewAddress}
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Créer une nouvelle adresse
                        </Button>
                      </div>
                    )}
                  </CommandEmpty>
                  {addresses.length > 0 && (
                    <CommandGroup heading="Adresses existantes">
                      {addresses.map((address) => {
                        const addressStr = formatAddress({
                          street: address.street,
                          street2: address.street2 || undefined,
                          postalCode: address.postalCode,
                          city: address.city,
                          country: address.country,
                        })
                        const isSelected = isStoringId
                          ? currentAddressId === address.id
                          : currentAddress &&
                            currentAddress.street === address.street &&
                            currentAddress.postalCode === address.postalCode &&
                            currentAddress.city === address.city

                        return (
                          <AutocompleteItem
                            key={address.id}
                            value={addressStr}
                            onSelect={() => selectAddress(address)}
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                isSelected ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            <div className="flex-1">
                              <p className="text-sm font-medium">{address.street}</p>
                              {address.street2 && (
                                <p className="text-xs text-muted-foreground">{address.street2}</p>
                              )}
                              <p className="text-xs text-muted-foreground">
                                {address.postalCode} {address.city}
                              </p>
                            </div>
                          </AutocompleteItem>
                        )
                      })}
                    </CommandGroup>
                  )}
                  {addresses.length > 0 && (
                    <CommandGroup>
                      <AutocompleteItem onSelect={handleNewAddress}>
                        <Plus className="mr-2 h-4 w-4" />
                        Créer une nouvelle adresse
                      </AutocompleteItem>
                    </CommandGroup>
                  )}
                          </Autocomplete>
          {(displayAddress || currentAddressId) && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={() => {
                setValue(fieldPrefix, null, { shouldValidate: true })
                setSelectedAddressData(null)
              }}
              title="Effacer l'adresse"
            >
              ×
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4 border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Nouvelle adresse</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowNewForm(false)
                setSearchTerm('')
              }}
            >
              Annuler
            </Button>
          </div>
          <AddressForm
            fieldPrefix={addressFieldPrefix}
            required={required}
            showCountry={showCountry}
            defaultCountry={defaultCountry}
          />
          <Button
            type="button"
            onClick={handleSaveNewAddress}
            disabled={savingAddress}
            className="w-full"
          >
            {savingAddress ? 'Enregistrement...' : 'Enregistrer l\'adresse'}
          </Button>
        </div>
      )}
    </div>
  )
}
