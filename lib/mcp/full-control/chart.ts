/**
 * Full control tools on the chart of accounts, the journals, the fiscal
 * years and the import of accounting files: thin wrappers over the services
 * of app/api/accounts/**, app/api/journals/**,
 * app/api/companies/[id]/fiscal-years/** and app/api/import/**, with the
 * same rights (ledger:manage; entries:create and ledger:manage to import).
 * Deletions and imports are high impact (execution mode of the connection).
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/accounting/errors'
import { getActiveFiscalYear } from '@/lib/accounting/fiscal-year-utils'
import { updateAccount } from '@/lib/accounting/manage-accounts.service'
import { deleteAccount, deleteNonPcgAccounts } from '@/lib/accounting/delete-accounts.service'
import { completePcgChart, seedPcgChart } from '@/lib/accounting/pcg-chart.service'
import { deleteJournal, listJournals, updateJournal } from '@/lib/accounting/manage-journals.service'
import { ensureDefaultJournals } from '@/lib/accounting/default-journals'
import { createFiscalYear, updateFiscalYearDates } from '@/lib/accounting/manage-fiscal-years.service'
import { deleteFiscalYear } from '@/lib/accounting/delete-fiscal-year.service'
import { lockPeriod } from '@/lib/accounting/period-lock/lock-period.service'
import { calendarDayOf } from '@/lib/utils/date'
import { importAccountingFile, previewImportFiscalYears } from '@/lib/import/import-file.service'
import { MAX_UPLOAD_BYTES } from '@/lib/api/files'
import { enforceRateLimit } from '@/lib/rate-limit'
import { writeAuditLog } from '@/lib/audit'
import { forAssistant } from '@/lib/mcp/euros'
import { fullControlTool, type RegisterTool } from './define'
import { ACTS_AS_USER, TWO_STEP } from './descriptions'
import { accountIdsByCode, isoDate, journalIdByCode, ownedFiscalYear } from './resolve'
import { decodeBase64File } from './files'
import { companyLock, rowTargets } from './fingerprint'

async function chartFiscalYear(companyId: string, fiscalYearId?: string) {
  if (fiscalYearId) return ownedFiscalYear(companyId, fiscalYearId)
  const active = await getActiveFiscalYear(companyId)
  if (!active) throw new ValidationError("Aucun exercice ouvert : créez d'abord l'exercice.")
  return active
}

async function accountOf(companyId: string, accountCode: string | undefined, fiscalYearId?: string) {
  if (!accountCode) throw new ValidationError('accountCode est requis pour cette action.')
  const fiscalYear = await chartFiscalYear(companyId, fiscalYearId)
  const accountId = (await accountIdsByCode(companyId, fiscalYear.id, [accountCode])).get(accountCode)!
  return { accountId, fiscalYearId: fiscalYear.id }
}

/** Accounts of a chart that are not PCG accounts (what delete_non_pcg removes). */
async function nonPcgAccounts(companyId: string, fiscalYearId: string) {
  return prisma.account.findMany({ where: { companyId, fiscalYearId, isPCG: false }, select: { code: true, label: true }, orderBy: { code: 'asc' } })
}

const ACCOUNT_ACTIONS = ['update', 'delete', 'complete_pcg', 'seed_pcg', 'delete_non_pcg'] as const

