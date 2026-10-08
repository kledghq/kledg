/**
 * Full control tools of the company lifecycle: create_company,
 * archive_company and restore_company. All high impact: the execution mode
 * of the connection applies (approval in Kledg in validation mode).
 *
 * - create_company does what POST /api/companies does: the instance policy
 *   first (assertCompanyCreationAllowed: instance administrators in Kledg, a
 *   fork's rules and plan limits otherwise), the wizard's schema
 *   (CreateCompanySchema, same French messages), the same service
 *   (createCompany) with the instance hook afterCompanyCreated (a failure
 *   removes the company), and the CREATE_COMPANY audit entry. A user who is
 *   not an instance administrator becomes the company's administrator. It
 *   acts outside any company (registerInstanceTool): only a connection
 *   granted every company of the user may call it, so the new company is in
 *   its grant from the start; a grant limited to some companies is never
 *   widened by an assistant (lib/ai-access/manage-grants.service.ts).
 * - archive_company and restore_company do what POST and DELETE
 *   /api/companies/[id]/archive do: instance administrators only, the
 *   'delete-company' instance action for the archiving, then
 *   lib/companies/archive-company.service.ts (idempotent, audited). The
 *   company must be in the connection's grant. An archived company stays
 *   readable (list_companies with includeArchived).
 * - Deleting a company (DELETE /api/companies/[id]) stays out of the server:
 *   the books are kept 10 years (route-coverage.ts, companyDeletion).
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { writeAuditLog } from '@/lib/audit'
import { ConflictError, NotFoundError } from '@/lib/accounting/errors'
import { COMPANY_NOT_FOUND_MESSAGE } from '@/lib/rbac/authorize'
import { afterCompanyCreated, assertActionAllowed, assertCompanyCreationAllowed, type InstanceActor } from '@/lib/instance'
import { CORPORATE_TAX_REGIMES, CreateCompanySchema, VAT_REGIMES, checkFirstFiscalYear, shareCapitalCents, type CreateCompanyData } from '@/lib/companies/company-wizard'
import { LEGAL_TYPES } from '@/lib/companies/legal-forms'
import { createCompany, sirenTakenMessage } from '@/lib/companies/create-company.service'
import { legalIdentifierTaken } from '@/lib/companies/identifiers'
import { archiveCompany, restoreCompany } from '@/lib/companies/archive-company.service'
import { centsFromEuros, eurosInput, kledgPageUrl } from '@/lib/mcp/tool-meta'
import type { McpAccess } from '@/lib/mcp/company-access'
import { fromCents } from '@/lib/utils/money'
import { fullControlTool, instanceTool, type RegisterTool } from './define'
import { ACTS_AS_USER, TWO_STEP } from './descriptions'
import { companyLock } from './fingerprint'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format attendu : AAAA-MM-JJ')
const text = (max: number) => z.string().max(max)

const createInput = {
  name: text(200).describe('Name of the company (dénomination).'),
  siren: text(20).describe('SIREN, 9 digits; lookup_siren prefills the rest.'),
  legalType: z.enum(LEGAL_TYPES).optional().nullable(),
  activityCode: text(10).optional().describe('NAF (APE) code, e.g. 62.01Z.'),
  foundationDate: day.optional().nullable().describe('Creation date of the company.'),
  email: text(200).optional(),
  phone: text(30).optional(),
  headOffice: z
    .object({
      siret: text(20).optional(),
      street: text(200).optional(),
      street2: text(200).optional(),
      postalCode: text(10).optional(),
      city: text(100).optional(),
    })
    .optional()
    .nullable()
    .describe('Head office: SIRET and address.'),
  firstFiscalYear: z
    .object({
      startDate: day,
      endDate: day,
      isFirst: z.boolean().describe("true for the company's very first exercice (1 to 24 months)."),
    })
    .describe('The first fiscal year kept in Kledg.'),
  vatRegime: z.enum(VAT_REGIMES),
  corporateTaxRegime: z.enum(CORPORATE_TAX_REGIMES).nullable().describe('null for a company at the impôt sur le revenu.'),
  includeOptionalAccounts: z.boolean().optional().describe('Also create the optional accounts of the PCG.'),
  totalShares: z.number().int().optional().nullable().describe('Number of shares of the capital.'),
  shareNominalValue: eurosInput.optional().nullable().describe('Nominal value of one share, in euros.'),
  shareholders: z
    .array(
      z.object({
        type: z.enum(['PHYSICAL', 'LEGAL']),
        firstName: text(100).optional().describe('PHYSICAL only.'),
        name: text(200).describe('Last name of a person, or name of a legal entity.'),
        numberOfShares: z.number().int(),
      }),
    )
    .max(200)
    .optional(),
}

type CreateArgs = z.infer<z.ZodObject<typeof createInput>>

const actorOf = (access: McpAccess): InstanceActor => ({ id: access.user.id, email: access.user.email, role: access.user.role })

/** The policy, then the wizard's validation (same messages as the route), then the SIREN. */
async function prepareCreation(args: CreateArgs, access: McpAccess): Promise<CreateCompanyData> {
  await assertCompanyCreationAllowed(actorOf(access))
  const { shareNominalValue, ...rest } = args
  const data = CreateCompanySchema.parse({
    ...rest,
    shareNominalValueCents: shareNominalValue === undefined || shareNominalValue === null ? shareNominalValue : centsFromEuros(shareNominalValue, 'Valeur nominale'),
  })
  if (await legalIdentifierTaken('siren', data.siren, { companyId: null, actor: actorOf(access) })) {
    throw new ConflictError(sirenTakenMessage(data.siren))
  }
  return data
}

