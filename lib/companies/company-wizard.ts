/**
 * Company creation (wizard and POST /api/companies): one zod schema shared by
 * the client form and the API, and the rules of the first fiscal year.
 *
 * Pure module (zod and pure helpers only), so the wizard validates exactly
 * like the server.
 *
 * Fiscal year rules (cited in the wizard):
 * - an exercice normally lasts twelve months: the accounts are closed and an
 *   inventory is taken "au moins une fois tous les douze mois" (Code de
 *   commerce, art. L123-12);
 * - the first exercice may be shorter or longer. No text sets a maximum for
 *   a company's first exercice; common practice (greffes, statuts types,
 *   CCI Paris Ile-de-France) caps it at 24 months;
 * - for a company subject to corporate tax, when no exercice closes in the
 *   year of creation, the first tax period runs from the start of activity
 *   to the closing of the first exercice and at the latest to 31 December of
 *   the following year (CGI art. 209, I): a first exercice closing later is
 *   taxed in two periods.
 */

import { z } from 'zod'
import { LEGAL_TYPES } from './legal-forms'
import { addIsoDays, formatIsoDateFr, lastDayOfMonth } from '@/lib/utils/date'

/** VAT regimes offered at creation (Company.vatRegime). */
export const VAT_REGIMES = ['normal', 'simplified', 'franchise'] as const
export type VatRegime = (typeof VAT_REGIMES)[number]

/** Corporate tax regimes offered at creation (Company.corporateTaxRegime); null: not subject to IS. */
export const CORPORATE_TAX_REGIMES = ['simplified', 'normal'] as const
export type CorporateTaxRegime = (typeof CORPORATE_TAX_REGIMES)[number]

const FIRST_FISCAL_YEAR_MAX_MONTHS = 24
export const MAX_SHAREHOLDERS = 20

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function isRealIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

const isoDate = (message: string) => z.string().refine(isRealIsoDate, message)
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined))

/**
 * End of a period of `months` months starting on `iso`: the day before the
 * same day `months` months later. When that month has no such day (a year
 * starting on 29/02, or on the 31st), the anniversary is the first day of
 * the next month, so the period ends on the last day of that month:
 * 29/02/2024 + 12 months ends on 28/02/2025, 31/01/2024 + 1 month on
 * 29/02/2024.
 */
export function periodEnd(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const index = y * 12 + (m - 1) + months
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  const last = lastDayOfMonth(year, month)
  const pad = (n: number) => String(n).padStart(2, '0')
  if (d > last) return `${year}-${pad(month)}-${pad(last)}`
  return addIsoDays(`${year}-${pad(month)}-${pad(d)}`, -1)
}

/** Whole months covered by a period (13 for 01/01/2026 to 31/01/2027), rounding a started month up. */
export function periodMonths(startIso: string, endIso: string): number {
  let months = 1
  while (periodEnd(startIso, months) < endIso) months++
  return months
}

export interface FiscalYearCheck {
  /** Blocking problems (the server refuses them too). */
  errors: string[]
  /** Points to read before going on (not blocking). */
  warnings: string[]
  months: number
}

/**
 * Checks the first fiscal year Kledg opens for the company.
 * `isFirst`: it is the company's very first exercice (new company), so it
 * may run from 1 to 24 months; otherwise it is a normal 12 month exercice.
 */
