/**
 * Address utilities and types
 * 
 * Note: Addresses are now stored as separate entities in the database (Address model)
 * for reusability. This file provides utilities for working with address data structures.
 */

import { z } from 'zod'

/**
 * Address structure
 * 
 * This interface represents the address data structure used throughout the application.
 * Addresses are stored in the database as separate Address entities for reusability.
 */
export interface Address {
  street: string // Rue et numéro
  street2?: string // Complément d'adresse (appartement, étage, etc.)
  postalCode: string // Code postal
  city: string // Ville
  country: string // Pays (code ISO, ex: "FR")
}

/**
 * Zod schema for Address validation
 */
export const addressSchema = z.object({
  street: z.string().min(1, 'La rue est requise'),
  street2: z.string().optional(),
  postalCode: z.string().min(1, 'Le code postal est requis'),
  city: z.string().min(1, 'La ville est requise'),
  country: z.string().length(2, 'Le code pays doit contenir 2 caractères (ISO 3166-1 alpha-2)'),
})

/**
 * Formats an address as a readable string
 * @param address - The address to format
 * @returns Formatted address string
 */
export function formatAddress(address: Address | null | undefined): string {
  if (!address) return ''
  
  const parts: string[] = []
  
  if (address.street) {
    parts.push(address.street)
  }
  
  if (address.street2) {
    parts.push(address.street2)
  }
  
  const cityLine = [address.postalCode, address.city].filter(Boolean).join(' ')
  if (cityLine) {
    parts.push(cityLine)
  }
  
  if (address.country && address.country !== 'FR') {
    // Only show country if it's not France (default)
    parts.push(address.country.toUpperCase())
  }
  
  return parts.join(', ')
}

/**
 * Creates an empty address structure with default values
 * 
 * Initializes all fields to empty strings except country which is set to the provided value.
 * Useful for form initialization.
 * 
 * @param country - Default country code (default: "FR")
 * @returns Empty address structure with country set
 */
export function createEmptyAddress(country: string = 'FR'): Address {
  return {
    street: '',
    postalCode: '',
    city: '',
    country,
  }
}
