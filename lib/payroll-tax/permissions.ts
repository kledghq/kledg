import type { Permission } from '@/lib/rbac/authorize'

/**
 * Rights of the taxe sur les salaires page (docs/organisme-de-formation.md),
 * like the local taxes:
 * - reading it: reports:read;
 * - entering the remunerations and preparing the draft entry:
 *   entries:create (company administrators and accountants).
 */
export const PAYROLL_TAX_READ: Permission = { reports: ['read'] }
export const PAYROLL_TAX_WRITE: Permission = { entries: ['create'] }
