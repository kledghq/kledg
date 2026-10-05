/**
 * Capital composition (répartition du capital) on plain values: who holds
 * the shares, how many, which part of the capital and for which nominal
 * amount, with the checks a closing, the annexe or a general meeting needs.
 * Pure module: the service loads the company and its shareholders.
 *
 * Integers only: shares are counts, percentages are hundredths of a percent
 * (lib/companies/shareholder-values.ts), amounts are cents.
 *
 * Sources:
 * - Notices of forms 2033-F-SD and 2059-F-SD (composition du capital
 *   social): the shareholders, legal persons and natural persons, holding
 *   directly at least 10 % of the capital are listed, with their number of
 *   shares and their percentage.
 * - Code de commerce art. L223-2 (SARL: the capital is divided into equal
 *   parts sociales) and art. L228-1 (sociétés par actions issue actions):
 *   share capital = number of shares x nominal value.
 * - 2033-F lists only the shareholders above the 10 % threshold and needs
 *   no birth data or addresses; this report keeps the
 *   threshold and leaves personal data out (they stay on the shareholder's
 *   record).
 */

import { centsToDecimal, formatCentsFr } from '@/lib/utils/money'

/** Share threshold of forms 2033-F and 2059-F, in hundredths of a percent. */
export const DECLARATION_THRESHOLD = 1_000

const SHARE_WORDS: Record<string, { singular: string; plural: string }> = {
  parts: { singular: 'part sociale', plural: 'parts sociales' },
  actions: { singular: 'action', plural: 'actions' },
}

/** Sociétés par actions issue actions; the other forms parts sociales (SARL, EURL, SNC, SCS, SCI, SELARL). */
export function shareKind(legalType: string | null): 'parts' | 'actions' {
  return legalType && ['SA', 'SAS', 'SASU', 'SCA', 'SELAS'].includes(legalType) ? 'actions' : 'parts'
}

export function shareWord(legalType: string | null, count = 2): string {
  const words = SHARE_WORDS[shareKind(legalType)]
  return Math.abs(count) >= 2 ? words.plural : words.singular
}

export interface CapitalCompanyInput {
  legalType: string | null
  shareCapitalCents: number | null
  totalShares: number | null
  nominalCents: number | null
}

export interface ShareholderInput {
  id: string
  kind: 'PHYSICAL' | 'LEGAL'
  name: string
  /** Photo of a natural person (Person.photo, an image data URL), shown next to the name. */
  photo?: string | null
  /** SIREN of a legal person (company of the instance or SIRET entered). */
  siren: string | null
  shares: number | null
  /** Stored percentage, hundredths of a percent. */
  percentHundredths: number
  /** Stored capital held, cents. */
  capitalCents: number | null
}

export interface CapitalRow extends ShareholderInput {
  /** Percentage from the number of shares, when both counts are known. */
  sharesPercentHundredths: number | null
  /** Shares x nominal value, when both are known. */
  nominalAmountCents: number | null
  /** At least 10 % of the capital: listed on forms 2033-F and 2059-F. */
  declared: boolean
  /** More than half of the capital. */
  majority: boolean
}

export interface CapitalComposition {
  shareKind: 'parts' | 'actions'
  rows: CapitalRow[]
  totals: {
    holders: number
    physical: { holders: number; shares: number }
    legal: { holders: number; shares: number }
    shares: number
    percentHundredths: number
    nominalAmountCents: number | null
  }
  capital: CapitalCompanyInput & { sharesTimesNominalCents: number | null }
  /** Inconsistencies to fix, in French. */
  checks: string[]
}

const euros = formatCentsFr
/** A count with French thousands separators (non-breaking spaces). */
const int = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')
/** Hundredths of a percent as "33,33 %" (two decimals at most, exact). */
const percent = (hundredths: number) => `${centsToDecimal(hundredths).replace(/\.?0+$/, '').replace('.', ',')}\u00a0%`

/** Percentage of `shares` among `total`, in hundredths, rounded half up. */
export function sharePercentHundredths(shares: number, total: number): number {
  return total > 0 ? Math.round((shares * 10_000) / total) : 0
}

