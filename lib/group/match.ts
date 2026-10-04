/**
 * Who a line of the books is about, inside a group: the company of the group
 * named by a tiers SIREN, an account label ("455100 Compte courant Filiale
 * Nord") or the description of an entry ("Dividendes Filiale Nord 2025").
 * Pure, usable on both sides.
 *
 * The SIREN of a tiers is the reliable link (it is checked when the tiers is
 * created). Labels are a fallback for the accounts that carry no tiers
 * (451, 455, 261, 761 are rarely auxiliary accounts): the label must contain
 * the company's name, legal form and accents aside, or its SIREN. A label
 * that names two companies of the group goes to the longest name ("Nord
 * Services" before "Nord"). A name shorter than three characters once
 * normalised never matches a label: too many false positives.
 */

export interface GroupCompanyRef {
  id: string
  name: string
  siren: string | null
}

const LEGAL_FORMS = new Set(['sa', 'sas', 'sasu', 'sarl', 'eurl', 'sci', 'snc', 'scop', 'selarl', 'selas', 'sca', 'scs', 'gie', 'societe', 'ste', 'holding'])

/** Lower case, no accents, no punctuation, legal forms removed (SAS, S.A.S.), single spaces. */
export function normalizeName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    // Dotted acronyms (S.A.S.) read as words.
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word && !LEGAL_FORMS.has(word))
    .join(' ')
}

const MIN_NAME_LENGTH = 3

/** The company whose SIREN is `siren` (spaces ignored), or null. */
export function companyBySiren<T extends GroupCompanyRef>(companies: readonly T[], siren: string | null | undefined): T | null {
  const digits = siren?.replace(/\s/g, '')
  if (!digits) return null
  return companies.find((c) => c.siren === digits) ?? null
}

/**
 * The company of the group a free text names, or null. Whole words only:
 * "Nord" matches "compte courant nord" but not "nordic".
 */
export function companyNamedIn<T extends GroupCompanyRef>(companies: readonly T[], ...texts: Array<string | null | undefined>): T | null {
  let best: { company: T; length: number } | null = null
  for (const text of texts) {
    if (!text) continue
    const haystack = ` ${normalizeName(text)} `
    const digits = text.replace(/\D/g, '')
    for (const company of companies) {
      if (company.siren && digits.includes(company.siren)) return company
      const name = normalizeName(company.name)
      if (name.length < MIN_NAME_LENGTH) continue
      if (haystack.includes(` ${name} `) && (!best || name.length > best.length)) best = { company, length: name.length }
    }
  }
  return best?.company ?? null
}
