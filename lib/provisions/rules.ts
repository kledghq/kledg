/**
 * Rules of provisions and impairments on plain values (pure module, usable
 * by the client): the allowance accounts of each category, the dotation and
 * reprise accounts a movement goes to, the movement that brings an
 * allowance to the balance required at a closing, the impairment of a fixed
 * asset from its current value and the base of a doubtful receivable.
 *
 * A provision for risks and charges and an impairment work the same way in
 * the books: an allowance account with a credit balance (15, 29, 39, 49,
 * 59) is adjusted at each closing, by a dotation (debit 68, credit the
 * allowance) when more is needed, by a reprise (debit the allowance, credit
 * 78) when less is.
 *
 * Sources:
 * - Code de commerce art. L123-20: the accounts are prudent; provisions and
 *   impairments are booked even when there is no profit.
 * - PCG art. 322-1 et seq. (ANC 2014-03): a provision is a liability whose
 *   timing or amount is not fixed precisely; it is booked when an obligation
 *   exists at the closing date and will probably or certainly cause an
 *   outflow without equivalent consideration, for the best estimate of that
 *   outflow, and its amount is reviewed at each closing.
 * - PCG art. 214-15 et seq.: at each closing, an asset whose current value
 *   (the higher of its market value and its value in use) falls below its
 *   net book value is written down to that value; the impairment is
 *   reversed when the reasons for it cease, except for goodwill (fonds
 *   commercial), whose impairments are never reversed (art. 214-19).
 * - Chart of accounts of the PCG as amended by ANC 2022-06 (fiscal years
 *   from 1 January 2025, lib/accounting/pcg-data.ts): 151 provisions pour
 *   risques, 152 provisions pour charges, 29, 39, 49, 59 dépréciations,
 *   681/686/687 dotations, 781/786/787 reprises. The codes of the former
 *   chart (153 to 158) no longer exist.
 * - CGI art. 39, 1-5°: a provision is deductible when it covers losses or
 *   charges nettement précisées that events in progress make probable, is
 *   booked in the accounts of the year and listed on the relevé des
 *   provisions (form 2056, 2033-D in the simplified regime). Not
 *   deductible: retirement allowances (same article), fines and penalties
 *   (CGI art. 39, 2). BOFiP BOI-BIC-PROV-20-10 (conditions de fond) and
 *   BOI-BIC-PROV-20-20 (conditions de forme).
 * - CGI art. 272, 1: the VAT collected on a receivable that becomes
 *   definitively uncollectable is recovered, so a doubtful receivable is
 *   written down on its amount excluding tax.
 */

export const PROVISION_CATEGORIES = ['RISK_CHARGE', 'FIXED_ASSET', 'INVENTORY', 'RECEIVABLE', 'SECURITY'] as const
export type ProvisionCategory = (typeof PROVISION_CATEGORIES)[number]

export const PROVISION_NATURES = ['OPERATING', 'FINANCIAL', 'EXCEPTIONAL'] as const
export type ProvisionNature = (typeof PROVISION_NATURES)[number]

export const CATEGORY_LABELS: Record<ProvisionCategory, string> = {
  RISK_CHARGE: 'Provision pour risques et charges',
  FIXED_ASSET: 'Dépréciation d\'une immobilisation',
  INVENTORY: 'Dépréciation des stocks',
  RECEIVABLE: 'Dépréciation d\'une créance',
  SECURITY: 'Dépréciation de valeurs mobilières',
}

export const NATURE_LABELS: Record<ProvisionNature, string> = {
  OPERATING: 'Exploitation',
  FINANCIAL: 'Financier',
  EXCEPTIONAL: 'Exceptionnel',
}

export interface AccountRef {
  code: string
  label: string
}

