/**
 * Official sources cited by the templates, each read on its official page
 * (BOFiP, Légifrance) when the template was written. One constant per
 * source, so a moved page is fixed once.
 */

import type { RuleTemplate } from '../template'

type Source = RuleTemplate['sources'][number]

const bofip = (label: string, id: number): Source => ({ label, url: `https://bofip.impots.gouv.fr/bofip/${id}-PGP.html` })

export const SOURCES = {
  /** CGI ann. II art. 206: exclusions from the right to deduct (IV, 2°: 2° free lodging of staff, 3° gifts, 5° passenger transport, 6° and 7° passenger cars). */
  cgiAnnex2Art206: { label: 'CGI, annexe II, art. 206 (exclusions du droit à déduction)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000036174761/' },
  /** Reverse charge for services of a supplier not established in France, EU and third countries (CGI art. 283, 2, §130). */
  reverseCharge: bofip('BOI-TVA-DECLA-10-10-20 (autoliquidation, CGI art. 283, 2)', 3218),
  /** Passenger transport at 10 % (CGI art. 279, b quater): trains, taxis, chauffeur-driven hire, domestic flights. */
  passengerTransportRate: bofip('BOI-TVA-LIQ-30-20-60 (transport de voyageurs à 10 %, CGI art. 279, b quater)', 477),
  /** VAT on passenger transport is not deductible whatever the means (CGI ann. II art. 206, IV, 2°, 5°). */
  passengerTransportExclusion: bofip('BOI-TVA-DED-30-30-30 (transport de personnes exclu de la déduction)', 1193),
  /** International air transport of passengers exempt (CGI art. 262, II, 8°). */
  internationalFlights: bofip('BOI-TVA-CHAMP-20-60-10 (transports internationaux exonérés, CGI art. 262, II, 8°)', 2270),
  /** Tolls (§330) and parking (§30): VAT deductible by the user. */
  tollsAndParking: bofip('BOI-TVA-DED-40-40 (péages et stationnement)', 1109),
  /** Restaurants: 10 % on food served on site, standard rate on alcoholic drinks (CGI art. 279, m). */
  restaurantRate: bofip('BOI-TVA-LIQ-30-20-10-20 (restauration à 10 %, CGI art. 279, m)', 256),
  /** History of the exclusions: restaurant and reception expenses deductible since 2003. */
  restaurantDeduction: bofip('BOI-TVA-DED-30-30-10 (biens et services exclus, historique)', 1190),
  /** Fuel: 80 % deductible for vehicles excluded from deduction, 100 % for the others (CGI art. 298, 4, 1°). */
  fuel: bofip('BOI-TVA-DED-30-30-40 (carburants, CGI art. 298, 4, 1°)', 1194),
  /** Passenger cars: purchase, leasing, repairs and maintenance excluded (CGI ann. II art. 206, IV, 2°, 6°). */
  passengerCars: bofip('BOI-TVA-DED-30-30-20 (véhicules de tourisme exclus)', 1192),
  /** Universal postal service exempt (CGI art. 261, 4, 11°), stamps at face value (CGI art. 261 C, 3°). */
  postal: bofip('BOI-TVA-CHAMP-30-10-60-10 (services postaux et timbres)', 823),
  /** Press registered with the CPPAP at 2,10 % (CGI art. 298 septies), printed and online. */
  pressPrinted: bofip('BOI-TVA-SECT-40-10-10 (publications de presse à 2,10 %)', 918),
  pressOnline: bofip('BOI-TVA-SECT-40-40 (presse en ligne à 2,10 %)', 9291),
  /** Insurance exempt (CGI art. 261 C, 2°). */
  insurance: bofip('BOI-TVA-CHAMP-30-10-70 (assurance exonérée, CGI art. 261 C, 2°)', 14279),
  /** Banking operations exempt (CGI art. 261 C, 1°), account keeping fees listed (§90), option of art. 260 B. */
  bankFees: bofip('BOI-TVA-SECT-50-10-10 (opérations bancaires, CGI art. 261 C, 1°)', 1839),
  /** Rental of bare premises exempt (CGI art. 261 D, 2°) unless the lessor opts (CGI art. 260, 2°). */
  rentExempt: bofip('BOI-TVA-CHAMP-30-10-50 (locations de locaux nus exonérées)', 2846),
  rentOption: bofip('BOI-TVA-CHAMP-50-10 (option du bailleur, CGI art. 260, 2°)', 730),
  /** Standard rate of 20 % (CGI art. 278). */
  standardRate: bofip('BOI-TVA-LIQ-20 (taux normal de 20 %, CGI art. 278)', 1376),
  /** Electricity and gas subscriptions at 20 % since 1 August 2025 (loi 2025-127, art. 20). */
  energy: bofip('BOI-RES-TVA-000209 (abonnements d’électricité et de gaz à 20 %)', 14705),
  /** Only a supply for consideration is within the scope of VAT: taxes, contributions and transfers are not. */
  scope: bofip('BOI-TVA-CHAMP-10-10-10 (opérations imposables, contrepartie)', 162),
  /** Stripe's own page: no VAT on Stripe fees for accounts of the EU outside Ireland. */
  stripeFees: { label: 'Stripe, taxes sur les frais Stripe', url: 'https://support.stripe.com/questions/global-taxation-of-stripe-fees' },
} satisfies Record<string, Source>
