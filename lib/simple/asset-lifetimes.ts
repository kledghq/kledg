/**
 * Default depreciation of the fixed assets simple mode creates when a user
 * answers that a purchase is durable equipment (docs/categories-simples.md).
 * Pure module: the confirmation service creates the asset with it, the tests
 * and the docs read the same table.
 *
 * Linear depreciation over the usual useful life of the kind of equipment,
 * from the acquisition date (the purchase is taken as put into service the
 * day it is paid, PCG art. 214-13: depreciation starts when the asset is
 * ready to be used). The accountant can change the duration on the fixed
 * asset page before the first allowance is booked.
 *
 * Durations: depreciation follows the normal useful life of the asset (PCG
 * art. 214-1 and 214-4 for the depreciation plan; CGI art. 39, 1-2°: "d'après
 * les usages de chaque nature d'industrie"). The tax administration lists the
 * usual rates in BOI-BIC-AMT-10-40-30 (I-B and I-C, taux usuels): matériel
 * 10 to 15 %, outillage 10 to 20 %, matériel de bureau 10 to 20 %, mobilier
 * 10 %. Computer equipment is commonly depreciated over 3 years because of
 * its fast obsolescence, a duration accepted in practice as the usage of the
 * profession for micro computers.
 *
 * Accounts (PCG art. 932-1): allowance to 6811 (dotations aux amortissements
 * sur immobilisations incorporelles et corporelles), accumulated
 * depreciation to 2815 (installations techniques, matériel et outillage
 * industriels) or 2818 (autres immobilisations corporelles).
 */

/** The allowance account of every asset simple mode creates (PCG art. 932-1). */
export const DEPRECIATION_EXPENSE_ACCOUNT = '6811'

export interface AssetLifetime {
  /** Category of the catalogue (lib/simple/categories.ts) whose durable answer creates the asset. */
  categoryId: string
  /** Asset account of the durable answer. */
  assetAccount: string
  /** Accumulated depreciation account (28). */
  depreciationAccount: string
  /** Default useful life in years, linear depreciation. */
  years: number
  /** Why this duration. */
  source: string
}

const USUAL_RATES = 'BOI-BIC-AMT-10-40-30, I-B et I-C (taux usuels)'

export const ASSET_LIFETIMES: readonly AssetLifetime[] = [
  {
    categoryId: 'materiel-informatique',
    assetAccount: '2183',
    depreciationAccount: '2818',
    years: 3,
    source: `Usage admis pour le matériel informatique (obsolescence rapide) : 3 ans, plus court que le matériel de bureau (10 à 20 %, ${USUAL_RATES}); PCG art. 214-1 et 214-4; CGI art. 39, 1-2°`,
  },
  {
    categoryId: 'mobilier',
    assetAccount: '2184',
    depreciationAccount: '2818',
    years: 10,
    source: `Mobilier : 10 % par an, soit 10 ans (${USUAL_RATES}); PCG art. 214-1 et 214-4; CGI art. 39, 1-2°`,
  },
  {
    categoryId: 'outillage',
    assetAccount: '2155',
    depreciationAccount: '2815',
    years: 5,
    source: `Outillage : 10 à 20 % par an, soit 5 à 10 ans; matériel : 10 à 15 % (${USUAL_RATES}); durée la plus courte retenue, à allonger pour une machine; PCG art. 214-1 et 214-4; CGI art. 39, 1-2°`,
  },
]

/** The default depreciation of the asset a category creates, null when its answers never create one. */
export function assetLifetimeFor(categoryId: string | null | undefined): AssetLifetime | null {
  return ASSET_LIFETIMES.find((l) => l.categoryId === categoryId) ?? null
}

/** "Immobilisation créée : MacBook Pro, amortie sur 3 ans", for the accountant. */
export function fixedAssetMention(label: string, years: number | null): string {
  const duration = years ? `, amortie sur ${years} an${years > 1 ? 's' : ''}` : ''
  return `Immobilisation créée : ${label}${duration}`
}