const manageAccountsTool = fullControlTool({
  name: 'manage_accounts',
  title: 'Gérer le plan comptable',
  description: `Changes the chart of accounts of a fiscal year (the current one by default): action update changes the number (not of a PCG account), the label or the parent of accountCode; action delete deletes accountCode and its sub-accounts (refused for a PCG account or an account with entries); action complete_pcg adds the missing PCG accounts and fixes the parent links; action seed_pcg seeds the PCG accounts; action delete_non_pcg deletes every account that is not a PCG account (refused, nothing deleted, when one holds entries). Create one with create_account. ${ACTS_AS_USER} Actions delete and delete_non_pcg are high impact: ${TWO_STEP}`,
  input: {
    action: z.enum(ACCOUNT_ACTIONS),
    accountCode: z.string().max(20).optional().describe('update and delete: the account number, from search_accounts.'),
    fiscalYearId: z.string().max(64).optional().describe('Fiscal year id, from list_fiscal_years. Defaults to the current fiscal year.'),
    code: z.string().max(20).optional().describe('update: the new number.'),
    label: z.string().max(200).optional().describe('update: the new label.'),
    parentCode: z.string().max(20).nullable().optional().describe('update: the new parent account number, null to detach.'),
    includeOptionalAccounts: z.boolean().optional().describe('complete_pcg and seed_pcg: also the optional PCG accounts.'),
  },
  permission: { ledger: ['manage'] },
  amounts: 'none',
  never: 'deletes a PCG account, an account holding entries or an account of a closed fiscal year.',
  targetState: ({ companyId, fiscalYearId }) => [companyLock(companyId), ...rowTargets('fiscal_years', companyId, fiscalYearId)],
  confirmation: true,
  highImpactActions: ['delete', 'delete_non_pcg'],
  destructive: true,
  async preview({ companyId, action, accountCode, fiscalYearId }) {
    if (action === 'delete') {
      const { accountId } = await accountOf(companyId, accountCode, fiscalYearId)
      const account = await prisma.account.findFirstOrThrow({ where: { id: accountId, companyId }, select: { code: true, label: true, isPCG: true, _count: { select: { children: true } } } })
      return { action, account: { code: account.code, label: account.label, isPCG: account.isPCG, subAccounts: account._count.children } }
    }
    const fiscalYear = await chartFiscalYear(companyId, fiscalYearId)
    if (action === 'delete_non_pcg') return { action, fiscalYearId: fiscalYear.id, accountsToDelete: await nonPcgAccounts(companyId, fiscalYear.id) }
    return { action, fiscalYearId: fiscalYear.id }
  },
  async execute({ companyId, action, accountCode, fiscalYearId, code, label, parentCode, includeOptionalAccounts }) {
    if (action === 'update') {
      const { accountId, fiscalYearId: fyId } = await accountOf(companyId, accountCode, fiscalYearId)
      const parentId = parentCode === null ? null : parentCode ? (await accountIdsByCode(companyId, fyId, [parentCode])).get(parentCode)! : undefined
      const { before, account } = await updateAccount(companyId, accountId, { code, label, parentId })
      await writeAuditLog('info', `Account updated: ${account.code} - ${account.label}`, {
        action: 'UPDATE_ACCOUNT',
        companyId,
        metadata: { accountId: account.id, oldCode: before.code, newCode: account.code, oldLabel: before.label, newLabel: account.label, source: 'mcp' },
      })
      return { action, account: { id: account.id, code: account.code, label: account.label } }
    }
    if (action === 'delete') {
      const { accountId } = await accountOf(companyId, accountCode, fiscalYearId)
      const account = await deleteAccount(companyId, accountId)
      await writeAuditLog('info', `Account deleted: ${account.code} - ${account.label}`, { action: 'DELETE_ACCOUNT', companyId, metadata: { accountId: account.id, code: account.code, label: account.label, source: 'mcp' } })
      return { action, deleted: account }
    }
    const fiscalYear = await chartFiscalYear(companyId, fiscalYearId)
    if (action === 'complete_pcg') return { action, ...(await completePcgChart(companyId, { fiscalYearId: fiscalYear.id, includeOptionalAccounts })) }
    if (action === 'seed_pcg') {
      await seedPcgChart(companyId, fiscalYear.id, includeOptionalAccounts ?? false)
      return { action, fiscalYearId: fiscalYear.id, seeded: true }
    }
    const result = await deleteNonPcgAccounts(companyId, fiscalYear.id)
    if (result.deletedCount > 0) {
      await writeAuditLog('info', `Deleted ${result.deletedCount} non-PCG account(s)`, { action: 'DELETE_NON_PCG_ACCOUNTS', companyId, metadata: { deletedCount: result.deletedCount, source: 'mcp' } })
    }
    return { action, ...result }
  },
  audit: ({ action, accountCode, fiscalYearId }) => ({ action, accountCode: accountCode ?? null, fiscalYearId: fiscalYearId ?? null }),
})

