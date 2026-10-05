import type { Permission } from '@/lib/rbac/authorize'

/**
 * Rights of the local taxes page (docs/impots-locaux.md), like the corporate
 * tax worksheet:
 * - reading the CFE, the CVAE and their deadlines: reports:read;
 * - exporting the page as a PDF or CSV file: reports:export;
 * - entering the CFE avis, the CVAE adjustments and preparing the CFE
 *   drafts: entries:create (company administrators and accountants).
 */
export const LOCAL_TAXES_READ: Permission = { reports: ['read'] }
export const LOCAL_TAXES_EXPORT: Permission = { reports: ['export'] }
export const LOCAL_TAXES_WRITE: Permission = { entries: ['create'] }
