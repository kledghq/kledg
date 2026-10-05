/**
 * Templates of travel and vehicles: transport, meals, fuel and
 * passenger cars, where the right to deduct VAT has its own rules. See
 * docs/bibliotheque-de-regles.md to add one.
 *
 * Hotel nights of directors and staff: VAT not deductible, even on a
 * business trip (CGI ann. II art. 206, IV, 2°, 2°; answer to the written
 * question n° 12225 of 12 December 2023), as the simple mode treats them
 * (lib/simple/categories.ts). Meals billed apart by the hotel follow the
 * restaurant rule; lodging a client or a supplier is deductible (not this
 * template).
 */

import { DEBIT, labelMatches, noVatLine, reducedVatLine, standardVatLine, type RuleTemplate, type RuleTemplateLine } from '../template'
import { UBER_RIDES_PATTERN } from './label-patterns'
import { SOURCES } from './sources'

const FUEL_STATIONS = labelMatches(
  '\\b(totalenergies (relais|access|station)|total (mkt|access|relais)|esso|shell|avia|agip|carburants?|station service)\\b',
  'TOTALENERGIES RELAIS, TOTAL ACCESS, ESSO, SHELL, AVIA, CARBURANT',
)
const FUEL_SAMPLES = { match: ['CB TOTAL MKT FR 12/03', 'TOTALENERGIES RELAIS A6', 'ESSO EXPRESS'], noMatch: ['PRLV SEPA TOTALENERGIES ELECTRICITE ET GAZ', 'TOTAL REMBOURSEMENT'] }

/**
 * Fuel of a vehicle excluded from deduction: 80 % of the VAT deductible
 * (CGI art. 298, 4, 1°). The first line takes 80 % of the amount paid with
 * VAT at 20 % inside it, so its VAT is 80 % of the VAT of the receipt; the
 * rest stays in the cost without VAT.
 */
const FUEL_80: RuleTemplateLine[] = [
  { accountCode: '6061', lineType: 'debit', amountType: 'percentage', amountValue: 80, vatType: 'deductible', vatRateSource: 'fixed', vatRate: 20, vatAccountCode: '44566' },
  { accountCode: '6061', lineType: 'debit', amountType: 'remaining', description: 'Carburant, TVA non déductible (20 %)' },
]

const PASSENGER_TRANSPORT_WHY =
  'Transport de personnes : TVA à 10 % (CGI art. 279, b quater) mais exclue de la déduction (CGI ann. II art. 206, IV, 2°, 5°) : le billet est une charge pour son montant TTC.'

