import type { Permission } from '@/lib/rbac/authorize'

/**
 * Rights of the coefficient de déduction page (docs/organisme-de-formation.md),
 * like the VAT return worksheet:
 * - reading the coefficients and the revenue they come from: reports:read;
 * - changing the settings (partial deduction, estimate, coefficient
 *   d'assujettissement, VAT borne, treatment of revenue accounts) and
 *   preparing the regularisation draft: entries:create (company
 *   administrators and accountants).
 */
export const VAT_DEDUCTION_READ: Permission = { reports: ['read'] }
export const VAT_DEDUCTION_WRITE: Permission = { entries: ['create'] }
