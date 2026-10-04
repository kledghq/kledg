import type { Permission } from '@/lib/rbac/authorize'

/**
 * Rights of the VAT return worksheet (docs/declarations-tva.md), like the
 * reports and the entries they come from:
 * - reading the worksheet: reports:read (every role);
 * - exporting it as a PDF or CSV file: reports:export;
 * - preparing the settlement draft and recording a filing: entries:create
 *   (company administrators and accountants).
 */
export const VAT_RETURN_READ: Permission = { reports: ['read'] }
export const VAT_RETURN_EXPORT: Permission = { reports: ['export'] }
export const VAT_RETURN_WRITE: Permission = { entries: ['create'] }
