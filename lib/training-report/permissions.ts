import type { Permission } from '@/lib/rbac/authorize'

/**
 * Rights of the bilan pédagogique et financier (docs/organisme-de-formation.md):
 * - reading it: reports:read;
 * - exporting it: reports:export;
 * - entering the frames and assigning the origins of revenue (accounts and
 *   customers): entries:create (company administrators and accountants).
 */
export const TRAINING_REPORT_READ: Permission = { reports: ['read'] }
export const TRAINING_REPORT_EXPORT: Permission = { reports: ['export'] }
export const TRAINING_REPORT_WRITE: Permission = { entries: ['create'] }