/** Allowance accounts offered per category (official labels of the chart). */
export const ALLOWANCE_ACCOUNTS: Record<ProvisionCategory, AccountRef[]> = {
  RISK_CHARGE: [
    { code: '1511', label: 'Provisions pour litiges' },
    { code: '1512', label: 'Provisions pour garanties données aux clients' },
    { code: '1514', label: 'Provisions pour amendes et pénalités' },
    { code: '1515', label: 'Provisions pour pertes de change' },
    { code: '1516', label: 'Provisions pour pertes sur contrats' },
    { code: '1518', label: 'Autres provisions pour risques' },
    { code: '1521', label: 'Provisions pour pensions et obligations similaires' },
    { code: '1522', label: 'Provisions pour restructurations' },
    { code: '1523', label: 'Provisions pour impôts' },
    { code: '1524', label: 'Provisions pour renouvellement des immobilisations - entreprises concessionnaires' },
    { code: '1525', label: 'Provisions pour gros entretien ou grandes révisions' },
    { code: '1526', label: 'Provisions pour remise en état' },
    { code: '1527', label: 'Autres provisions pour charges' },
  ],
  FIXED_ASSET: [
    { code: '2903', label: 'Frais de développement' },
    { code: '2905', label: 'Marques, procédés, droits et valeurs similaires' },
    { code: '2906', label: 'Droit au bail' },
    { code: '2907', label: 'Fonds commercial' },
    { code: '2908', label: 'Autres immobilisations incorporelles' },
    { code: '2911', label: 'Terrains' },
    { code: '2913', label: 'Constructions' },
    { code: '2915', label: 'Installations techniques, matériels et outillages industriels' },
    { code: '2918', label: 'Autres immobilisations corporelles' },
    { code: '2931', label: 'Immobilisations corporelles en cours' },
    { code: '2961', label: 'Titres de participation' },
    { code: '2967', label: 'Créances rattachées à des participations' },
    { code: '2971', label: 'Titres immobilisés autres que les titres immobilisés de l\'activité de portefeuille (droit de propriété)' },
    { code: '2974', label: 'Prêts' },
    { code: '2976', label: 'Autres créances immobilisées' },
  ],
  INVENTORY: [
    { code: '391', label: 'Dépréciations des matières premières et fournitures' },
    { code: '392', label: 'Dépréciations des autres approvisionnements' },
    { code: '393', label: 'Dépréciations des en-cours de production de biens' },
    { code: '394', label: 'Dépréciations des en-cours de production de services' },
    { code: '395', label: 'Dépréciations des stocks de produits' },
    { code: '397', label: 'Dépréciations des stocks de marchandises' },
  ],
  RECEIVABLE: [
    { code: '491', label: 'Dépréciations des comptes de clients' },
    { code: '4951', label: 'Comptes du groupe' },
    { code: '4955', label: 'Comptes courants des associés' },
    { code: '4967', label: 'Autres comptes débiteurs' },
  ],
  SECURITY: [
    { code: '5903', label: 'Actions' },
    { code: '5906', label: 'Obligations' },
    { code: '5908', label: 'Autres valeurs mobilières de placement et créances assimilées' },
  ],
}

const CATEGORY_PREFIXES: Record<ProvisionCategory, string[]> = {
  RISK_CHARGE: ['151', '152'],
  FIXED_ASSET: ['29'],
  INVENTORY: ['39'],
  RECEIVABLE: ['49'],
  SECURITY: ['59'],
}

/** Whether an account code is an allowance account of the category (also checked by the database). */
export function isAllowanceAccountOf(category: ProvisionCategory, code: string): boolean {
  return /^\d{3,}[A-Z0-9]*$/.test(code) && CATEGORY_PREFIXES[category].some((prefix) => code.startsWith(prefix))
}

/** Default allowance account of a category. */
export function defaultAllowanceAccount(category: ProvisionCategory): string {
  return { RISK_CHARGE: '1511', FIXED_ASSET: '2918', INVENTORY: '397', RECEIVABLE: '491', SECURITY: '5908' }[category]
}

/**
 * Impairment account of a fixed asset account: 29 followed by the second and
 * third digits of the asset account (2154 to 2915, 207 to 2907, 261 to
 * 2961), as in the chart of accounts. Null for accounts without one (28,
 * 25, 22).
 */
export function impairmentAccountOfAsset(assetCode: string): string | null {
  if (/^2[01367]\d/.test(assetCode)) return `29${assetCode.slice(1, 3)}`
  return null
}

/** Financial fixed assets (296 participations, 297 other financial assets): their impairments are financial. */
const isFinancialAsset = (code: string) => code.startsWith('296') || code.startsWith('297')
/** Intangible assets (290): sub-account 68161 / 78161 instead of 68162 / 78162. */
const isIntangible = (code: string) => code.startsWith('290')

