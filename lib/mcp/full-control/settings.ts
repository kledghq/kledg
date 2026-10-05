/**
 * Full control tools on the company settings (settings:update, like the
 * routes of app/api/companies/[id]/**): the company card and its options,
 * establishments, persons, shareholders, tax regimes and addresses, the
 * layout of the balance sheet and of the income statement; and the members
 * of the company (instance administrators only, like their adminRoute).
 * Every change of settings is high impact: it follows the execution mode
 * of the connection (approval in Kledg in validation mode).
 */

import { z } from 'zod'
import { ValidationError } from '@/lib/accounting/errors'
import { writeAuditLog } from '@/lib/audit'
import { assertActionAllowed } from '@/lib/instance'
import { assistantInput, forAssistant, routeBody } from '@/lib/mcp/euros'
import { UpdateCompanySchema, getCompanyById, updateCompany } from '@/lib/companies/manage-company.service'
import { PaymentTermsBodySchema, getPaymentTerms, updatePaymentTerms } from '@/lib/companies/payment-terms.service'
import { VatSettingsBodySchema, getVatSettings, updateVatSettings } from '@/lib/companies/vat-settings.service'
import { InvoiceNumberingBodySchema } from '@/lib/invoices/numbering/settings'
import { getInvoiceNumbering, updateInvoiceNumbering } from '@/lib/invoices/numbering/manage-numbering-settings.service'
import { SimpleModeSettingsBodySchema, getSimpleModeSettings, updateSimpleModeSettings } from '@/lib/simple/simple-mode-settings.service'
import { DeadlineSettingsBody } from '@/lib/deadlines/settings'
import { getDeadlineSettings, saveDeadlineSettings } from '@/lib/deadlines/deadline-settings.service'
import {
  CreateEstablishmentSchema,
  UpdateEstablishmentSchema,
  createEstablishment,
  deactivateEstablishment,
  updateEstablishment,
} from '@/lib/companies/manage-establishments.service'
import { CreatePersonSchema, UpdatePersonSchema, createCompanyPerson, eraseCompanyPerson, updateCompanyPerson } from '@/lib/companies/manage-persons.service'
import { CreateShareholderSchema, UpdateShareholderSchema, createShareholder, deleteShareholder, updateShareholder } from '@/lib/companies/manage-shareholders.service'
import { AddTaxRegimeSchema, UpdateTaxRegimeSchema, addTaxRegime, deleteTaxRegime, updateTaxRegime } from '@/lib/companies/tax-regimes'
import { CreateAddressSchema, createCompanyAddress } from '@/lib/addresses/manage-addresses.service'
import {
  createBalanceSheetLine,
  createIncomeStatementLine,
  deleteBalanceSheetLine,
  deleteIncomeStatementLine,
  getBalanceSheetLine,
  getIncomeStatementLine,
  resetBalanceSheetLayout,
  resetIncomeStatementLayout,
  runBalanceSheetConfigAction,
  runBalanceSheetHistoryAction,
  runBalanceSheetTemplateAction,
  updateBalanceSheetLine,
  updateIncomeStatementLine,
} from '@/lib/reports/config/manage-layouts.service'
import {
  ConfigHistoryActionSchema,
  CreateBalanceSheetLineSchema,
  CreateIncomeStatementLineSchema,
  TemplateActionSchema,
  UpdateBalanceSheetLineSchema,
  UpdateIncomeStatementLineSchema,
} from '@/lib/reports/config/schemas'
import { COMPANY_ROLES, addMemberToCompany } from '@/lib/rbac/add-member-to-company.service'
import { listMembers, removeMember, updateMemberRole } from '@/lib/rbac/manage-members.service'
import { fullControlTool, type RegisterTool } from './define'
import { ACTS_AS_USER, TWO_STEP } from './descriptions'

