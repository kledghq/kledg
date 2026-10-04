/**
 * Legal forms (formes juridiques) of the companies Kledg keeps the books of,
 * as stored in the CompanyLegalType enum: the short tag shown next to a
 * company name, the full name, and the mapping from the INSEE legal
 * category (catégorie juridique) returned by the SIREN directory.
 *
 * Pure module (no imports): used by the API, the company wizard, the company
 * switcher and lists.
 */

export const LEGAL_TYPES = [
  'SASU',
  'SAS',
  'SARL',
  'EURL',
  'SCI',
  'SA',
  'SNC',
  'SELARL',
  'SELAS',
  'SCS',
  'SCA',
  'EI',
] as const

export type LegalType = (typeof LEGAL_TYPES)[number]

export interface LegalForm {
  value: LegalType
  /** Short tag shown next to the company name ("SASU"). */
  tag: string
  /** Full name, sentence case ("Société par actions simplifiée unipersonnelle"). */
  name: string
}

/** In the order a small company is most likely to need them. */
export const LEGAL_FORMS: readonly LegalForm[] = [
  { value: 'SASU', tag: 'SASU', name: 'Société par actions simplifiée unipersonnelle' },
  { value: 'SAS', tag: 'SAS', name: 'Société par actions simplifiée' },
  { value: 'SARL', tag: 'SARL', name: 'Société à responsabilité limitée' },
  { value: 'EURL', tag: 'EURL', name: 'Entreprise unipersonnelle à responsabilité limitée' },
  { value: 'SCI', tag: 'SCI', name: 'Société civile immobilière' },
  { value: 'SA', tag: 'SA', name: 'Société anonyme' },
  { value: 'SNC', tag: 'SNC', name: 'Société en nom collectif' },
  { value: 'SELARL', tag: 'SELARL', name: "Société d'exercice libéral à responsabilité limitée" },
  { value: 'SELAS', tag: 'SELAS', name: "Société d'exercice libéral par actions simplifiée" },
  { value: 'SCS', tag: 'SCS', name: 'Société en commandite simple' },
  { value: 'SCA', tag: 'SCA', name: 'Société en commandite par actions' },
  { value: 'EI', tag: 'EI', name: 'Entrepreneur individuel' },
]

const BY_VALUE = new Map<string, LegalForm>(LEGAL_FORMS.map((form) => [form.value, form]))

export function isLegalType(value: unknown): value is LegalType {
  return typeof value === 'string' && BY_VALUE.has(value)
}

/** "SASU", or null when the legal form is unknown. */
export function legalFormTag(legalType: string | null | undefined): string | null {
  return (legalType && BY_VALUE.get(legalType)?.tag) || null
}

/** "Société par actions simplifiée unipersonnelle", or null. */
export function legalFormName(legalType: string | null | undefined): string | null {
  return (legalType && BY_VALUE.get(legalType)?.name) || null
}

/** Tags a company name may carry for each form (an SASU is often named "... SAS"). */
const NAME_TOKENS: Record<LegalType, string[]> = {
  SASU: ['SASU', 'SAS'],
  SAS: ['SAS'],
  SARL: ['SARL'],
  EURL: ['EURL', 'SARL'],
  SCI: ['SCI'],
  SA: ['SA'],
  SNC: ['SNC'],
  SELARL: ['SELARL'],
  SELAS: ['SELAS'],
  SCS: ['SCS'],
  SCA: ['SCA'],
  EI: ['EI'],
}

/**
 * The name to display next to the legal form tag: "SCI Les Tilleuls" with
 * the SCI form reads "Les Tilleuls" + tag SCI, "S.A.S. Martin" reads "Martin". Only the company's own form
 * is removed, at the start or the end of the name (optionally in
 * parentheses), so a name that merely contains the letters is untouched. The
 * stored legal name never changes.
 */
export function displayCompanyName(name: string, legalType: string | null | undefined): string {
  if (!isLegalType(legalType)) return name
  let display = name.trim()
  for (const token of NAME_TOKENS[legalType]) {
    // "SAS", "S.A.S" or "S.A.S.", upper case only ("Sa Maison" keeps its name).
    const pattern = `${token.split('').join('\\.?')}\\.?`
    const leading = new RegExp(`^\\(?${pattern}\\)?[\\s,-]+`)
    const trailing = new RegExp(`[\\s,-]+\\(?${pattern}\\)?$`)
    const stripped = display.replace(leading, '').replace(trailing, '').trim()
    if (stripped && stripped !== display) {
      display = stripped
      break
    }
  }
  return display || name
}

/**
 * CompanyLegalType of an INSEE legal category (niveau III of the
 * "Catégories juridiques" nomenclature, https://www.insee.fr/fr/information/2028129,
 * version of September 2022), or null when Kledg has no matching form.
 *
 * INSEE does not tell an SAS from an SASU (both 5710) nor, since 2020, an
 * SARL from an EURL (5499; 5498 "SARL unipersonnelle" was retired on
 * 1 July 2020 and is kept for older records): the wizard asks the user to
 * choose the unipersonal form when there is a single shareholder.
 */
export function legalTypeFromNatureJuridique(code: string | null | undefined): LegalType | null {
  if (!code || !/^\d{4}$/.test(code)) return null
  switch (code) {
    case '1000':
      return 'EI'
    case '5202':
    case '5203':
      return 'SNC'
    case '5306':
    case '5307':
      return 'SCS'
    case '5308':
    case '5309':
    case '5370':
    case '5385':
      return 'SCA'
    case '5485':
      return 'SELARL'
    case '5498':
      return 'EURL'
    case '5710':
    case '5770':
      return 'SAS'
    case '5785':
      return 'SELAS'
    case '6540':
    case '6541':
    case '6544':
      return 'SCI'
  }
  if (code.startsWith('54')) return 'SARL'
  if (code.startsWith('55') || code.startsWith('56')) return 'SA'
  return null
}

/** Initials of the displayed name: "SCI Les Tilleuls" (SCI) -> "LT". */
export function companyInitials(name: string | null | undefined, legalType?: string | null): string {
  if (!name) return ''
  return displayCompanyName(name, legalType)
    .split(/\s+/)
    .filter((word) => /[\p{L}\d]/u.test(word))
    .slice(0, 2)
    .map((word) => (word.match(/[\p{L}\d]/u)?.[0] ?? '').toUpperCase())
    .join('')
}