export const TRAVEL_TEMPLATES: RuleTemplate[] = [
  {
    id: 'hotel',
    name: 'Hôtels en déplacement',
    category: 'transport',
    description: "Nuits d'hôtel des dirigeants et des salariés en déplacement (Accor, B&B Hotels, Louvre Hotels, Booking.com, Hotels.com), en missions (6256).",
    conditions: [DEBIT, labelMatches('\\b(ibis|novotel|mercure|accor\\w*|b&b hotels?|campanile|kyriad|premiere classe|booking\\.com|hotels\\.com|hotel|h[oô]tel)\\b', 'IBIS, NOVOTEL, MERCURE, ACCOR, B&B HOTELS, CAMPANILE, KYRIAD, BOOKING.COM, HOTELS.COM, HOTEL')],
    lines: [noVatLine('6256')],
    vat: {
      treatment: 'not-deductible',
      why: "Hébergement à 10 % (CGI art. 279, a) mais logement des dirigeants et du personnel exclu de la déduction, même en déplacement professionnel (CGI ann. II art. 206, IV, 2°, 2°) : la nuit est une charge pour son montant TTC. Les repas facturés à part suivent la règle des restaurants ; l'hébergement d'un client ou d'un fournisseur ouvre droit à déduction.",
    },
    sources: [SOURCES.cgiAnnex2Art206, SOURCES.staffLodging, SOURCES.staffLodgingAnswer],
    samples: { match: ['CB IBIS PARIS GARE DE LYON', 'BOOKING.COM HOTEL', 'B&B HOTELS NANTES'], noMatch: ['CB SNACK FOOD', 'PRLV SEPA OVH'] },
  },
  {
    id: 'train',
    name: 'Billets de train',
    category: 'transport',
    description: 'Billets SNCF, Ouigo, Trainline et Eurostar, en voyages et déplacements (6251).',
    conditions: [DEBIT, labelMatches('\\b(sncf|ouigo|inoui|trainline|eurostar)\\b', 'SNCF, OUIGO, INOUI, TRAINLINE, EUROSTAR')],
    lines: [noVatLine('6251')],
    vat: { treatment: 'not-deductible', why: PASSENGER_TRANSPORT_WHY },
    sources: [SOURCES.passengerTransportRate, SOURCES.passengerTransportExclusion, SOURCES.cgiAnnex2Art206],
    samples: { match: ['SNCF CONNECT', 'CB OUIGO', 'TRAINLINE.FR'], noMatch: ['CB SNACK FOOD'] },
  },
  {
    id: 'taxi-vtc',
    name: 'Taxis et VTC',
    category: 'transport',
    description: 'Courses de taxi et de VTC (Uber, G7, FreeNow, Heetch), en voyages et déplacements (6251).',
    conditions: [DEBIT, labelMatches(`${UBER_RIDES_PATTERN}|\\b(g7|taxis?|heetch|freenow|free now|lecab)\\b`, 'UBER TRIP, G7, TAXI, FREENOW, HEETCH')],
    lines: [noVatLine('6251')],
    vat: { treatment: 'not-deductible', why: PASSENGER_TRANSPORT_WHY },
    sources: [SOURCES.passengerTransportRate, SOURCES.passengerTransportExclusion],
    samples: { match: ['UBER *TRIP HELP.UBER.COM', 'TAXI G7', 'FREENOW*PARIS'], noMatch: ['UBER * EATS', 'UBER EATS PARIS'] },
  },
  {
    id: 'avion',
    name: "Billets d'avion",
    category: 'transport',
    description: "Billets d'avion des compagnies courantes, en voyages et déplacements (6251).",
    conditions: [DEBIT, labelMatches('\\b(air france|easyjet|transavia|ryanair|vueling|lufthansa|klm|volotea)\\b', 'AIR FRANCE, EASYJET, TRANSAVIA, RYANAIR, VUELING...')],
    lines: [noVatLine('6251')],
    vat: {
      treatment: 'not-deductible',
      why: "Vols internationaux exonérés (CGI art. 262, II, 8°) ; vols intérieurs à 10 % mais transport de personnes exclu de la déduction (CGI ann. II art. 206, IV, 2°, 5°) : pas de TVA à déduire.",
    },
    sources: [SOURCES.internationalFlights, SOURCES.passengerTransportExclusion],
    samples: { match: ['AIR FRANCE 0571234567890', 'EASYJET', 'TRANSAVIA FRANCE'], noMatch: ['CB AIR LIQUIDE'] },
  },
  {
    id: 'peages',
    name: "Péages d'autoroute",
    category: 'transport',
    description: "Péages d'autoroute et badges de télépéage, en voyages et déplacements (6251).",
    conditions: [DEBIT, labelMatches('\\b(vinci autoroutes|sanef|aprr|asf|escota|cofiroute|bip.go|ulys|autoroutes?|p.ages?)\\b', 'PEAGE, AUTOROUTE, VINCI AUTOROUTES, SANEF, APRR, BIP&GO, ULYS')],
    lines: [standardVatLine('6251')],
    vat: { treatment: 'standard', why: "Péages au taux normal de 20 %, TVA déductible par l'utilisateur (BOI-TVA-DED-40-40) : détectée par la banque, 20 % sinon." },
    sources: [SOURCES.tollsAndParking],
    samples: { match: ['PEAGE A6 FLEURY', 'VINCI AUTOROUTES', 'BIP&GO'], noMatch: ['CB PAGES JAUNES'] },
  },
  {
    id: 'parking',
    name: 'Parkings',
    category: 'transport',
    description: 'Stationnement en parking (Indigo, Saemes, Onepark, Effia, Zenpark), en voyages et déplacements (6251).',
    conditions: [DEBIT, labelMatches('\\b(parking|indigo|saemes|onepark|effia|zenpark)\\b', 'PARKING, INDIGO, SAEMES, ONEPARK, EFFIA, ZENPARK')],
    lines: [standardVatLine('6251')],
    vat: { treatment: 'standard', why: 'Stationnement au taux normal, TVA déductible par l’utilisateur (BOI-TVA-DED-40-40) : détectée par la banque, 20 % sinon.' },
    sources: [SOURCES.tollsAndParking],
    samples: { match: ['CB INDIGO PARIS', 'PARKING GARE LYON PART DIEU', 'ONEPARK'], noMatch: ['CB PARKER PENS'] },
  },
  {
    id: 'restaurant',
    name: "Restaurants (repas d'affaires)",
    category: 'repas',
    description: "Repas d'affaires au restaurant, en réceptions (6257).",
    conditions: [DEBIT, labelMatches('\\b(restaurant|resto|brasserie|bistrot?|trattoria|pizzeria)\\b', 'RESTAURANT, BRASSERIE, BISTROT, PIZZERIA')],
    lines: [reducedVatLine('6257', 10)],
    vat: {
      treatment: 'reduced',
      why: "Repas servis sur place : 10 % sur la nourriture, 20 % sur l'alcool (CGI art. 279, m) ; TVA déductible quand le repas est engagé dans l'intérêt de l'entreprise, avec une facture à son nom. Détectée par la banque, 10 % sinon.",
    },
    sources: [SOURCES.restaurantRate, SOURCES.restaurantDeduction],
    samples: { match: ['CB RESTAURANT LE MARAIS', 'BRASSERIE LIPP', 'PIZZERIA NAPOLI'], noMatch: ['CB RESTORATION HARDWARE'] },
  },
  {
    id: 'carburant-voiture-particuliere',
    name: 'Carburant (voiture particulière, TVA 80 %)',
    category: 'carburant',
    description: "Gazole ou essence d'une voiture particulière, en fournitures non stockables (6061) ; pour un utilitaire, choisissez le modèle à 100 %.",
    conditions: [DEBIT, FUEL_STATIONS],
    lines: FUEL_80,
    vat: {
      treatment: 'partial',
      why: "Carburant d'un véhicule exclu de la déduction : 80 % de la TVA à 20 % se déduit (CGI art. 298, 4, 1°), le reste reste dans la charge.",
    },
    sources: [SOURCES.fuel],
    samples: FUEL_SAMPLES,
  },
  {
    id: 'carburant-utilitaire',
    name: 'Carburant (véhicule utilitaire, TVA 100 %)',
    category: 'carburant',
    description: "Gazole ou essence d'un véhicule utilitaire, en fournitures non stockables (6061) ; pour une voiture particulière, choisissez le modèle à 80 %.",
    conditions: [DEBIT, FUEL_STATIONS],
    lines: [standardVatLine('6061')],
    vat: { treatment: 'standard', why: "Carburant d'un véhicule utilitaire : TVA à 20 % entièrement déductible depuis 2022 (CGI art. 298, 4, 1°)." },
    sources: [SOURCES.fuel],
    samples: FUEL_SAMPLES,
  },
  {
    id: 'location-voiture-particuliere',
    name: 'Location longue durée (voiture particulière)',
    category: 'vehicules',
    description: "Loyers de location longue durée d'une voiture particulière, en locations mobilières (6135).",
    conditions: [DEBIT, labelMatches('\\b(ayvens|ald automotive|arval|leaseplan|leasys|diac|athlon)\\b', 'AYVENS, ALD AUTOMOTIVE, ARVAL, LEASEPLAN, LEASYS, DIAC')],
    lines: [noVatLine('6135')],
    vat: {
      treatment: 'not-deductible',
      why: "Location d'une voiture particulière : TVA exclue de la déduction (CGI ann. II art. 206, IV, 2°, 6°), le loyer est une charge TTC. Un utilitaire ouvre droit à déduction : ajoutez alors la TVA à la ligne.",
    },
    sources: [SOURCES.passengerCars, SOURCES.cgiAnnex2Art206],
    samples: { match: ['PRLV SEPA AYVENS', 'ARVAL SERVICE LEASE', 'LEASYS FRANCE'], noMatch: ['CB ARVALIS'] },
  },
  {
    id: 'entretien-voiture-particuliere',
    name: 'Entretien et réparations (voiture particulière)',
    category: 'vehicules',
    description: "Entretien et réparations d'une voiture particulière, en entretien et réparations sur biens mobiliers (6155).",
    conditions: [DEBIT, labelMatches('\\b(norauto|speedy|feu vert|midas|point s|euromaster|carglass)\\b', 'NORAUTO, SPEEDY, FEU VERT, MIDAS, POINT S, EUROMASTER, CARGLASS')],
    lines: [noVatLine('6155')],
    vat: {
      treatment: 'not-deductible',
      why: "Entretien et réparations d'une voiture particulière : TVA exclue de la déduction (CGI ann. II art. 206, IV, 2°, 6° et 7°). Pour un utilitaire, ajoutez la TVA à la ligne.",
    },
    sources: [SOURCES.passengerCars, SOURCES.cgiAnnex2Art206],
    samples: { match: ['CB NORAUTO', 'SPEEDY PARIS 12', 'FEU VERT'], noMatch: ['CB SPEEDWAY BAR'] },
  },
]
