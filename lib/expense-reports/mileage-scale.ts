/**
 * Mileage allowances (indemnités kilométriques) by the official scale.
 * Pure module without imports: the line editor and the server share it.
 *
 * The scale ("barème forfaitaire permettant l'évaluation des frais de
 * déplacement relatifs à l'utilisation d'un véhicule") is set by arrêté. An
 * allowance paid by the employer within the scale is presumed to be used as
 * intended and is not subject to contributions (URSSAF, Indemnités
 * kilométriques; arrêté du 20 décembre 2002, art. 4). Versions:
 *
 * | Years | Source |
 * | --- | --- |
 * | 2022 to 2026 | Arrêté du 27 mars 2023 (JORF du 7 avril 2023), BOI-BAREME-000001-20230720; kept unchanged for 2024, 2025 and 2026 (URSSAF, "Indemnités kilométriques", barème 2026 reconduit) |
 *
 * A year missing here is refused: Kledg never guesses a scale. Add the new
 * year with its source when the arrêté is published.
 *
 * Electric vehicles: the amount is increased by 20 % (BOI-BAREME-000001,
 * from the income of 2020).
 *
 * The bands are annual: the distance d of the formulas is the distance of
 * the year with that vehicle. A trip is paid the difference between the
 * scale at the cumulative distance after it and before it, so the trips of a
 * year always sum to the scale of the year's distance, whatever their order.
 *
 * Rates are kept in thousandths of a euro per km and fixed parts in euros;
 * amounts are computed in tenths of a cent and rounded to the cent.
 */

export type VehicleType = 'CAR' | 'MOTORCYCLE' | 'MOPED'

export const VEHICLE_LABELS: Record<VehicleType, string> = {
  CAR: 'Voiture',
  MOTORCYCLE: 'Moto (plus de 50 cm³)',
  MOPED: 'Cyclomoteur (50 cm³ au plus)',
}

/** One band: d x rate + fixed, for distances up to `upToKm` (null: no limit). */
interface Band {
  upToKm: number | null
  /** Thousandths of a euro per km. */
  rateMillis: number
  /** Euros. */
  fixedEuros: number
}

interface PowerClass {
  /** Lowest fiscal power of the class (CV). */
  minPower: number
  label: string
  bands: Band[]
}

export interface MileageScale {
  year: number
  source: string
  vehicles: Record<VehicleType, PowerClass[]>
}

const SCALE_2023: Omit<MileageScale, 'year'> = {
  source: 'Arrêté du 27 mars 2023 (JORF du 7 avril 2023), BOI-BAREME-000001-20230720',
  vehicles: {
    CAR: [
      { minPower: 0, label: '3 CV et moins', bands: [{ upToKm: 5000, rateMillis: 529, fixedEuros: 0 }, { upToKm: 20000, rateMillis: 316, fixedEuros: 1065 }, { upToKm: null, rateMillis: 370, fixedEuros: 0 }] },
      { minPower: 4, label: '4 CV', bands: [{ upToKm: 5000, rateMillis: 606, fixedEuros: 0 }, { upToKm: 20000, rateMillis: 340, fixedEuros: 1330 }, { upToKm: null, rateMillis: 407, fixedEuros: 0 }] },
      { minPower: 5, label: '5 CV', bands: [{ upToKm: 5000, rateMillis: 636, fixedEuros: 0 }, { upToKm: 20000, rateMillis: 357, fixedEuros: 1395 }, { upToKm: null, rateMillis: 427, fixedEuros: 0 }] },
      { minPower: 6, label: '6 CV', bands: [{ upToKm: 5000, rateMillis: 665, fixedEuros: 0 }, { upToKm: 20000, rateMillis: 374, fixedEuros: 1457 }, { upToKm: null, rateMillis: 447, fixedEuros: 0 }] },
      { minPower: 7, label: '7 CV et plus', bands: [{ upToKm: 5000, rateMillis: 697, fixedEuros: 0 }, { upToKm: 20000, rateMillis: 394, fixedEuros: 1515 }, { upToKm: null, rateMillis: 470, fixedEuros: 0 }] },
    ],
    MOTORCYCLE: [
      { minPower: 0, label: '1 ou 2 CV', bands: [{ upToKm: 3000, rateMillis: 395, fixedEuros: 0 }, { upToKm: 6000, rateMillis: 99, fixedEuros: 891 }, { upToKm: null, rateMillis: 248, fixedEuros: 0 }] },
      { minPower: 3, label: '3, 4 ou 5 CV', bands: [{ upToKm: 3000, rateMillis: 468, fixedEuros: 0 }, { upToKm: 6000, rateMillis: 82, fixedEuros: 1158 }, { upToKm: null, rateMillis: 275, fixedEuros: 0 }] },
      { minPower: 6, label: 'Plus de 5 CV', bands: [{ upToKm: 3000, rateMillis: 606, fixedEuros: 0 }, { upToKm: 6000, rateMillis: 79, fixedEuros: 1583 }, { upToKm: null, rateMillis: 343, fixedEuros: 0 }] },
    ],
    MOPED: [{ minPower: 0, label: 'Toutes puissances', bands: [{ upToKm: 3000, rateMillis: 315, fixedEuros: 0 }, { upToKm: 6000, rateMillis: 79, fixedEuros: 711 }, { upToKm: null, rateMillis: 198, fixedEuros: 0 }] }],
  },
}