const SETTINGS_SECTIONS = ['company', 'payment_terms', 'vat_settings', 'simple_mode', 'deadline_settings', 'invoice_numbering'] as const

const updateCompanySettingsTool = fullControlTool({
  name: 'update_company_settings',
  title: 'Modifier les paramètres de la société',
  description: `Changes one section of the company settings, like the Informations page: company (the fields given of the company card: name, SIREN, legal form, closing day and month, regimes, VAT exemption, shares and nominal value, contact, sector, holding, default bank account, color, logo as a data URL), payment_terms (days and end of month, capped by Code de commerce art. L441-10), vat_settings (VAT on debits for services, CGI art. 269), simple_mode (accountantReview: whether simple mode entries wait for the accountant; null for the default), deadline_settings (options of the deadline calendar), invoice_numbering (numbering of sales invoices: settings with mode AUTO or MANUAL, prefix, year YYYY, YY or NONE, month, separator, padding, reset YEARLY, FISCAL_YEAR or NEVER, credit notes in the same series or their own with creditNotePrefix, qontoFirst true, false or null for the default; optional nextNumbers.invoice or nextNumbers.creditNote to resume the series of the current period after another tool, only upward). Read them with get_company_settings. ${ACTS_AS_USER} ${TWO_STEP}`,
  input: {
    section: z.enum(SETTINGS_SECTIONS),
    company: assistantInput(UpdateCompanySchema).optional(),
    paymentTerms: assistantInput(PaymentTermsBodySchema).optional(),
    vatSettings: assistantInput(VatSettingsBodySchema).optional(),
    simpleMode: assistantInput(SimpleModeSettingsBodySchema).optional(),
    deadlineSettings: assistantInput(DeadlineSettingsBody).optional(),
    invoiceNumbering: assistantInput(InvoiceNumberingBodySchema).optional(),
  },
  permission: { settings: ['update'] },
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd, payment terms in days.',
  never: 'deletes the company, changes its members or touches the books.',
  confirmation: true,
  destructive: true,
  idempotent: true,
  async preview({ companyId, section, ...values }) {
    const current: Record<(typeof SETTINGS_SECTIONS)[number], () => Promise<unknown>> = {
      company: async () => {
        const { logo, ...company } = (await getCompanyById(companyId)) as Record<string, unknown>
        return { ...company, hasLogo: Boolean(logo) }
      },
      payment_terms: () => getPaymentTerms(companyId),
      vat_settings: () => getVatSettings(companyId),
      simple_mode: () => getSimpleModeSettings(companyId),
      deadline_settings: () => getDeadlineSettings(companyId),
      invoice_numbering: () => getInvoiceNumbering(companyId),
    }
    const requested = {
      company: values.company,
      payment_terms: values.paymentTerms,
      vat_settings: values.vatSettings,
      simple_mode: values.simpleMode,
      deadline_settings: values.deadlineSettings,
      invoice_numbering: values.invoiceNumbering,
    }[section]
    return { section, current: forAssistant(await current[section]()), requested }
  },
  async execute({ companyId, section, company, paymentTerms, vatSettings, simpleMode, deadlineSettings, invoiceNumbering }) {
    switch (section) {
      case 'company': {
        const { logo, ...updated } = (await updateCompany(companyId, routeBody(UpdateCompanySchema, company ?? {}))) as Record<string, unknown>
        return { section, company: forAssistant({ ...updated, hasLogo: Boolean(logo) }) }
      }
      case 'payment_terms':
        return { section, paymentTerms: await updatePaymentTerms(companyId, routeBody(PaymentTermsBodySchema, paymentTerms ?? {})) }
      case 'vat_settings':
        return { section, vatSettings: await updateVatSettings(companyId, routeBody(VatSettingsBodySchema, vatSettings ?? {})) }
      case 'simple_mode': {
        const body = routeBody(SimpleModeSettingsBodySchema, simpleMode ?? {})
        const settings = await updateSimpleModeSettings(companyId, body)
        await writeAuditLog('info', 'Simple mode accountant review setting changed', {
          action: 'UPDATE_SIMPLE_MODE_SETTINGS',
          companyId,
          metadata: { accountantReview: body.accountantReview, source: 'mcp' },
        })
        return { section, simpleMode: settings }
      }
      case 'deadline_settings':
        return { section, deadlineSettings: forAssistant(await saveDeadlineSettings(companyId, routeBody(DeadlineSettingsBody, deadlineSettings ?? {}))) }
      case 'invoice_numbering':
        return { section, invoiceNumbering: await updateInvoiceNumbering(companyId, routeBody(InvoiceNumberingBodySchema, invoiceNumbering ?? {}), { source: 'mcp' }) }
    }
  },
  audit: ({ section }) => ({ section }),
})