const createCompanyTool = instanceTool({
  name: 'create_company',
  title: 'Créer une société',
  description: `Creates a company like the creation wizard of Kledg: identity, head office, first fiscal year and tax regimes, capital and shareholders; Kledg then creates its members (the user becomes its administrator unless an instance administrator), default journals, first fiscal year and chart of accounts (PCG). Only who the instance lets create companies (instance administrators in Kledg), and only through a connection granted every company of the user: the new company is then in the grant at once. The dry run gives the company as it will be created and the warnings on the first fiscal year. ${ACTS_AS_USER} ${TWO_STEP}`,
  input: createInput,
  permission: 'company-creation',
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd.',
  never: 'creates a company with a SIREN already used, bypasses the instance policy, or deletes anything.',
  async preview(args, access) {
    const data = await prepareCreation(args, access)
    const check = checkFirstFiscalYear({
      startDate: data.firstFiscalYear.startDate,
      endDate: data.firstFiscalYear.endDate,
      isFirst: data.firstFiscalYear.isFirst,
      subjectToCorporateTax: data.corporateTaxRegime !== null,
      foundationDate: data.foundationDate,
    })
    const capital = shareCapitalCents(data.totalShares, data.shareNominalValueCents)
    return {
      company: { name: data.name, siren: data.siren, legalType: data.legalType ?? null, activityCode: data.activityCode ?? null, foundationDate: data.foundationDate ?? null },
      headOffice: data.headOffice ?? null,
      firstFiscalYear: { ...data.firstFiscalYear, months: check.months },
      vatRegime: data.vatRegime,
      corporateTaxRegime: data.corporateTaxRegime,
      capital: capital === null ? null : fromCents(capital),
      shareholders: data.shareholders,
      warnings: check.warnings,
      creatorBecomesAdministrator: access.user.role !== 'admin',
    }
  },
  async execute(args, access) {
    const data = await prepareCreation(args, access)
    const actor = actorOf(access)
    // The instance hook runs before the company is kept: a failure removes it (KLEDG-SEC-012).
    const company = await createCompany(data, actor, { afterCreated: (companyId) => afterCompanyCreated(companyId, actor) })
    await writeAuditLog('info', 'Company created', {
      action: 'CREATE_COMPANY',
      companyId: company.id,
      metadata: { userId: access.user.id, fiscalYearId: company.fiscalYearId, source: 'mcp' },
    })
    return { companyId: company.id, slug: company.slug, name: company.name, fiscalYearId: company.fiscalYearId, url: kledgPageUrl(company.id, 'dashboard') }
  },
  audit: (args, result) => ({ companyId: result.companyId, ids: { companyId: result.companyId, siren: args.siren, fiscalYearId: result.fiscalYearId } }),
})

/** The company as the dry runs of archive and restore show it. */
async function companySummary(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, siren: true, archivedAt: true } })
  if (!company) throw new NotFoundError(COMPANY_NOT_FOUND_MESSAGE)
  return { id: company.id, name: company.name, siren: company.siren, archived: company.archivedAt !== null, archivedAt: company.archivedAt?.toISOString() ?? null }
}

// Read only right: an archived company must stay reachable to be restored
// (the guard refuses writes on it); the instance administrator check is the
// rule of the routes (adminRoute).
const COMPANY_READ = { settings: ['read'] } as const

const archiveCompanyTool = fullControlTool({
  name: 'archive_company',
  title: 'Archiver une société',
  description: `Archives a company, like the Sociétés page: it becomes read-only (every write of Kledg and of the assistants answers 409) and is hidden from the lists; its books are kept, nothing is deleted, and restore_company reverses it. Instance administrators only, like the page. Archiving an archived company changes nothing. ${ACTS_AS_USER} ${TWO_STEP}`,
  input: {},
  permission: COMPANY_READ,
  amounts: 'none',
  never: 'deletes a company, an entry or a fiscal year.',
  targetState: ({ companyId }) => [companyLock(companyId)],
  confirmation: true,
  idempotent: true,
  async preview({ companyId }, ctx) {
    ctx.requireInstanceAdministrator()
    await assertActionAllowed('delete-company', actorOf(ctx.access))
    const company = await companySummary(companyId)
    return { company, effect: company.archived ? 'Déjà archivée : rien ne change.' : 'La société passera en lecture seule et sera masquée des listes.' }
  },
  async execute({ companyId }, ctx) {
    ctx.requireInstanceAdministrator()
    await assertActionAllowed('delete-company', actorOf(ctx.access))
    return archiveCompany(companyId, ctx.access.user)
  },
  audit: ({ companyId }) => ({ companyId }),
})

const restoreCompanyTool = fullControlTool({
  name: 'restore_company',
  title: 'Restaurer une société archivée',
  description: `Restores an archived company, like the Sociétés page: it can be changed again and comes back in the lists. Instance administrators only, like the page. Archived companies: list_companies with includeArchived. Restoring a company that is not archived changes nothing. ${ACTS_AS_USER} ${TWO_STEP}`,
  input: {},
  permission: COMPANY_READ,
  amounts: 'none',
  never: 'changes the books of the company.',
  targetState: ({ companyId }) => [companyLock(companyId)],
  confirmation: true,
  idempotent: true,
  async preview({ companyId }, ctx) {
    ctx.requireInstanceAdministrator()
    const company = await companySummary(companyId)
    return { company, effect: company.archived ? 'La société pourra de nouveau être modifiée et reviendra dans les listes.' : "La société n'est pas archivée : rien ne change." }
  },
  async execute({ companyId }, ctx) {
    ctx.requireInstanceAdministrator()
    return restoreCompany(companyId, ctx.access.user)
  },
  audit: ({ companyId }) => ({ companyId }),
})

export function registerCompanyTools(register: RegisterTool) {
  register(archiveCompanyTool)
  register(restoreCompanyTool)
}

export { createCompanyTool }
