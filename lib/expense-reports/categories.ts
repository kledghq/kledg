/**
 * Categories of expense report lines: the label shown, the expense account
 * proposed (PCG art. 932-1, liste des comptes) and the VAT rule that applies
 * (vat-recovery.ts). Pure module (its one import is pure too): the line
 * editor and the server share it.
 *
 * Accounts (PCG, classe 6):
 * - 6251 Voyages et déplacements: train, plane, taxi, tolls and parking,
 *   and the mileage allowances (indemnités kilométriques);
 * - 6256 Missions: hotel and meals of a business trip;
 * - 6257 Réceptions: meals and receptions with customers or partners;
 * - 6061 Fournitures non stockables (eau, énergie): fuel;
 * - 6064 Fournitures administratives: small office supplies;
 * - 626 Frais postaux et de télécommunications;
 * - 6234 Cadeaux à la clientèle.
 */

import { isAccountCode } from '@/lib/accounting/account-code'

export type ExpenseCategory =
  | 'TRANSPORT'
  | 'TOLLS_PARKING'
  | 'LODGING'
  | 'MEALS'
  | 'RECEPTION'
  | 'FUEL'
  | 'SUPPLIES'
  | 'POSTAGE'
  | 'GIFTS'
  | 'MILEAGE'
  | 'OTHER'

/** How the VAT of a category is recovered (vat-recovery.ts gives the sources). */
export type VatRule = 'standard' | 'passenger-transport' | 'staff-lodging' | 'fuel' | 'gift' | 'none'

export interface CategoryDefinition {
  label: string
  /** PCG account proposed; null: the line must carry its own account. */
  account: string | null
  vatRule: VatRule
  /** Short help shown under the category in the line editor. */
  hint: string
}

export const EXPENSE_CATEGORIES: Record<ExpenseCategory, CategoryDefinition> = {
  TRANSPORT: {
    label: 'Transport (train, avion, taxi, VTC)',
    account: '6251',
    vatRule: 'passenger-transport',
    hint: 'TVA non récupérable sur le transport de personnes.',
  },
  // Tolls and parking are not passenger transport: their VAT is deductible by the user under the usual
  // conditions (BOI-TVA-DED-40-40 § 30 for parking, § 330 for motorway tolls, the deduction being
  // "strictement subordonnée à la mention par l'usager de son identification complète" on the receipt),
  // as simple mode and the rules library book them
  TOLLS_PARKING: {
    label: 'Péages et parking',
    account: '6251',
    vatRule: 'standard',
    hint: 'TVA récupérable avec le reçu de péage ou de parking complété au nom de la société.',
  },
  LODGING: {
    label: 'Hébergement (hôtel)',
    account: '6256',
    vatRule: 'staff-lodging',
    hint: 'TVA non récupérable sur l’hébergement des dirigeants et du personnel.',
  },
  MEALS: {
    label: 'Repas en déplacement',
    account: '6256',
    vatRule: 'standard',
    hint: 'TVA récupérable avec une facture, ou un ticket détaillé de 150 € HT au plus.',
  },
  RECEPTION: {
    label: 'Repas d’affaires et réceptions',
    account: '6257',
    vatRule: 'standard',
    hint: 'TVA récupérable avec une facture, ou un ticket détaillé de 150 € HT au plus.',
  },
  FUEL: {
    label: 'Carburant (véhicule de tourisme)',
    account: '6061',
    vatRule: 'fuel',
    hint: 'TVA récupérable à 80 % sur l’essence et le gazole d’un véhicule de tourisme.',
  },
  SUPPLIES: {
    label: 'Petites fournitures',
    account: '6064',
    vatRule: 'standard',
    hint: 'Fournitures de bureau et petit matériel.',
  },
  POSTAGE: {
    label: 'Frais postaux et télécommunications',
    account: '626',
    vatRule: 'standard',
    hint: 'Affranchissement, téléphone, internet.',
  },
  GIFTS: {
    label: 'Cadeaux à la clientèle',
    account: '6234',
    vatRule: 'gift',
    hint: 'TVA récupérable jusqu’à 73 € TTC par bénéficiaire et par an\u00a0: une ligne par bénéficiaire.',
  },
  MILEAGE: {
    label: 'Indemnités kilométriques',
    account: '6251',
    vatRule: 'none',
    hint: 'Barème kilométrique de l’année, sans TVA.',
  },
  OTHER: {
    label: 'Autre dépense',
    account: null,
    vatRule: 'standard',
    hint: 'Choisissez le compte de charge de la dépense.',
  },
}

export const EXPENSE_CATEGORY_KEYS = Object.keys(EXPENSE_CATEGORIES) as ExpenseCategory[]

/** Categories offered on an expense line (mileage has its own line type). */
export const EXPENSE_LINE_CATEGORIES = EXPENSE_CATEGORY_KEYS.filter((key) => key !== 'MILEAGE')

/**
 * Whether `code` can be the expense account of a line: a charge (class 6,
 * at least three characters) in the one account number format
 * (lib/accounting/account-code.ts). A fixed asset bought by an employee is
 * an invoice of its own (its VAT goes to 44562, not 44566).
 */
export function isExpenseAccountCode(code: string): boolean {
  return isAccountCode(code) && code.startsWith('6') && code.length >= 3
}
