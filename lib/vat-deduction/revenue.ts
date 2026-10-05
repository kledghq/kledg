/**
 * Where the revenue of a year comes from, for the coefficient de taxation
 * (CGI ann. II art. 206, III, 3; BOI-TVA-DED-20-10-20). Pure.
 *
 * Each class 7 account of the books is read in this order:
 * 1. a setting of the company on the account or one of its roots (the
 *    longest wins: "7061" before "706"): taxable (opens a right to deduct:
 *    taxed sales, exports and intra-Community supplies, art. 271, V),
 *    exempt (no right to deduct: training of art. 261, 4, 4° a), excluded
 *    (in neither term: §140 and §150, fixed asset disposals, débours,
 *    non-taxable subsidies, accessory financial income);
 * 2. without a setting, an account of turnover (70):
 *    - the revenue of entries that collect VAT (4457, except 44578) is
 *      taxable,
 *    - the lines of sales invoices marked exempt (InvoiceLine.vatExemption)
 *      are exempt,
 *    - the rest (sales without VAT and without an exemption) is "to
 *      classify": counted with the exempt revenue (in the denominator only)
 *      until the user says otherwise, the cautious reading, since an export
 *      wrongly left there lowers the deduction and never raises it;
 * 3. other class 7 accounts (71 to 79): excluded by default, they are not
 *    turnover (subsidies, financial and exceptional income, reversals).
 */

export const VAT_TREATMENTS = ['taxable', 'exempt', 'excluded'] as const
export type VatTreatment = (typeof VAT_TREATMENTS)[number]

export const VAT_TREATMENT_LABELS: Record<VatTreatment, string> = {
  taxable: 'Ouvre droit à déduction',
  exempt: 'Exonérée, sans droit à déduction',
  excluded: 'Exclue du calcul',
}

export interface RevenueAccountRow {
  code: string
  label: string
  /** Credit minus debit of the year (validated entries, opening and closing left out). */
  totalCents: number
  /** Part of it in entries that collect VAT. */
  withVatCents: number
  /** Lines of sales invoices marked exempt posted on this account. */
  exemptInvoiceCents: number
  /** Part of exemptInvoiceCents inside entries that also collect VAT (mixed invoices). */
  exemptInVatEntriesCents: number
}

export interface AccountSetting {
  accountCode: string
  vatTreatment: VatTreatment | null
}

export type RevenueSource = 'setting' | 'books' | 'default-excluded'

export interface ClassifiedAccount {
  code: string
  label: string
  totalCents: number
  /** The setting that applies (its code may be a root of this account). */
  setting: { accountCode: string; treatment: VatTreatment } | null
  source: RevenueSource
  taxableCents: number
  exemptCents: number
  excludedCents: number
  /** Sales without VAT and without an exemption: counted as exempt until classified. */
  toClassifyCents: number
}

export interface RevenueSummary {
  accounts: ClassifiedAccount[]
  taxableCents: number
  exemptCents: number
  excludedCents: number
  toClassifyCents: number
  /** Numerator and denominator of the coefficient de taxation. */
  numeratorCents: number
  denominatorCents: number
}

/** The setting of an account: exact code, else its longest root. */
export function settingFor<T extends { accountCode: string }>(code: string, settings: readonly T[]): T | null {
  let best: T | null = null
  for (const s of settings) {
    if (code.startsWith(s.accountCode) && (!best || s.accountCode.length > best.accountCode.length)) best = s
  }
  return best
}

export function classifyAccount(row: RevenueAccountRow, settings: readonly AccountSetting[]): ClassifiedAccount {
  const total = Math.max(row.totalCents, 0)
  const base = { code: row.code, label: row.label, totalCents: row.totalCents, taxableCents: 0, exemptCents: 0, excludedCents: 0, toClassifyCents: 0 }
  const found = settingFor(row.code, settings.filter((s) => s.vatTreatment !== null))
  if (found && found.vatTreatment) {
    const setting = { accountCode: found.accountCode, treatment: found.vatTreatment }
    const key = found.vatTreatment === 'taxable' ? 'taxableCents' : found.vatTreatment === 'exempt' ? 'exemptCents' : 'excludedCents'
    return { ...base, setting, source: 'setting', [key]: total }
  }
  if (!row.code.startsWith('70')) return { ...base, setting: null, source: 'default-excluded', excludedCents: total }
  const exempt = Math.min(Math.max(row.exemptInvoiceCents, 0), total)
  const taxable = Math.min(Math.max(row.withVatCents - Math.max(row.exemptInVatEntriesCents, 0), 0), total - exempt)
  return { ...base, setting: null, source: 'books', taxableCents: taxable, exemptCents: exempt, toClassifyCents: total - exempt - taxable }
}

export function summarizeRevenue(rows: readonly RevenueAccountRow[], settings: readonly AccountSetting[]): RevenueSummary {
  const accounts = rows.map((row) => classifyAccount(row, settings)).sort((a, b) => a.code.localeCompare(b.code))
  const sum = (key: 'taxableCents' | 'exemptCents' | 'excludedCents' | 'toClassifyCents') => accounts.reduce((s, a) => s + a[key], 0)
  const taxableCents = sum('taxableCents')
  const exemptCents = sum('exemptCents')
  const toClassifyCents = sum('toClassifyCents')
  return {
    accounts,
    taxableCents,
    exemptCents,
    excludedCents: sum('excludedCents'),
    toClassifyCents,
    numeratorCents: taxableCents,
    denominatorCents: taxableCents + exemptCents + toClassifyCents,
  }
}
