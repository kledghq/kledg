import type { Permission } from '@/lib/rbac/authorize'

/**
 * Rights of the "Rémunération et dividendes" simulator
 * (docs/remuneration-dividendes.md), like the statements it reads and the
 * approval of the accounts it feeds:
 * - reading the simulation: reports:read (every role);
 * - exporting it as a PDF or CSV file: reports:export;
 * - saving or deleting a scenario, proposing its dividends in the approval
 *   of the accounts: closing:execute (company administrators and
 *   accountants), the right of the approval pack.
 */
export const REMUNERATION_READ: Permission = { reports: ['read'] }
export const REMUNERATION_EXPORT: Permission = { reports: ['export'] }
export const REMUNERATION_WRITE: Permission = { closing: ['execute'] }
