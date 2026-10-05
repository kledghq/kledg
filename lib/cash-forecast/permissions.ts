import type { Permission } from '@/lib/rbac/authorize'

/**
 * Reading the cash forecast (page, API, alert cards, MCP): it starts from
 * the bank balances and the recurring bank payments (banking:read) and adds
 * the open invoices and tax deadlines of the books (reports:read). Every
 * role has both. Its settings are company settings (settings:read,
 * settings:update).
 */
export const CASH_FORECAST_PERMISSION: Permission = { reports: ['read'], banking: ['read'] }
