import type { Permission } from '@/lib/rbac/authorize'

/**
 * Rights of the impôt sur les sociétés worksheet (docs/impot-societes.md),
 * like the reports and the entries it comes from:
 * - reading the worksheet: reports:read (every role);
 * - exporting it as a PDF or CSV file: reports:export;
 * - saving the answers, deficits, manual lines and acomptes paid, recording
 *   a filing and preparing the draft entries: entries:create (company
 *   administrators and accountants).
 */
export const CORPORATE_TAX_READ: Permission = { reports: ['read'] }
export const CORPORATE_TAX_EXPORT: Permission = { reports: ['export'] }
export const CORPORATE_TAX_WRITE: Permission = { entries: ['create'] }
