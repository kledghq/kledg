/**
 * Rules on the fields of a tiers, on plain values. Pure module without
 * imports: the tiers form and the server share it.
 *
 * - Auxiliary account number (FEC CompAuxNum, LPF art. A47 A-1): letters,
 *   digits, "-", "_" and ".", 17 characters at most (the length most
 *   accounting software reads), stored in uppercase.
 * - Collective account: a customer posts to 41 (411 Clients), a supplier to
 *   40 (401 Fournisseurs, 404 for fixed asset suppliers), PCG art. 932-1.
 * - Default line account: expenses (class 6) or fixed assets (class 2) for a
 *   supplier, revenue (class 7) for a customer.
 */

export type TiersKindValue = 'CUSTOMER' | 'SUPPLIER'

export const TIERS_KIND_LABELS: Record<TiersKindValue, string> = { CUSTOMER: 'Client', SUPPLIER: 'Fournisseur' }
export const TIERS_KIND_PLURALS: Record<TiersKindValue, string> = { CUSTOMER: 'Clients', SUPPLIER: 'Fournisseurs' }

/** Collective account used when the tiers names none (resolved in the fiscal year: 411, 411000...). */
export const DEFAULT_COLLECTIVE: Record<TiersKindValue, string> = { CUSTOMER: '411', SUPPLIER: '401' }

export function normalizeAuxiliaryNumber(value: string): string {
  return value.trim().toUpperCase()
}

export function auxiliaryNumberError(value: string): string | null {
  if (!/^[A-Z0-9._-]{1,17}$/.test(value)) {
    return 'Le compte auxiliaire compte 17 caractères au plus : lettres, chiffres, tiret, point ou souligné (ex. C00012, DUPONT).'
  }
  return null
}

/** Why an account code does not fit this kind of tiers, null when it does. */
export function accountCodeError(kind: TiersKindValue, role: 'collective' | 'line', code: string): string | null {
  if (!/^[0-9][0-9A-Z]{1,19}$/.test(code)) return `Le compte ${code} n'est pas un numéro de compte valide.`
  if (role === 'collective') {
    const prefix = kind === 'CUSTOMER' ? '41' : '40'
    return code.startsWith(prefix)
      ? null
      : `Le compte collectif d'un ${kind === 'CUSTOMER' ? 'client' : 'fournisseur'} commence par ${prefix} (ex. ${DEFAULT_COLLECTIVE[kind]}).`
  }
  if (kind === 'CUSTOMER') return code.startsWith('7') ? null : 'Le compte de vente d’un client est un compte de produits (classe 7, ex. 706).'
  return code.startsWith('6') || code.startsWith('2')
    ? null
    : 'Le compte d’achat d’un fournisseur est un compte de charges (classe 6, ex. 6064) ou d’immobilisations (classe 2).'
}