const RECORD_ACTIONS = [
  'create_establishment',
  'update_establishment',
  'deactivate_establishment',
  'create_person',
  'update_person',
  'erase_person',
  'create_shareholder',
  'update_shareholder',
  'delete_shareholder',
  'add_tax_regime',
  'update_tax_regime',
  'delete_tax_regime',
  'create_address',
] as const

const manageCompanyRecordsTool = fullControlTool({
  name: 'manage_company_records',
  title: 'Établissements, associés et régimes fiscaux',
  description: `Changes the records of the company settings: establishments (create with a unique SIRET, update, deactivate), persons who may be shareholders (create, with their address; update_person corrects the fields given, RGPD art. 16; erase_person erases a person of the company, RGPD art. 17, refused while the person is an associate, the names carried by entries and expense reports being kept 10 years), shareholders (create, update, delete; percentages stay within 100 %), tax regimes (add a VAT or corporate tax regime from a date, which closes the open one the day before; update; delete), addresses (create, or reuse an identical one: its id). Ids come from get_company_settings. ${ACTS_AS_USER} ${TWO_STEP}`,
  input: {
    action: z.enum(RECORD_ACTIONS),
    establishmentId: z.string().max(64).optional(),
    establishment: assistantInput(CreateEstablishmentSchema.partial().extend(UpdateEstablishmentSchema.shape)).optional().describe('create_establishment (siret required) and update_establishment: the fields.'),
    person: assistantInput(CreatePersonSchema.partial().extend(UpdatePersonSchema.shape)).optional().describe('create_person (firstName and name required) and update_person: the fields.'),
    personId: z.string().max(64).optional().describe('update_person and erase_person: from get_company_settings section persons.'),
    shareholderId: z.string().max(64).optional(),
    shareholder: assistantInput(CreateShareholderSchema.partial().extend(UpdateShareholderSchema.shape)).optional().describe('create_shareholder (type and sharePercentage required) and update_shareholder: the fields.'),
    taxRegimeId: z.string().max(64).optional(),
    taxRegime: assistantInput(AddTaxRegimeSchema.partial().extend(UpdateTaxRegimeSchema.omit({ id: true }).shape)).optional().describe('add_tax_regime (regimeType, regime and startDate required) and update_tax_regime: the fields.'),
    address: assistantInput(CreateAddressSchema).optional(),
  },
  permission: { settings: ['update'] },
  amounts: 'none',
  units: 'Dates as yyyy-mm-dd, percentages in percent.',
  never: 'deletes the company or changes the books.',
  confirmation: true,
  destructive: true,
  async preview(args) {
    return { action: args.action, ids: { establishmentId: args.establishmentId, shareholderId: args.shareholderId, taxRegimeId: args.taxRegimeId, personId: args.personId }, requested: args.establishment ?? args.person ?? args.shareholder ?? args.taxRegime ?? args.address ?? null }
  },
  async execute(args, ctx) {
    const { companyId } = args
    const need = (value: string | undefined, field: string) => {
      if (!value) throw new ValidationError(`${field} est requis pour cette action.`)
      return value
    }
    switch (args.action) {
      case 'create_establishment':
        return forAssistant(await createEstablishment(companyId, routeBody(CreateEstablishmentSchema, args.establishment ?? {})))
      case 'update_establishment':
        return forAssistant(await updateEstablishment(companyId, need(args.establishmentId, 'establishmentId'), routeBody(UpdateEstablishmentSchema, args.establishment ?? {})))
      case 'deactivate_establishment':
        await deactivateEstablishment(companyId, need(args.establishmentId, 'establishmentId'))
        return { deactivated: args.establishmentId }
      case 'create_person': {
        const { photo, ...person } = (await createCompanyPerson(companyId, routeBody(CreatePersonSchema, args.person ?? {}))) as Record<string, unknown>
        return forAssistant({ ...person, hasPhoto: Boolean(photo) })
      }
      case 'update_person': {
        const { photo, ...person } = (await updateCompanyPerson(companyId, need(args.personId, 'personId'), routeBody(UpdatePersonSchema, args.person ?? {}))) as Record<string, unknown>
        return forAssistant({ ...person, hasPhoto: Boolean(photo) })
      }
      case 'erase_person':
        return forAssistant(await eraseCompanyPerson(companyId, need(args.personId, 'personId')))
      case 'create_shareholder':
        return forAssistant(await createShareholder(companyId, routeBody(CreateShareholderSchema, args.shareholder ?? {}), ctx.access.user))
      case 'update_shareholder':
        return forAssistant(await updateShareholder(companyId, need(args.shareholderId, 'shareholderId'), routeBody(UpdateShareholderSchema, args.shareholder ?? {}), ctx.access.user))
      case 'delete_shareholder':
        await deleteShareholder(companyId, need(args.shareholderId, 'shareholderId'))
        return { deleted: args.shareholderId }
      case 'add_tax_regime':
        return forAssistant(await addTaxRegime(companyId, routeBody(AddTaxRegimeSchema, args.taxRegime ?? {})))
      case 'update_tax_regime': {
        const { id, ...input } = routeBody(UpdateTaxRegimeSchema, { ...((args.taxRegime as object | undefined) ?? {}), id: need(args.taxRegimeId, 'taxRegimeId') })
        return forAssistant(await updateTaxRegime(companyId, id, input))
      }
      case 'delete_tax_regime':
        await deleteTaxRegime(companyId, need(args.taxRegimeId, 'taxRegimeId'))
        return { deleted: args.taxRegimeId }
      case 'create_address':
        return forAssistant(await createCompanyAddress(companyId, routeBody(CreateAddressSchema, args.address ?? {})))
    }
  },
  audit: ({ action, establishmentId, shareholderId, taxRegimeId, personId }) => ({ action, establishmentId: establishmentId ?? null, shareholderId: shareholderId ?? null, taxRegimeId: taxRegimeId ?? null, personId: personId ?? null }),
})