const manageJournalsTool = fullControlTool({
  name: 'manage_journals',
  title: 'Gérer les journaux',
  description: `Changes the journals of the company: action update changes the code or the label of journalCode; action delete deletes journalCode when it holds no entry (409 otherwise); action restore_defaults adds back the default journals (AC, VE, BQ, OD, AN) the company is missing, leaving the others as they are. Create one with create_journal. ${ACTS_AS_USER} Action delete is high impact: ${TWO_STEP}`,
  input: {
    action: z.enum(['update', 'delete', 'restore_defaults']),
    journalCode: z.string().max(10).optional().describe('update and delete: the journal code, from list_journals.'),
    code: z.string().max(10).optional().describe('update: the new code.'),
    label: z.string().max(255).optional().describe('update: the new label.'),
  },
  permission: { ledger: ['manage'] },
  amounts: 'none',
  never: 'deletes a journal that holds entries.',
  targetState: ({ companyId }) => [companyLock(companyId)],
  confirmation: true,
  highImpactActions: ['delete'],
  destructive: true,
  async preview({ companyId, action, journalCode }) {
    if (action !== 'delete') return { action }
    if (!journalCode) throw new ValidationError('journalCode est requis pour cette action.')
    const journalId = await journalIdByCode(companyId, journalCode)
    const journal = await prisma.journal.findFirstOrThrow({ where: { id: journalId, companyId }, select: { code: true, label: true } })
    const entries = await prisma.accountingEntry.count({ where: { companyId, journalId } })
    return { action, journal: { code: journal.code, label: journal.label, entries } }
  },
  async execute({ companyId, action, journalCode, code, label }) {
    if (action === 'restore_defaults') {
      const created = await ensureDefaultJournals(companyId)
      return { action, created, journals: (await listJournals(companyId)).map((j) => ({ code: j.code, label: j.label })) }
    }
    if (!journalCode) throw new ValidationError('journalCode est requis pour cette action.')
    const journalId = await journalIdByCode(companyId, journalCode)
    if (action === 'delete') {
      await deleteJournal(companyId, journalId)
      return { action, deleted: journalCode }
    }
    const journal = await updateJournal(companyId, journalId, { code, label })
    return { action, journal: { code: journal.code, label: journal.label } }
  },
  audit: ({ action, journalCode }) => ({ action, journalCode: journalCode ?? null }),
})

const manageFiscalYearsTool = fullControlTool({
  name: 'manage_fiscal_years',
  title: 'Gérer les exercices',
  description: `Creates or changes the fiscal years of the company: action create opens a fiscal year with its PCG chart (409 when the year exists); action update_dates changes the dates of an open fiscal year (409 when closed, 400 when they overlap another open year); action delete deletes an open fiscal year without entries (409 when closed or holding entries); action lock_period closes the periods of an open fiscal year up to the day \`through\` (PCG art. 1031-4): no entry dated on or before it can be created or validated any more, the lock only moves forward, stops before the last day of the year and is refused while drafts are dated in the period. Closing the year is close_fiscal_year. ${ACTS_AS_USER} Actions delete and lock_period are high impact: ${TWO_STEP}`,
  input: {
    action: z.enum(['create', 'update_dates', 'delete', 'lock_period']),
    fiscalYearId: z.string().max(64).optional().describe('update_dates, delete and lock_period: from list_fiscal_years.'),
    through: isoDate.optional().describe('lock_period: the last day of the period to close (included).'),
    year: z.number().int().min(1900).max(2200).optional().describe('create: the year of the fiscal year (usually the year of its end).'),
    startDate: isoDate.optional().describe('create and update_dates.'),
    endDate: isoDate.optional().describe('create and update_dates.'),
  },
  permission: { ledger: ['manage'] },
  // Like POST .../fiscal-years/[fiscalYearId]/period-lock
  actions: { lock_period: { closing: ['execute'] } },
  amounts: 'none',
  units: 'Dates as yyyy-mm-dd.',
  never: 'changes or deletes a closed fiscal year, deletes a fiscal year holding entries, or reopens a closed period.',
  targetState: ({ companyId, fiscalYearId }) => [companyLock(companyId), ...rowTargets('fiscal_years', companyId, fiscalYearId)],
  confirmation: true,
  highImpactActions: ['delete', 'lock_period'],
  destructive: true,
  async preview({ companyId, action, fiscalYearId, through }) {
    if (action === 'lock_period') {
      if (!fiscalYearId || !through) throw new ValidationError('fiscalYearId et through sont requis pour cette action.')
      const fiscalYear = await ownedFiscalYear(companyId, fiscalYearId)
      const current = await prisma.fiscalYear.findFirst({ where: { id: fiscalYear.id, companyId }, select: { periodLockedThrough: true } })
      const drafts = await prisma.accountingEntry.count({ where: { companyId, fiscalYearId: fiscalYear.id, status: 'draft', date: { lte: new Date(`${through}T00:00:00.000Z`) } } })
      return { action, fiscalYear: { id: fiscalYear.id, year: fiscalYear.year }, lockedThrough: calendarDayOf(current?.periodLockedThrough ?? null), through, draftsInPeriod: drafts }
    }
    if (action !== 'delete') return { action }
    if (!fiscalYearId) throw new ValidationError('fiscalYearId est requis pour cette action.')
    const fiscalYear = await ownedFiscalYear(companyId, fiscalYearId)
    const entries = await prisma.accountingEntry.count({ where: { companyId, fiscalYearId: fiscalYear.id } })
    return { action, fiscalYear: { id: fiscalYear.id, year: fiscalYear.year }, entries }
  },
  async execute({ companyId, action, fiscalYearId, year, startDate, endDate, through }, ctx) {
    if (action === 'create') {
      if (year === undefined || !startDate || !endDate) throw new ValidationError("L'année, la date de début et la date de fin sont requises.")
      return { action, fiscalYear: forAssistant(await createFiscalYear(companyId, { year, startDate, endDate })) }
    }
    if (!fiscalYearId) throw new ValidationError('fiscalYearId est requis pour cette action.')
    if (action === 'delete') {
      await deleteFiscalYear(companyId, fiscalYearId)
      return { action, deleted: fiscalYearId }
    }
    if (action === 'lock_period') {
      if (!through) throw new ValidationError('through est requis pour cette action.')
      return { action, ...(await lockPeriod(companyId, fiscalYearId, through, ctx.access.user.id)) }
    }
    if (!startDate || !endDate) throw new ValidationError('La date de début et la date de fin sont requises.')
    return { action, fiscalYear: forAssistant(await updateFiscalYearDates(companyId, fiscalYearId, { startDate, endDate })) }
  },
  audit: ({ action, fiscalYearId, year, through }) => ({ action, fiscalYearId: fiscalYearId ?? null, year: year ?? null, through: through ?? null }),
})