/** Natures a movement of this allowance may take: where it shows in the income statement. */
export function allowedNatures(category: ProvisionCategory, accountCode: string): ProvisionNature[] {
  switch (category) {
    case 'RISK_CHARGE':
      return ['OPERATING', 'FINANCIAL', 'EXCEPTIONAL']
    case 'FIXED_ASSET':
      return isFinancialAsset(accountCode) ? ['FINANCIAL', 'EXCEPTIONAL'] : ['OPERATING', 'EXCEPTIONAL']
    case 'INVENTORY':
      return ['OPERATING', 'EXCEPTIONAL']
    case 'RECEIVABLE':
      return ['OPERATING', 'FINANCIAL', 'EXCEPTIONAL']
    case 'SECURITY':
      return ['FINANCIAL', 'EXCEPTIONAL']
  }
}

/**
 * Default nature: a provision for exchange losses (1515) and the
 * impairments of financial assets, group and associates' current accounts
 * (495) and securities are financial; the others are operating.
 */
export function defaultNature(category: ProvisionCategory, accountCode: string): ProvisionNature {
  if (category === 'RISK_CHARGE') return accountCode.startsWith('1515') ? 'FINANCIAL' : 'OPERATING'
  if (category === 'RECEIVABLE') return accountCode.startsWith('495') ? 'FINANCIAL' : 'OPERATING'
  return allowedNatures(category, accountCode)[0]
}

/**
 * Deductibility by default of a provision on this account (CGI art. 39):
 * fines and penalties (1514, CGI art. 39, 2) and retirement allowances
 * (1521, CGI art. 39, 1-5°) are not deductible. The user can change it: a
 * provision for taxes (1523) is not deductible when it covers corporate
 * tax (CGI art. 213), for instance.
 */
export function defaultTaxDeductible(accountCode: string): boolean {
  return !(accountCode.startsWith('1514') || accountCode.startsWith('1521'))
}

/** Goodwill (fonds commercial, 2907): its impairments are never reversed (PCG art. 214-19). */
export function isGoodwillImpairment(accountCode: string): boolean {
  return accountCode.startsWith('2907')
}

export interface MovementAccounts {
  dotation: AccountRef
  reprise: AccountRef
}

const ACC = {
  d6815: { code: '6815', label: 'Dotations aux provisions d\'exploitation' },
  r7815: { code: '7815', label: 'Reprises sur provisions d\'exploitation' },
  d6865: { code: '6865', label: 'Dotations aux provisions financières' },
  r7865: { code: '7865', label: 'Reprises sur provisions financières' },
  d6875: { code: '6875', label: 'Dotations aux provisions exceptionnelles' },
  r7875: { code: '7875', label: 'Reprises sur provisions exceptionnelles' },
  d68161: { code: '68161', label: 'Immobilisations incorporelles' },
  r78161: { code: '78161', label: 'Immobilisations incorporelles' },
  d68162: { code: '68162', label: 'Immobilisations corporelles' },
  r78162: { code: '78162', label: 'Immobilisations corporelles' },
  d68173: { code: '68173', label: 'Stocks et en-cours' },
  r78173: { code: '78173', label: 'Stocks et en-cours' },
  d68174: { code: '68174', label: 'Créances' },
  r78174: { code: '78174', label: 'Créances' },
  d6866: { code: '6866', label: 'Dotations pour dépréciation des éléments financiers' },
  r7866: { code: '7866', label: 'Reprises sur dépréciations des éléments financiers' },
  d68662: { code: '68662', label: 'Immobilisations financières' },
  r78662: { code: '78662', label: 'Immobilisations financières' },
  d68665: { code: '68665', label: 'Valeurs mobilières de placement' },
  r78665: { code: '78665', label: 'Valeurs mobilières de placement' },
  d6876: { code: '6876', label: 'Dotations pour dépréciations exceptionnelles' },
  r7876: { code: '7876', label: 'Reprises sur dépréciations exceptionnelles' },
} as const

/**
 * Dotation and reprise accounts of a movement (chart of accounts, 681 to
 * 687 and 781 to 787): the sub-account of the allowance's category and
 * nature. A nature the category does not allow falls back on its default.
 */
