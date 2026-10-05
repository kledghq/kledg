/**
 * Inputs of the "Rémunération et dividendes" simulator
 * (docs/remuneration-dividendes.md): one zod schema for the page, the
 * routes, the saved scenarios and the MCP tool. Amounts in cents, shares
 * and rates in basis points (10 000 = 100 %). Usable on both sides (zod
 * only).
 */

import { z } from 'zod'

const MAX_CENTS = 100_000_000_000_000
const cents = (message: string) => z.number({ error: message }).int(message).min(0, message).max(MAX_CENTS, 'Montant trop élevé')
const signedCents = (message: string) => z.number({ error: message }).int(message).min(-MAX_CENTS, 'Montant trop élevé').max(MAX_CENTS, 'Montant trop élevé')
const bp = (message: string) => z.number({ error: message }).int(message).min(0, message).max(10_000, message)

/** Social status of the director: assimilé salarié (président of SAS, minority gérant) or travailleur non salarié (majority gérant of SARL, EURL). */
export const DIRECTOR_STATUSES = ['assimile', 'tns'] as const
export type DirectorStatus = (typeof DIRECTOR_STATUSES)[number]

/** How the dividends are taxed at the income tax: the flat tax, the progressive scale, or the better of the two for each scenario. */
export const DIVIDEND_TAXATIONS = ['best', 'pfu', 'bareme'] as const
export type DividendTaxation = (typeof DIVIDEND_TAXATIONS)[number]

export const RemunerationInputsSchema = z.object({
  /** Result of the year before the director's pay and before the IS (the budget to share). */
  resultBeforePayCents: signedCents('Indiquez le résultat avant rémunération du dirigeant'),
  status: z.enum(DIRECTOR_STATUSES, { error: 'Statut du dirigeant inconnu : assimilé salarié ou non salarié' }),
  /** The 15 % rate of CGI art. 219, I, b applies. */
  reducedRate: z.boolean(),
  /** Profit taxed at 15 %, prorated for a fiscal year that is not of twelve months. */
  reducedRateCeilingCents: cents('Plafond du taux réduit invalide'),
  /** Whether the legal reserve applies (C. com. L232-10: SARL and sociétés par actions). */
  legalReserveRequired: z.boolean(),
  capitalCents: cents('Capital invalide'),
  legalReserveCents: cents('Réserve légale invalide'),
  priorLossesCents: cents('Report à nouveau débiteur invalide'),
  /** Share of the capital held by the director (and, for a TNS, the household), in basis points. */
  shareBp: bp('Part du capital invalide : entre 0 et 100 %'),
  /** Share premiums held by the director (TNS threshold of CSS L131-6). */
  premiumsCents: cents('Primes d’émission invalides'),
  /** Average balance of the director's current account over the year (TNS threshold of CSS L131-6). */
  currentAccountCents: cents('Compte courant invalide'),
  /** Parts of quotient familial of the household, by quarters (1, 1,5, 2, 2,5...). */
  householdParts: z
    .number({ error: 'Nombre de parts invalide' })
    .min(1, 'Au moins une part')
    .max(20, 'Nombre de parts trop élevé')
    .refine((v) => Number.isInteger(v * 4), 'Les parts vont par quarts (1 ; 1,25 ; 1,5...)'),
  /** Other net taxable income of the household (salaries after the 10 % deduction, pensions...), before this pay and these dividends. */
  otherIncomeCents: cents('Autres revenus invalides'),
  dividendTaxation: z.enum(DIVIDEND_TAXATIONS, { error: 'Imposition des dividendes inconnue' }),
  /** Share of the year's distributable profit paid as dividends. */
  distributionBp: bp('Part distribuée invalide : entre 0 et 100 %'),
  /** Share of the budget spent on the director's pay in the "mix" scenario (slider). */
  mixBp: bp('Part de la rémunération invalide : entre 0 et 100 %'),
})
export type RemunerationInputs = z.infer<typeof RemunerationInputsSchema>

/** Inputs changed by the user, over the defaults read from the books. */
export const RemunerationOverridesSchema = RemunerationInputsSchema.partial()
export type RemunerationOverrides = z.infer<typeof RemunerationOverridesSchema>

export const ScenarioNameSchema = z.string({ error: 'Nom du scénario requis' }).trim().min(1, 'Nom du scénario requis').max(80, 'Nom du scénario trop long (80 caractères au plus)')
