/**
 * Read tool of the company directory: lookup_siren, the prefill of the
 * company creation (GET /api/companies/lookup). Same rule as the route:
 * whoever may create a company (the instance policy, companyCreationRefusal,
 * lib/instance/policy.ts: instance administrators in Kledg), rate limited
 * per user, and only the public directory recherche-entreprises.api.gouv.fr
 * is called with the 9 digits (lib/companies/lookup-siren.service.ts). It
 * answers found, not_found or unavailable, never an error for the directory.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { McpAccess } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool } from '@/lib/mcp/tool-meta'
import { assertCompanyCreationAllowed } from '@/lib/instance'
import { lookupSiren } from '@/lib/companies/lookup-siren.service'
import { normalizeSiren } from '@/lib/companies/siren-lookup'
import { enforceRateLimit } from '@/lib/rate-limit'
import { ValidationError } from '@/lib/accounting/errors'

const SIREN_MESSAGE = 'Le SIREN compte exactement 9 chiffres.'

export function registerCompanyLookupTools(server: McpServer, access: McpAccess) {
  server.registerTool(
    'lookup_siren',
    {
      title: 'Rechercher une entreprise par SIREN',
      description: describeTool({
        summary:
          'Looks a SIREN up in the public company directory (recherche-entreprises.api.gouv.fr) to prepare create_company: name, legal form, activity code, creation date, head office (SIRET and address), and whether the company is closed. status found, not_found, or unavailable when the directory does not answer (then ask the user).',
        access: 'read',
        permission: 'company-creation',
        amounts: 'none',
        units: 'Dates as yyyy-mm-dd.',
        never: 'sends anything but the 9 digits to the directory, creates a company, or changes anything (read only).',
      }),
      inputSchema: z.object({ siren: z.string().max(20).describe('The SIREN, 9 digits (spaces allowed).') }),
      annotations: { ...READ_ONLY, openWorldHint: true },
    },
    ({ siren }) =>
      run(async () => {
        const normalized = normalizeSiren(siren)
        if (!normalized) throw new ValidationError(SIREN_MESSAGE)
        await assertCompanyCreationAllowed({ id: access.user.id, email: access.user.email, role: access.user.role })
        await enforceRateLimit('siren-lookup', access.user.id)
        return json(await lookupSiren(normalized))
      }),
  )
}
