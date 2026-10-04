import type { Permission } from '@/lib/rbac/authorize'

/**
 * Reading the deadline calendar (page, API and dashboard widget): reading
 * the accounts. Every role has it; the settings behind it are company
 * settings (settings:read, settings:update).
 */
export const DEADLINES_PERMISSION: Permission = { reports: ['read'] }