export function movementAccounts(category: ProvisionCategory, accountCode: string, nature: ProvisionNature): MovementAccounts {
  const effective = allowedNatures(category, accountCode).includes(nature) ? nature : defaultNature(category, accountCode)
  if (category === 'RISK_CHARGE') {
    if (effective === 'FINANCIAL') return { dotation: ACC.d6865, reprise: ACC.r7865 }
    if (effective === 'EXCEPTIONAL') return { dotation: ACC.d6875, reprise: ACC.r7875 }
    return { dotation: ACC.d6815, reprise: ACC.r7815 }
  }
  if (effective === 'EXCEPTIONAL') return { dotation: ACC.d6876, reprise: ACC.r7876 }
  switch (category) {
    case 'FIXED_ASSET':
      if (isFinancialAsset(accountCode)) return { dotation: ACC.d68662, reprise: ACC.r78662 }
      return isIntangible(accountCode) ? { dotation: ACC.d68161, reprise: ACC.r78161 } : { dotation: ACC.d68162, reprise: ACC.r78162 }
    case 'INVENTORY':
      return { dotation: ACC.d68173, reprise: ACC.r78173 }
    case 'RECEIVABLE':
      return effective === 'FINANCIAL' ? { dotation: ACC.d6866, reprise: ACC.r7866 } : { dotation: ACC.d68174, reprise: ACC.r78174 }
    case 'SECURITY':
      return { dotation: ACC.d68665, reprise: ACC.r78665 }
  }
}

/** Label of an allowance account offered in the category, or the code. */
export function allowanceAccountLabel(category: ProvisionCategory, code: string): string {
  return ALLOWANCE_ACCOUNTS[category].find((a) => a.code === code)?.label ?? `Compte ${code}`
}

export interface Movement {
  /** Positive: dotation; negative: reprise; 0: nothing to book. */
  cents: number
  /** A reprise was due but the impairment is never reversed (goodwill): it stays. */
  reversalRefused: boolean
}

/**
 * Movement bringing an allowance from `balanceCents` to `requiredCents`
 * (PCG art. 322-1 et seq., 214-15 et seq.): the difference, a dotation when
 * more is required, a reprise when less is. An allowance that is never
 * reversed keeps its balance (PCG art. 214-19).
 */
export function movementTo(requiredCents: number, balanceCents: number, reversible: boolean): Movement {
  const cents = requiredCents - balanceCents
  if (cents < 0 && !reversible) return { cents: 0, reversalRefused: true }
  return { cents, reversalRefused: false }
}

/**
 * Impairment a fixed asset needs at a closing (PCG art. 214-15 et seq.):
 * the excess of its net book value over its current value, never negative.
 */
export function fixedAssetImpairmentCents(netBookValueCents: number, currentValueCents: number): number {
  return Math.max(0, netBookValueCents - currentValueCents)
}

/**
 * Amount excluding tax of a receivable including tax, in cents: the base of
 * its impairment, since the VAT is recovered if it is lost (CGI art. 272,
 * 1). `vatRateBp` in basis points (2000 = 20 %).
 */
export function receivableBaseExclTaxCents(inclTaxCents: number, vatRateBp: number): number {
  if (vatRateBp < 0) throw new RangeError('VAT rate must not be negative')
  return Math.round((inclTaxCents * 10_000) / (10_000 + vatRateBp))
}

/** Share `rateBp` (basis points, 5000 = 50 %) of an amount, in cents, rounded half up. */
export function shareCents(amountCents: number, rateBp: number): number {
  return Math.round((amountCents * rateBp) / 10_000)
}

/** Lines of the entry booking a movement: dotation (debit 68, credit the allowance) or reprise (debit the allowance, credit 78). */
export function movementLines(
  movementCents: number,
  allowance: AccountRef,
  accounts: MovementAccounts,
): Array<{ code: string; label: string; debitCents: number; creditCents: number }> {
  if (movementCents === 0) return []
  const amount = Math.abs(movementCents)
  return movementCents > 0
    ? [
        { code: accounts.dotation.code, label: accounts.dotation.label, debitCents: amount, creditCents: 0 },
        { code: allowance.code, label: allowance.label, debitCents: 0, creditCents: amount },
      ]
    : [
        { code: allowance.code, label: allowance.label, debitCents: amount, creditCents: 0 },
        { code: accounts.reprise.code, label: accounts.reprise.label, debitCents: 0, creditCents: amount },
      ]
}
