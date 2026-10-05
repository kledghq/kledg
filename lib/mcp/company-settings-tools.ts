/**
 * Read tools of the company settings (kledg:read and settings:read, like
 * the GET routes of app/api/companies/[id]/**): the company card,
 * establishments, members, persons, shareholders, payment terms, VAT and
 * simple mode options, deadline calendar settings, tax regimes, addresses,
 * and the layout of the balance sheet and the income statement. Changes go
 * through update_company_settings, manage_company_records and
 * manage_statement_layout (full control). Logos and photos (data URLs) are
 * left out: the assistant gets whether there is one.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool } from '@/lib/mcp/tool-meta'
import { forAssistant } from '@/lib/mcp/euros'
import { parseInput } from '@/lib/api/zod-fields'
import { ValidationError } from '@/lib/accounting/errors'
import { getCompanyById } from '@/lib/companies/manage-company.service'
import { listOrInitializeEstablishments } from '@/lib/companies/manage-establishments.service'
import { listMembers } from '@/lib/rbac/manage-members.service'
import { exportCompanyPerson, listCompanyPersons } from '@/lib/companies/manage-persons.service'
import { listShareholders } from '@/lib/companies/manage-shareholders.service'
import { getPaymentTerms } from '@/lib/companies/payment-terms.service'
import { getVatSettings } from '@/lib/companies/vat-settings.service'
import { getInvoiceNumbering } from '@/lib/invoices/numbering/manage-numbering-settings.service'
import { getSimpleModeSettings } from '@/lib/simple/simple-mode-settings.service'
import { getDeadlineSettings } from '@/lib/deadlines/deadline-settings.service'
import { getTaxRegimeHistory } from '@/lib/companies/tax-regimes'
import { SearchAddressesQuerySchema, getCompanyAddress, searchCompanyAddresses } from '@/lib/addresses/manage-addresses.service'
import { getBalanceSheetConfig } from '@/lib/reports/balance-sheet/config/get-balance-sheet-config.service'
import { getIncomeStatementConfig } from '@/lib/reports/income-statement/config/get-income-statement-config.service'
import { listBalanceSheetTemplates } from '@/lib/reports/balance-sheet/config/manage-templates.service'
import { getBalanceSheetLine, getIncomeStatementLine, readBalanceSheetLineHistory } from '@/lib/reports/config/manage-layouts.service'
import { ConfigHistoryQuerySchema } from '@/lib/reports/config/schemas'

const companyId = z.string().describe('Company id, from list_companies.')

/** Image fields replaced by whether they are set (data URLs of up to 2 MB). */
const IMAGE_FIELDS = new Set(['logo', 'photo'])

function withoutImages(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutImages)
  if (!value || typeof value !== 'object' || value instanceof Date) return value
  const out: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    if (IMAGE_FIELDS.has(key)) out[`has${key[0].toUpperCase()}${key.slice(1)}`] = Boolean(field)
    else out[key] = withoutImages(field)
  }
  return out
}

const SECTIONS = ['company', 'establishments', 'members', 'persons', 'person', 'shareholders', 'payment_terms', 'vat_settings', 'simple_mode', 'deadline_settings', 'invoice_numbering', 'tax_regimes', 'addresses'] as const

