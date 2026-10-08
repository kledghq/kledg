import type { Permission } from '@/lib/rbac/authorize'

/**
 * Rights of the coefficient de déduction page (docs/organisme-de-formation.md),
 * like the VAT return worksheet:
 * - reading the coefficients and the revenue they come from: reports:read;
 * - changing the settings (partial deduction, estimate, coefficient
 *   d'assujettissement, VAT borne, treatment of revenue accounts) and
 *   preparing the regularisation draft: entries:create (company
 *   administrators and accountants).
 *
 * `companies.partialVatDeduction` is written with entries:create, not
 * settings:update, on purpose (KLEDG-R3-AUTHZ-07): it is not an identity
 * setting of the company but the switch of the coefficient de déduction of
 * the VAT computation (CGI ann. II art. 205 to 207, sources of load-vat-deduction.service.ts), kept by the
 * accountant together with the coefficients of each year, like the VAT
 * return. The accountant role has no settings:update; asking for it would
 * take the page away from the person who prepares the VAT.
 */
export const VAT_DEDUCTION_READ: Permission = { reports: ['read'] }
export const VAT_DEDUCTION_WRITE: Permission = { entries: ['create'] }
