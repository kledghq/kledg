import type { Permission } from '@/lib/rbac/authorize'

/**
 * Rights of the declarations tracker (docs/echeances.md), like the VAT and
 * corporate tax filing records it sits next to:
 * - reading the statuses (calendar, simple home, MCP): reports:read;
 * - marking a deadline filed, paid or not due: entries:create (company
 *   administrators and accountants).
 */
export const DECLARATIONS_READ: Permission = { reports: ['read'] }
export const DECLARATIONS_WRITE: Permission = { entries: ['create'] }