export function buildCapitalComposition(company: CapitalCompanyInput, holders: ShareholderInput[]): CapitalComposition {
  const total = company.totalShares && company.totalShares > 0 ? company.totalShares : null
  const nominal = company.nominalCents && company.nominalCents > 0 ? company.nominalCents : null
  const rows: CapitalRow[] = holders
    .map((h) => {
      const sharesPercentHundredths = total !== null && h.shares !== null ? sharePercentHundredths(h.shares, total) : null
      const reference = sharesPercentHundredths ?? h.percentHundredths
      return {
        ...h,
        sharesPercentHundredths,
        nominalAmountCents: nominal !== null && h.shares !== null ? h.shares * nominal : null,
        declared: reference >= DECLARATION_THRESHOLD,
        majority: reference > 5_000,
      }
    })
    .sort((a, b) => (b.sharesPercentHundredths ?? b.percentHundredths) - (a.sharesPercentHundredths ?? a.percentHundredths) || a.name.localeCompare(b.name, 'fr'))

  const sumShares = (list: CapitalRow[]) => list.reduce((s, r) => s + (r.shares ?? 0), 0)
  const physical = rows.filter((r) => r.kind === 'PHYSICAL')
  const legal = rows.filter((r) => r.kind === 'LEGAL')
  const shares = sumShares(rows)
  const percentHundredths = rows.reduce((s, r) => s + r.percentHundredths, 0)
  const nominalAmountCents = rows.every((r) => r.nominalAmountCents !== null) && rows.length > 0 ? rows.reduce((s, r) => s + (r.nominalAmountCents ?? 0), 0) : null
  const sharesTimesNominalCents = total !== null && nominal !== null ? total * nominal : null
  const word = (count: number) => shareWord(company.legalType, count)
  const numberOf = shareKind(company.legalType) === 'actions' ? "nombre d'actions" : 'nombre de parts sociales'

  const checks: string[] = []
  if (rows.length === 0) checks.push("Aucun actionnaire n'est enregistré\u00a0: ajoutez-les dans Société, Informations.")
  if (company.shareCapitalCents === null) checks.push('Le capital social n\'est pas renseigné dans les informations de la société.')
  if (sharesTimesNominalCents !== null && company.shareCapitalCents !== null && sharesTimesNominalCents !== company.shareCapitalCents) {
    checks.push(
      `Le capital social (${euros(company.shareCapitalCents)}) ne correspond pas au ${numberOf} multiplié par la valeur nominale (${int(total as number)} x ${euros(nominal as number)} = ${euros(sharesTimesNominalCents)}).`,
    )
  }
  if (total !== null && rows.length > 0 && rows.every((r) => r.shares !== null) && shares !== total) {
    checks.push(`Les actionnaires détiennent ${int(shares)} ${word(shares)} sur ${int(total)}\u00a0: complétez la répartition.`)
  }
  if (rows.some((r) => r.shares === null)) checks.push(`Le ${numberOf} manque pour certains actionnaires.`)
  if (rows.length > 0 && percentHundredths !== 10_000) checks.push(`Le total des pourcentages est de ${percent(percentHundredths)} au lieu de 100 %.`)
  for (const r of rows) {
    if (r.sharesPercentHundredths !== null && Math.abs(r.sharesPercentHundredths - r.percentHundredths) > 1) {
      checks.push(`${r.name}\u00a0: ${percent(r.percentHundredths)} enregistrés, mais ${int(r.shares ?? 0)} ${word(r.shares ?? 0)} sur ${int(total as number)} font ${percent(r.sharesPercentHundredths)}.`)
    }
  }
  return {
    shareKind: shareKind(company.legalType),
    rows,
    totals: {
      holders: rows.length,
      physical: { holders: physical.length, shares: sumShares(physical) },
      legal: { holders: legal.length, shares: sumShares(legal) },
      shares,
      percentHundredths,
      nominalAmountCents,
    },
    capital: { ...company, sharesTimesNominalCents },
    checks,
  }
}