const UNCHANGED = 'reconduit à l’identique (URSSAF, Indemnités kilométriques)'

/** The scales Kledg knows, by year of the trips. */
export const MILEAGE_SCALES: Readonly<Record<number, MileageScale>> = {
  2022: { year: 2022, ...SCALE_2023 },
  2023: { year: 2023, ...SCALE_2023 },
  2024: { year: 2024, ...SCALE_2023, source: `${SCALE_2023.source}, ${UNCHANGED}` },
  2025: { year: 2025, ...SCALE_2023, source: `${SCALE_2023.source}, ${UNCHANGED}` },
  2026: { year: 2026, ...SCALE_2023, source: `${SCALE_2023.source}, ${UNCHANGED}` },
}

/** Increase for electric vehicles, in percent (BOI-BAREME-000001). */
export const ELECTRIC_INCREASE_PERCENT = 20

export function mileageScaleOf(year: number): MileageScale | null {
  return MILEAGE_SCALES[year] ?? null
}

/** The power class of a vehicle (CV), the highest class whose minimum it reaches. */
export function powerClassOf(scale: MileageScale, vehicle: VehicleType, fiscalPower: number): PowerClass {
  const classes = scale.vehicles[vehicle]
  return [...classes].reverse().find((c) => fiscalPower >= c.minPower) ?? classes[0]
}

/** The scale amount for a whole year's distance, in tenths of a cent (before the electric increase). */
function annualTenthsOfCent(powerClass: PowerClass, distanceKm: number): number {
  if (distanceKm <= 0) return 0
  const band = powerClass.bands.find((b) => b.upToKm === null || distanceKm <= b.upToKm) as Band
  // d x rate (thousandths of a euro = tenths of a cent) + fixed (euros = 1000 tenths of a cent)
  return distanceKm * band.rateMillis + band.fixedEuros * 1000
}

/** Scale amount in cents for a year's distance, with the electric increase, rounded half away from zero. */
export function annualAllowanceCents(powerClass: PowerClass, distanceKm: number, electric: boolean): number {
  const percent = 100 + (electric ? ELECTRIC_INCREASE_PERCENT : 0)
  // tenths of a cent x percent / 100, then / 10 to cents: one integer division, half rounded up
  return Math.floor((annualTenthsOfCent(powerClass, distanceKm) * percent + 500) / 1000)
}

export interface MileageInput {
  year: number
  vehicle: VehicleType
  fiscalPower: number
  electric: boolean
  distanceKm: number
  /** Distance already counted in the year with this vehicle, before this trip. */
  priorDistanceKm: number
}

export type MileageResult =
  | { ok: true; amountCents: number; scale: MileageScale; powerClass: string; annualAfterCents: number }
  | { ok: false; error: string }

/** The allowance of one trip: scale(prior + distance) minus scale(prior), in cents. */
export function mileageAllowance(input: MileageInput): MileageResult {
  const scale = mileageScaleOf(input.year)
  if (!scale) {
    const known = Object.keys(MILEAGE_SCALES).join(', ')
    return { ok: false, error: `Kledg ne connaît pas le barème kilométrique ${input.year} (barèmes connus\u00a0: ${known}).` }
  }
  if (!Number.isInteger(input.distanceKm) || input.distanceKm <= 0) return { ok: false, error: 'La distance est un nombre entier de kilomètres, supérieur à zéro.' }
  if (!Number.isInteger(input.priorDistanceKm) || input.priorDistanceKm < 0) return { ok: false, error: 'Kilométrage antérieur invalide.' }
  if (input.vehicle !== 'MOPED' && (!Number.isInteger(input.fiscalPower) || input.fiscalPower < 1 || input.fiscalPower > 99)) {
    return { ok: false, error: 'Indiquez la puissance fiscale du véhicule (en CV, sur la carte grise).' }
  }
  const powerClass = powerClassOf(scale, input.vehicle, input.fiscalPower)
  const before = annualAllowanceCents(powerClass, input.priorDistanceKm, input.electric)
  const after = annualAllowanceCents(powerClass, input.priorDistanceKm + input.distanceKm, input.electric)
  return { ok: true, amountCents: after - before, scale, powerClass: powerClass.label, annualAfterCents: after }
}
