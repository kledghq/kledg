/**
 * French company identifiers on plain values. Pure module without imports:
 * the tiers form and the server share it (docs/conventions.md, client and
 * server boundary).
 *
 * - SIREN: 9 digits, SIRET: SIREN + 5 digits of the establishment (NIC).
 *   INSEE gives both a Luhn check digit; La Poste (SIREN 356 000 000) is the
 *   documented exception, whose establishments have SIRET numbers whose
 *   digits sum to a multiple of 5 instead.
 * - French VAT number (numéro de TVA intracommunautaire): "FR" + a key of two
 *   characters + the SIREN; the numeric key is (12 + 3 x (SIREN mod 97))
 *   mod 97, the key the DGFiP gives the numbers it assigns. Other member states' numbers are only checked for
 *   their shape (two letters, 2 to 12 characters).
 */

const LA_POSTE_SIREN = '356000000'

/** Digits of a typed identifier (spaces and dots removed), or null when other characters remain. */
export function normalizeIdentifier(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const compact = value.replace(/[\s. ]/g, '')
  return compact === '' ? null : compact
}

function luhnValid(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  return sum % 10 === 0
}

/** Whether a SIREN is 9 digits with a valid Luhn key (La Poste accepted). */
export function isValidSiren(value: string): boolean {
  if (!/^\d{9}$/.test(value)) return false
  return value === LA_POSTE_SIREN || luhnValid(value)
}

/** Whether a SIRET is 14 digits with a valid key (Luhn, or the La Poste rule). */
export function isValidSiret(value: string): boolean {
  if (!/^\d{14}$/.test(value)) return false
  if (value.startsWith(LA_POSTE_SIREN)) {
    const sum = value.split('').reduce((total, digit) => total + Number(digit), 0)
    return sum % 5 === 0
  }
  return luhnValid(value)
}

/** The French VAT number of a SIREN (FR + numeric key + SIREN). */
export function frenchVatNumberOf(siren: string): string {
  const key = (12 + 3 * (Number(siren) % 97)) % 97
  return `FR${String(key).padStart(2, '0')}${siren}`
}

/** A VAT number in its canonical form: uppercase, without spaces or dots. */
export function normalizeVatNumber(value: string | null | undefined): string | null {
  const compact = normalizeIdentifier(value)
  return compact ? compact.toUpperCase() : null
}

/**
 * Whether a VAT number is well formed. A French number must end with a
 * valid SIREN and, when its key is numeric, carry the key of that SIREN.
 */
export function isValidVatNumber(value: string): boolean {
  if (value.startsWith('FR')) {
    const match = /^FR([0-9A-Z]{2})(\d{9})$/.exec(value)
    if (!match) return false
    const [, key, siren] = match
    if (!isValidSiren(siren)) return false
    return /^\d{2}$/.test(key) ? frenchVatNumberOf(siren) === value : true
  }
  return /^[A-Z]{2}[0-9A-Z+*.]{2,12}$/.test(value)
}

export interface IdentifierInput {
  siren?: string | null
  siret?: string | null
  vatNumber?: string | null
}

export interface NormalizedIdentifiers {
  siren: string | null
  siret: string | null
  vatNumber: string | null
}

/**
 * Normalizes and checks the identifiers of a tiers. Returns the French
 * reasons they are refused (empty when they are accepted); the SIREN is
 * derived from the SIRET when only the SIRET is given.
 */
export function checkIdentifiers(input: IdentifierInput): { values: NormalizedIdentifiers; errors: string[] } {
  const errors: string[] = []
  const siret = normalizeIdentifier(input.siret)
  let siren = normalizeIdentifier(input.siren)
  const vatNumber = normalizeVatNumber(input.vatNumber)
  if (siren !== null && !isValidSiren(siren)) {
    errors.push('Le SIREN doit compter 9 chiffres et sa clé de contrôle doit être exacte\u00a0: vérifiez-le sur l’avis de situation Sirene.')
  }
  if (siret !== null && !isValidSiret(siret)) {
    errors.push('Le SIRET doit compter 14 chiffres et sa clé de contrôle doit être exacte.')
  }
  if (siret !== null && siren !== null && isValidSiret(siret) && !siret.startsWith(siren)) {
    errors.push('Le SIRET doit commencer par le SIREN du tiers.')
  }
  if (siren === null && siret !== null && isValidSiret(siret)) siren = siret.slice(0, 9)
  if (vatNumber !== null && !isValidVatNumber(vatNumber)) {
    errors.push('Le numéro de TVA intracommunautaire est mal formé (ex. FR40303265045).')
  }
  if (vatNumber !== null && siren !== null && vatNumber.startsWith('FR') && isValidVatNumber(vatNumber) && !vatNumber.endsWith(siren)) {
    errors.push('Le numéro de TVA français doit se terminer par le SIREN du tiers.')
  }
  return { values: { siren, siret, vatNumber }, errors }
}