export function checkFirstFiscalYear(input: {
  startDate: string
  endDate: string
  isFirst: boolean
  subjectToCorporateTax: boolean
  foundationDate?: string | null
}): FiscalYearCheck {
  const errors: string[] = []
  const warnings: string[] = []
  const { startDate, endDate } = input
  if (!isRealIsoDate(startDate) || !isRealIsoDate(endDate)) {
    return { errors: ["Indiquez les dates de début et de fin de l'exercice."], warnings, months: 0 }
  }
  if (endDate <= startDate) {
    return { errors: ["La date de fin de l'exercice doit être après sa date de début."], warnings, months: 0 }
  }
  const months = periodMonths(startDate, endDate)
  if (input.isFirst) {
    if (endDate > periodEnd(startDate, FIRST_FISCAL_YEAR_MAX_MONTHS)) {
      errors.push(
        `Le premier exercice ne peut pas dépasser ${FIRST_FISCAL_YEAR_MAX_MONTHS} mois (usage admis par les greffes) : choisissez une clôture au plus tard le ${formatIsoDateFr(periodEnd(startDate, FIRST_FISCAL_YEAR_MAX_MONTHS))}.`,
      )
    } else if (input.subjectToCorporateTax && endDate > `${Number(startDate.slice(0, 4)) + 1}-12-31`) {
      warnings.push(
        `Pour une société à l'IS, un premier exercice clos après le 31/12/${Number(startDate.slice(0, 4)) + 1} est imposé en deux périodes (CGI art. 209, I). Une clôture au plus tard à cette date simplifie la première déclaration.`,
      )
    }
    if (months < 12 && errors.length === 0) {
      warnings.push(
        `Premier exercice court (${months} mois) : c'est possible, il n'existe pas de durée minimale. La société établira ses premiers comptes annuels plus tôt.`,
      )
    }
    if (input.foundationDate && isRealIsoDate(input.foundationDate) && startDate < input.foundationDate) {
      errors.push("Le premier exercice ne peut pas commencer avant la date de création de la société.")
    }
  } else if (endDate !== periodEnd(startDate, 12)) {
    warnings.push(
      "Un exercice dure normalement 12 mois (Code de commerce, art. L123-12). Une autre durée n'est possible que pour le premier exercice ou après un changement de date de clôture.",
    )
  }
  return { errors, warnings, months }
}

const ShareholderInputSchema = z
  .object({
    type: z.enum(['PHYSICAL', 'LEGAL']),
    /** Physical person only. */
    firstName: optionalText(100),
    /** Last name of a person, or name of a legal entity. */
    name: z.string().trim().min(1, "Indiquez le nom de l'associé.").max(200),
    numberOfShares: z.number().int().positive('Le nombre de parts doit être positif.').max(1_000_000_000),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'PHYSICAL' && !value.firstName) {
      ctx.addIssue({ code: 'custom', path: ['firstName'], message: "Indiquez le prénom de l'associé." })
    }
  })

export type ShareholderInput = z.infer<typeof ShareholderInputSchema>