/** Accounting files sent through MCP: base64 in the JSON call. */
const MAX_MCP_IMPORT_BYTES = Math.min(MAX_UPLOAD_BYTES, 5 * 1024 * 1024)

const importAccountingFileTool = fullControlTool({
  name: 'import_accounting_file',
  title: 'Importer un fichier comptable',
  description: `Imports the entries of an accounting file into the company, like the Import page: type fec (Fichier des écritures comptables, any encoding), csv or excel; accounts and journals of the file are mapped to existing ones (accountMapping, journalMapping: code to id, null to create) or created. The dry run gives, for a FEC, the fiscal years the file covers. ${ACTS_AS_USER} ${TWO_STEP}`,
  input: {
    type: z.enum(['fec', 'csv', 'excel']),
    fileName: z.string().min(1).max(200).describe('Original file name, e.g. "123456789FEC20251231.txt".'),
    contentBase64: z.string().min(1).max(Math.ceil((MAX_MCP_IMPORT_BYTES * 4) / 3) + 4).describe('The file content, base64 encoded (5 MB at most).'),
    mapping: z.record(z.string(), z.string()).optional().describe('FEC: column of the file for each FEC field (JournalCode, EcritureDate, CompteNum, Debit, Credit...), when the headers differ.'),
    accountMapping: z.record(z.string(), z.string().nullable()).optional(),
    journalMapping: z.record(z.string(), z.string().nullable()).optional(),
    cleanEntryNumbers: z.boolean().optional().describe('Renumber the entries instead of keeping the numbers of the file.'),
  },
  permission: { entries: ['create'], ledger: ['manage'] },
  amounts: 'none',
  never: 'imports into a closed fiscal year or deletes existing entries.',
  targetState: ({ companyId }) => [companyLock(companyId)],
  confirmation: true,
  async preview({ companyId, type, fileName, contentBase64, mapping }, ctx) {
    await enforceRateLimit('import', ctx.access.user.id)
    const bytes = decodeBase64File(contentBase64, MAX_MCP_IMPORT_BYTES)
    if (type !== 'fec') return { type, fileName, size: bytes.length }
    // UTF-8 (with or without BOM), else ISO 8859-15 like the importer (LPF art. A47 A-1).
    let content: string
    try {
      content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
    } catch {
      content = new TextDecoder('latin1').decode(bytes)
    }
    return { type, fileName, size: bytes.length, ...forAssistant(await previewImportFiscalYears(companyId, { content, mapping: mapping as never })) as object }
  },
  async execute({ companyId, type, fileName, contentBase64, mapping, accountMapping, journalMapping, cleanEntryNumbers }, ctx) {
    await enforceRateLimit('import', ctx.access.user.id)
    const bytes = decodeBase64File(contentBase64, MAX_MCP_IMPORT_BYTES)
    const form = new FormData()
    form.set('file', new File([bytes as BlobPart], fileName))
    form.set('type', type)
    if (mapping) form.set('mapping', JSON.stringify(mapping))
    if (accountMapping) form.set('accountMapping', JSON.stringify(accountMapping))
    if (journalMapping) form.set('journalMapping', JSON.stringify(journalMapping))
    if (cleanEntryNumbers !== undefined) form.set('cleanEntryNumbers', String(cleanEntryNumbers))
    return forAssistant(await importAccountingFile(companyId, form)) as Record<string, unknown>
  },
  audit: ({ type, fileName }, result) => ({ type, fileName, entriesCreated: (result as { entriesCreated?: number }).entriesCreated ?? null }),
})

export function registerChartTools(register: RegisterTool) {
  register(manageAccountsTool)
  register(manageJournalsTool)
  register(manageFiscalYearsTool)
  register(importAccountingFileTool)
}