const LAYOUT_ACTIONS = ['reset_default', 'create_default', 'create_line', 'update_line', 'delete_line', 'snapshot_line', 'restore_line', 'save_template', 'apply_template'] as const
const BALANCE_SHEET_ONLY = new Set(['create_default', 'snapshot_line', 'restore_line', 'save_template', 'apply_template'])

const lineFields = CreateBalanceSheetLineSchema.partial().extend(UpdateBalanceSheetLineSchema.shape).extend(CreateIncomeStatementLineSchema.partial().shape)

const manageStatementLayoutTool = fullControlTool({
  name: 'manage_statement_layout',
  title: 'Modifier la mise en page des états',
  description: `Changes the layout of the balance sheet or of the income statement (variant complete or simplified), like the layout pages: reset_default (back to the PCG default), create_default (balance sheet: create the default layout), create_line, update_line (the fields given), delete_line, and for the balance sheet snapshot_line and restore_line (history of a line), save_template (save the layout as a template) and apply_template. Lines have a label, a type, a parent, form codes, account codes (included, excluded, depreciation), a sense (debit, credit, auto), a display and an order. Read it with get_statement_layout. ${ACTS_AS_USER} ${TWO_STEP}`,
  input: {
    statement: z.enum(['balance_sheet', 'income_statement']),
    action: z.enum(LAYOUT_ACTIONS),
    variant: z.enum(['complete', 'simplified']).default('complete'),
    lineId: z.string().max(64).optional().describe('update_line, delete_line, snapshot_line, restore_line: from get_statement_layout.'),
    line: assistantInput(lineFields).optional().describe('create_line and update_line: the fields of the line (lineLabel required to create).'),
    version: z.number().int().optional().describe('restore_line: the version to restore.'),
    changeReason: z.string().max(500).optional().describe('snapshot_line: why.'),
    templateId: z.string().max(64).optional().describe('apply_template: from get_statement_layout view templates.'),
    templateName: z.string().max(200).optional().describe('save_template: its name.'),
    templateDescription: z.string().max(1000).optional(),
    templatePublic: z.boolean().optional().describe('save_template: visible to the other companies of the instance.'),
  },
  permission: { settings: ['update'] },
  amounts: 'none',
  never: 'changes an account, an entry or the amounts of the books (only how the statements are presented).',
  confirmation: true,
  destructive: true,
  async preview({ companyId, statement, action, lineId, line, variant }) {
    const current = lineId ? forAssistant(statement === 'balance_sheet' ? await getBalanceSheetLine(companyId, lineId) : await getIncomeStatementLine(companyId, lineId)) : null
    return { statement, action, variant, line: current, requested: line ?? null }
  },
  async execute({ companyId, statement, action, variant, lineId, line, version, changeReason, templateId, templateName, templateDescription, templatePublic }, ctx) {
    const balanceSheet = statement === 'balance_sheet'
    if (!balanceSheet && BALANCE_SHEET_ONLY.has(action)) throw new ValidationError('Cette action existe pour le bilan seulement.')
    const needLine = () => {
      if (!lineId) throw new ValidationError('lineId est requis pour cette action.')
      return lineId
    }
    const userId = ctx.access.user.id
    switch (action) {
      case 'reset_default':
        return forAssistant(balanceSheet ? await resetBalanceSheetLayout(companyId, variant) : await resetIncomeStatementLayout(companyId, variant))
      case 'create_default':
        return forAssistant(await runBalanceSheetConfigAction(companyId, { action: 'create_default', variant }))
      case 'create_line': {
        const body = { reportVariant: variant, ...((line as object | undefined) ?? {}) }
        return forAssistant(
          balanceSheet ? await createBalanceSheetLine(companyId, routeBody(CreateBalanceSheetLineSchema, body)) : await createIncomeStatementLine(companyId, routeBody(CreateIncomeStatementLineSchema, body)),
        )
      }
      case 'update_line':
        return forAssistant(
          balanceSheet
            ? await updateBalanceSheetLine(companyId, needLine(), routeBody(UpdateBalanceSheetLineSchema, line ?? {}))
            : await updateIncomeStatementLine(companyId, needLine(), routeBody(UpdateIncomeStatementLineSchema, line ?? {})),
        )
      case 'delete_line':
        if (balanceSheet) await deleteBalanceSheetLine(companyId, needLine())
        else await deleteIncomeStatementLine(companyId, needLine())
        return { deleted: lineId }
      case 'snapshot_line':
      case 'restore_line': {
        const body = routeBody(ConfigHistoryActionSchema, { action: action === 'snapshot_line' ? 'create_snapshot' : 'restore', configId: needLine(), version, changeReason })
        return forAssistant((await runBalanceSheetHistoryAction(companyId, userId, body)).result)
      }
      case 'save_template':
      case 'apply_template': {
        const body = routeBody(
          TemplateActionSchema,
          action === 'save_template' ? { action: 'create', name: templateName, description: templateDescription, variant, isPublic: templatePublic } : { action: 'apply', templateId },
        )
        return forAssistant((await runBalanceSheetTemplateAction(companyId, userId, body)).result)
      }
    }
  },
  audit: ({ statement, action, lineId, templateId }) => ({ statement, action, lineId: lineId ?? null, templateId: templateId ?? null }),
})

