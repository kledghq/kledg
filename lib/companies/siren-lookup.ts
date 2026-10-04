/**
 * SIREN lookup in the public company directory (API Recherche d'entreprises,
 * https://recherche-entreprises.api.gouv.fr, run by DINUM from the INSEE
 * Sirene and INPI RNE data; free, no key, at most 7 requests per second per
 * IP). Pure part: the shapes and the mapping of a search result to the
 * fields of the company wizard. The HTTP call is in lookup-siren.service.ts.
 *
 * The directory only answers for companies whose data is public
 * ("diffusible"): a missing company is not an error, the user types the
 * information instead.
 */

import { legalTypeFromNatureJuridique, type LegalType } from './legal-forms'

/** What the wizard prefills, every field editable. */
export interface SirenLookupResult {
  siren: string
  /** Legal name (dénomination). */
  name: string
  legalType: LegalType | null
  /** INSEE legal category code, e.g. "5710". */
  natureJuridique: string | null
  /** NAF (APE) code of the company, e.g. "62.01Z". */
  activityCode: string | null
  /** Registration date (yyyy-mm-dd). */
  creationDate: string | null
  /** False when the company is closed (état administratif "C"). */
  active: boolean
  /** Head office (siège). */
  headOffice: {
    siret: string | null
    street: string | null
    street2: string | null
    postalCode: string | null
    city: string | null
  } | null
}

/** The fields of a search result Kledg reads (the API returns many more). */
interface ApiSiege {
  siret?: string | null
  adresse?: string | null
  numero_voie?: string | null
  indice_repetition?: string | null
  type_voie?: string | null
  libelle_voie?: string | null
  complement_adresse?: string | null
  code_postal?: string | null
  libelle_commune?: string | null
  libelle_commune_etranger?: string | null
}

export interface ApiSearchResult {
  siren?: string
  nom_complet?: string | null
  nom_raison_sociale?: string | null
  nature_juridique?: string | null
  activite_principale?: string | null
  date_creation?: string | null
  etat_administratif?: string | null
  siege?: ApiSiege | null
}

export interface ApiSearchResponse {
  results?: ApiSearchResult[]
  total_results?: number
}

/** A SIREN is 9 digits (spaces allowed when typed). */
export function normalizeSiren(value: string): string | null {
  const digits = value.replace(/\s+/g, '')
  return /^\d{9}$/.test(digits) ? digits : null
}

/**
 * Whether the SIREN passes the Luhn check INSEE uses for SIREN numbers.
 * Used as a hint only: a few valid SIREN (La Poste) do not follow it.
 */
export function sirenChecksumValid(siren: string): boolean {
  if (!/^\d{9}$/.test(siren)) return false
  let sum = 0
  for (let i = 0; i < 9; i++) {
    let digit = Number(siren[8 - i])
    if (i % 2 === 1) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  return sum % 10 === 0
}

const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** Street line of the head office: "59 RUE LA FAYETTE", from the structured fields. */
function streetOf(siege: ApiSiege): string | null {
  const parts = [
    [text(siege.numero_voie), text(siege.indice_repetition)].filter(Boolean).join(' '),
    text(siege.type_voie),
    text(siege.libelle_voie),
  ].filter(Boolean)
  if (parts.length > 0) return parts.join(' ')
  // Without structured fields, the one-line address minus "75009 PARIS"
  const full = text(siege.adresse)
  if (!full) return null
  const tail = [text(siege.code_postal), text(siege.libelle_commune)].filter(Boolean).join(' ')
  return text(tail && full.endsWith(tail) ? full.slice(0, -tail.length) : full)
}

/**
 * The result for `siren` among the search results, mapped to the wizard
 * fields; null when the directory does not know this SIREN. A text search
 * may return other companies first: only an exact SIREN match counts.
 */
export function mapSearchResponse(siren: string, response: ApiSearchResponse): SirenLookupResult | null {
  const result = response.results?.find((r) => r.siren === siren)
  if (!result) return null
  const siege = result.siege ?? null
  const natureJuridique = text(result.nature_juridique)
  const creationDate = text(result.date_creation)
  return {
    siren,
    name: text(result.nom_raison_sociale) ?? text(result.nom_complet) ?? '',
    legalType: legalTypeFromNatureJuridique(natureJuridique),
    natureJuridique,
    activityCode: text(result.activite_principale),
    creationDate: creationDate && ISO_DAY.test(creationDate) ? creationDate : null,
    active: result.etat_administratif !== 'C',
    headOffice: siege
      ? {
          siret: text(siege.siret),
          street: streetOf(siege),
          street2: text(siege.complement_adresse),
          postalCode: text(siege.code_postal),
          city: text(siege.libelle_commune) ?? text(siege.libelle_commune_etranger),
        }
      : null,
  }
}