export const CreateCompanySchema = z
  .object({
    // Step 1: identity
    name: z.string().trim().min(1, 'Indiquez le nom de la société.').max(200),
    siren: z
      .string()
      .transform((v) => v.replace(/\s+/g, ''))
      .pipe(z.string().regex(/^\d{9}$/, 'Le SIREN compte exactement 9 chiffres.')),
    legalType: z.enum(LEGAL_TYPES).optional().nullable(),
    activityCode: optionalText(10),
    foundationDate: isoDate('Date de création invalide.').optional().nullable(),
    email: z.union([z.literal(''), z.email('Email invalide.')]).optional(),
    phone: optionalText(30),
    headOffice: z
      .object({
        siret: z
          .string()
          .transform((v) => v.replace(/\s+/g, ''))
          .pipe(z.string().regex(/^(\d{14})?$/, 'Le SIRET compte exactement 14 chiffres.'))
          .optional(),
        street: optionalText(200),
        street2: optionalText(200),
        postalCode: optionalText(10),
        city: optionalText(100),
      })
      .optional()
      .nullable(),
    // Step 2: fiscal year and tax regimes
    firstFiscalYear: z.object({
      startDate: isoDate("Date de début de l'exercice invalide."),
      endDate: isoDate("Date de fin de l'exercice invalide."),
      /** The company's very first exercice (new company), 1 to 24 months. */
      isFirst: z.boolean(),
    }),
    vatRegime: z.enum(VAT_REGIMES, { error: 'Choisissez le régime de TVA.' }),
    corporateTaxRegime: z.enum(CORPORATE_TAX_REGIMES, { error: "Choisissez le régime d'impôt sur les sociétés." }).nullable(),
    includeOptionalAccounts: z.boolean().default(false),
    // Step 3: capital and shareholders
    totalShares: z.number().int().positive('Le nombre de parts doit être positif.').max(1_000_000_000).optional().nullable(),
    /** Nominal value of one share, in cents. */
    shareNominalValueCents: z.number().int().positive('La valeur nominale doit être positive.').max(1_000_000_000_00).optional().nullable(),
    shareholders: z.array(ShareholderInputSchema).max(MAX_SHAREHOLDERS).default([]),
  })
  .superRefine((value, ctx) => {
    const check = checkFirstFiscalYear({
      startDate: value.firstFiscalYear.startDate,
      endDate: value.firstFiscalYear.endDate,
      isFirst: value.firstFiscalYear.isFirst,
      subjectToCorporateTax: value.corporateTaxRegime !== null,
      foundationDate: value.foundationDate,
    })
    for (const message of check.errors) ctx.addIssue({ code: 'custom', path: ['firstFiscalYear', 'endDate'], message })
    if (value.shareholders.length > 0) {
      if (!value.totalShares) {
        ctx.addIssue({ code: 'custom', path: ['totalShares'], message: 'Indiquez le nombre total de parts pour répartir le capital.' })
      } else {
        const held = value.shareholders.reduce((sum, s) => sum + s.numberOfShares, 0)
        if (held > value.totalShares) {
          ctx.addIssue({
            code: 'custom',
            path: ['shareholders'],
            message: `Les associés détiennent ${held} parts, plus que les ${value.totalShares} parts du capital.`,
          })
        }
      }
    }
  })

export type CreateCompanyInput = z.input<typeof CreateCompanySchema>
export type CreateCompanyData = z.output<typeof CreateCompanySchema>

/** Share capital in cents (number of shares times nominal value), or null when either is missing. */
export function shareCapitalCents(totalShares: number | null | undefined, nominalCents: number | null | undefined): number | null {
  return totalShares && nominalCents ? totalShares * nominalCents : null
}

/** Percentage held, two decimals (Shareholder.sharePercentage is Decimal(5, 2)). */
export function sharePercentage(shares: number, totalShares: number): number {
  return Math.round((shares * 10_000) / totalShares) / 100
}

/**
 * A suggested first fiscal year: a new company closes on the 31 December
 * of the year of creation, or of the next year when it was created in the
 * last quarter (a first exercice of less than three months is rarely worth
 * a closing); an existing company starts the 12 month exercice in progress.
 */
export function suggestFirstFiscalYear(input: {
  today: string
  foundationDate?: string | null
  closingMonth?: number
  closingDay?: number
}): { startDate: string; endDate: string; isFirst: boolean } {
  const closingMonth = input.closingMonth ?? 12
  const closingDay = input.closingDay ?? 31
  const closingIn = (year: number) => {
    const last = new Date(Date.UTC(year, closingMonth, 0)).getUTCDate()
    return `${year}-${String(closingMonth).padStart(2, '0')}-${String(Math.min(closingDay, last)).padStart(2, '0')}`
  }
  const foundation = input.foundationDate && isRealIsoDate(input.foundationDate) ? input.foundationDate : null
  // A company created less than a year ago is in its first exercice.
  const isFirst = foundation !== null && foundation > periodEnd(input.today, -12)
  if (isFirst && foundation) {
    const year = Number(foundation.slice(0, 4))
    let endDate = closingIn(year)
    if (endDate < foundation || periodMonths(foundation, endDate) < 3) endDate = closingIn(year + 1)
    return { startDate: foundation, endDate, isFirst: true }
  }
  const year = Number(input.today.slice(0, 4))
  const endYear = input.today <= closingIn(year) ? year : year + 1
  // Starts the day after the previous closing.
  return { startDate: addIsoDays(closingIn(endYear - 1), 1), endDate: closingIn(endYear), isFirst: false }
}