const manageMembersTool = fullControlTool({
  name: 'manage_members',
  title: 'Gérer les membres de la société',
  description: `Changes who may access the company, like the Membres page: action add gives a role (companyAdmin, accountant or viewer) to the user of an email (the account is created when needed), action update_role changes the role of memberId, action remove takes memberId out of the company (the user account stays). Instance administrators only, like the page. Members and their ids: get_company_settings section members. ${ACTS_AS_USER} ${TWO_STEP}`,
  input: {
    action: z.enum(['add', 'update_role', 'remove']),
    email: z.email('Email invalide.').optional().describe('add: the email of the person.'),
    name: z.string().max(200).optional().describe('add: the name, for a new account.'),
    role: z.enum(COMPANY_ROLES).optional().describe('add and update_role.'),
    memberId: z.string().max(64).optional().describe('update_role and remove.'),
  },
  permission: { members: ['manage'] },
  amounts: 'none',
  never: 'gives instance administration rights or deletes a user account.',
  confirmation: true,
  destructive: true,
  async preview({ companyId, action, email, role, memberId }, ctx) {
    ctx.requireInstanceAdministrator()
    const members = (await listMembers(companyId)) as Array<{ id: string }>
    return { action, email: email ?? null, role: role ?? null, member: memberId ? (members.find((m) => m.id === memberId) ?? null) : null, membersBefore: members.length }
  },
  async execute({ companyId, action, email, name, role, memberId }, ctx) {
    ctx.requireInstanceAdministrator()
    const user = ctx.access.user
    if (action === 'add') {
      await assertActionAllowed('invite-member', { id: user.id, email: user.email, role: user.role })
      if (!email || !role) throw new ValidationError("L'email et le rôle sont requis pour ajouter un membre.")
      const added = await addMemberToCompany({ companyId, email, name, role })
      await writeAuditLog('info', 'Membre ajouté à la société', {
        action: 'MEMBER_ADDED',
        companyId,
        metadata: { memberId: added.memberId, userId: added.userId, role, createdUser: added.createdUser, resetUnconfirmedUser: added.resetUnconfirmedUser, source: 'mcp' },
      })
      return { action, memberId: added.memberId, userId: added.userId, createdUser: added.createdUser }
    }
    if (!memberId) throw new ValidationError('memberId est requis pour cette action.')
    if (action === 'update_role') {
      const updated = await updateMemberRole(companyId, memberId, role)
      await writeAuditLog('info', "Rôle d'un membre modifié", {
        action: 'MEMBER_ROLE_CHANGED',
        companyId,
        metadata: { memberId, userId: updated.userId, from: updated.previousRole, to: updated.roles[0], source: 'mcp' },
      })
      return { action, memberId, roles: updated.roles }
    }
    const removed = await removeMember(companyId, memberId)
    await writeAuditLog('info', 'Membre retiré de la société', { action: 'MEMBER_REMOVED', companyId, metadata: { memberId, userId: removed.userId, role: removed.role, source: 'mcp' } })
    return { action, memberId, removed: true }
  },
  audit: ({ action, memberId, role }, result) => ({ action, memberId: memberId ?? (result as { memberId?: string }).memberId ?? null, role: role ?? null }),
})

export function registerSettingsTools(register: RegisterTool) {
  register(updateCompanySettingsTool)
  register(manageCompanyRecordsTool)
  register(manageStatementLayoutTool)
  register(manageMembersTool)
}