export function registerCompanySettingsTools(server: McpServer, guard: CompanyGuard) {
  server.registerTool(
    'get_company_settings',
    {
      title: 'Paramètres de la société',
      description: describeTool({
        summary:
          'Returns one section of the company settings: company (identity, SIREN, legal form, closing date, regimes, capital, fiscal years), establishments (SIRET, addresses, the main one first), members (users and roles), persons (who may be a shareholder), person (with personId: every data held on one person and its links, shareholdings and expense claimants, RGPD art. 15 and 20), shareholders (capital table), payment_terms (used by the aged balance), vat_settings (VAT on debits, franchise), simple_mode (whether simple mode entries wait for the accountant), deadline_settings (deadline calendar options), invoice_numbering (numbering of sales invoices: format, reset, credit note series, the next numbers, whether invoices are created in Qonto first and why Qonto refused it), tax_regimes (VAT and corporate tax regime history, regimeType to narrow), addresses (search with at least 2 characters, or one addressId).',
        access: 'read',
        permission: { settings: ['read'] },
        amounts: 'euros',
        units: 'Dates as yyyy-mm-dd, percentages of capital in percent.',
        never: 'changes a setting (read only).',
      }),
      inputSchema: z.object({
        companyId,
        section: z.enum(SECTIONS),
        regimeType: z.enum(['vat', 'corporateTax']).optional().describe('tax_regimes: one type only.'),
        search: z.string().max(200).optional().describe('addresses: postal code, city or street.'),
        addressId: z.string().max(64).optional().describe('addresses: one address of the company.'),
        personId: z.string().max(64).optional().describe('person: from section persons.'),
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { settings: ['read'] })
        const id = args.companyId
        const load: Record<(typeof SECTIONS)[number], () => Promise<unknown>> = {
          company: () => getCompanyById(id),
          establishments: () => listOrInitializeEstablishments(id),
          members: () => listMembers(id),
          persons: () => listCompanyPersons(id),
          person: () => {
            if (!args.personId) throw new ValidationError('personId est requis pour cette section.')
            return exportCompanyPerson(id, args.personId)
          },
          shareholders: () => listShareholders(id),
          payment_terms: () => getPaymentTerms(id),
          vat_settings: () => getVatSettings(id),
          simple_mode: () => getSimpleModeSettings(id),
          deadline_settings: () => getDeadlineSettings(id),
          invoice_numbering: () => getInvoiceNumbering(id),
          tax_regimes: () => getTaxRegimeHistory(id, args.regimeType),
          addresses: () =>
            args.addressId ? getCompanyAddress(id, args.addressId) : searchCompanyAddresses(id, parseInput(SearchAddressesQuerySchema, { search: args.search })),
        }
        return json(forAssistant(withoutImages(await load[args.section]())))
      }),
  )

  server.registerTool(
    'get_statement_layout',
    {
      title: 'Mise en page des états',
      description: describeTool({
        summary:
          'Returns the layout of the balance sheet or of the income statement (variant complete or simplified): its lines with their accounts, sense and order (view layout, created from the PCG default the first time), one line (view line with lineId), the history of a balance sheet line (view history with lineId, and version, or version1 and version2 to compare), or the balance sheet templates (view templates). Change it with manage_statement_layout (full control).',
        access: 'read',
        permission: { settings: ['read'] },
        amounts: 'none',
        never: 'changes the layout or the statements (read only).',
      }),
      inputSchema: z.object({
        companyId,
        statement: z.enum(['balance_sheet', 'income_statement']),
        view: z.enum(['layout', 'line', 'history', 'templates']).default('layout'),
        variant: z.enum(['complete', 'simplified']).default('complete'),
        lineId: z.string().max(64).optional(),
        version: z.number().int().optional(),
        version1: z.number().int().optional(),
        version2: z.number().int().optional(),
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { settings: ['read'] })
        const id = args.companyId
        const balanceSheet = args.statement === 'balance_sheet'
        if (args.view === 'layout') {
          return json(forAssistant(balanceSheet ? await getBalanceSheetConfig(id, args.variant) : await getIncomeStatementConfig(id, args.variant)))
        }
        if (args.view === 'templates') {
          if (!balanceSheet) throw new ValidationError('Les modèles existent pour le bilan seulement.')
          return json(forAssistant(await listBalanceSheetTemplates(id, args.variant)))
        }
        if (!args.lineId) throw new ValidationError('lineId est requis pour cette vue.')
        if (args.view === 'line') {
          return json(forAssistant(balanceSheet ? await getBalanceSheetLine(id, args.lineId) : await getIncomeStatementLine(id, args.lineId)))
        }
        if (!balanceSheet) throw new ValidationError("L'historique existe pour le bilan seulement.")
        const query = parseInput(ConfigHistoryQuerySchema, { configId: args.lineId, version: args.version, version1: args.version1, version2: args.version2 })
        return json(forAssistant(await readBalanceSheetLineHistory(id, query)))
      }),
  )
}
