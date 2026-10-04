/**
 * Operations of the statement layout routes (Paramètres du bilan et du
 * compte de résultat): one line, its creation, update and deletion, the
 * reset to the PCG default, the history and the templates of the balance
 * sheet layout. Every line, parent and template is checked against the
 * company: one of another company is a 404, like a missing one.
 */

import type { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { createBalanceSheetLineConfig } from '../balance-sheet/config/create-balance-sheet-line-config.service'
import { createDefaultBalanceSheetConfig } from '../balance-sheet/config/create-default-pcg-config.service'
import { deleteBalanceSheetLineConfig } from '../balance-sheet/config/delete-balance-sheet-line-config.service'
import {
  compareConfigVersions,
  createConfigHistorySnapshot,
  getConfigHistory,
  getConfigVersion,
  restoreConfigVersion,
} from '../balance-sheet/config/manage-config-history.service'
import { applyBalanceSheetTemplate, createBalanceSheetTemplate } from '../balance-sheet/config/manage-templates.service'
import { updateBalanceSheetLineConfig } from '../balance-sheet/config/update-balance-sheet-line-config.service'
import { createDefaultIncomeStatementConfig } from '../income-statement/config/create-default-pcg-config.service'
import { createIncomeStatementLineConfig } from '../income-statement/config/create-income-statement-line-config.service'
import { deleteIncomeStatementLineConfig } from '../income-statement/config/delete-income-statement-line-config.service'
import { updateIncomeStatementLineConfig } from '../income-statement/config/update-income-statement-line-config.service'
import type { ReportVariant } from '../report-query'
import { LAYOUT_TRANSACTION_OPTIONS, lockLayout } from '../statements/layout-lock'
import type {
  BalanceSheetConfigActionSchema,
  ConfigHistoryActionSchema,
  ConfigHistoryQuerySchema,
  CreateBalanceSheetLineBody,
  CreateIncomeStatementConfigLineSchema,
  CreateIncomeStatementLineSchema,
  TemplateActionSchema,
  UpdateBalanceSheetLineSchema,
  UpdateIncomeStatementLineSchema,
} from './schemas'

const LINE_NOT_FOUND = 'Configuration introuvable'
const TEMPLATE_NOT_FOUND = 'Modèle introuvable'

/** A balance sheet layout line of the company, else a 404. */
export async function getBalanceSheetLine(companyId: string, lineId: string) {
  const line = await prisma.balanceSheetLineConfig.findFirst({ where: { id: lineId, companyId } })
  if (!line) throw new NotFoundError(LINE_NOT_FOUND)
  return line
}

/** An income statement layout line of the company, else a 404. */
export async function getIncomeStatementLine(companyId: string, lineId: string) {
  const line = await prisma.incomeStatementLineConfig.findFirst({ where: { id: lineId, companyId } })
  if (!line) throw new NotFoundError(LINE_NOT_FOUND)
  return line
}

/** A template the company may use: public, or its own. */
async function assertTemplateUsable(companyId: string, templateId: string | null | undefined): Promise<void> {
  if (!templateId) return
  const template = await prisma.balanceSheetConfigTemplate.findFirst({
    where: { id: templateId, OR: [{ isPublic: true }, { companyId }] },
    select: { id: true },
  })
  if (!template) throw new NotFoundError(TEMPLATE_NOT_FOUND)
}

/** Creates a balance sheet line; the service checks the account codes and that the parent is of the company and variant. */
export async function createBalanceSheetLine(companyId: string, input: CreateBalanceSheetLineBody) {
  await assertTemplateUsable(companyId, input.templateId)
  const accountCodes = input.accountCodes || []
  return createBalanceSheetLineConfig({
    companyId,
    reportVariant: input.reportVariant,
    parentId: input.parentId || null,
    lineLabel: input.lineLabel,
    lineType: input.lineType || (accountCodes.length === 0 ? 'sum' : 'line'),
    formCode: input.formCode || null,
    amortissementFormCode: input.amortissementFormCode || null,
    accountCodes,
    excludedAccountCodes: input.excludedAccountCodes || [],
    amortissementAccountCodes: input.amortissementAccountCodes || [],
    filterType: input.filterType || 'starts_with',
    filterValue: input.filterValue || null,
    balanceType: input.balanceType || 'debit',
    displayType: input.displayType || 'net',
    order: input.order || 1,
    notes: input.notes || null,
    templateId: input.templateId || null,
  })
}

/** Updates a balance sheet line of the company; a new parent must be a line of the company. */
export async function updateBalanceSheetLine(
  companyId: string,
  lineId: string,
  input: z.infer<typeof UpdateBalanceSheetLineSchema>,
) {
  await getBalanceSheetLine(companyId, lineId)
  if (input.parentId) await getBalanceSheetLine(companyId, input.parentId)
  return updateBalanceSheetLineConfig(lineId, companyId, input)
}

/** Deletes a balance sheet line of the company (its history goes with it). */
export async function deleteBalanceSheetLine(companyId: string, lineId: string): Promise<void> {
  await deleteBalanceSheetLineConfig(lineId, companyId)
}

/** Replaces the balance sheet layout of the variant by the PCG default, in one transaction. */
export function resetBalanceSheetLayout(companyId: string, variant: ReportVariant) {
  return prisma.$transaction(async (tx) => {
    await lockLayout(tx, companyId, 'balance-sheet', variant)
    await tx.balanceSheetLineConfig.deleteMany({ where: { companyId, reportVariant: variant } })
    return createDefaultBalanceSheetConfig(companyId, variant, tx)
  }, LAYOUT_TRANSACTION_OPTIONS)
}

/** POST .../balance-sheet/config: creates the default layout, or one line (with its section and label visibility). */
export async function runBalanceSheetConfigAction(companyId: string, input: z.infer<typeof BalanceSheetConfigActionSchema>) {
  if (input.action === 'create_default') return createDefaultBalanceSheetConfig(companyId, input.variant)
  await assertTemplateUsable(companyId, input.templateId)
  return createBalanceSheetLineConfig({
    companyId,
    reportVariant: input.reportVariant,
    parentId: input.parentId,
    section: input.section,
    lineLabel: input.lineLabel,
    lineType: input.lineType ?? undefined,
    formCode: input.formCode,
    amortissementFormCode: input.amortissementFormCode,
    accountCodes: input.accountCodes ?? [],
    excludedAccountCodes: input.excludedAccountCodes ?? undefined,
    amortissementAccountCodes: input.amortissementAccountCodes ?? undefined,
    filterType: input.filterType,
    filterValue: input.filterValue,
    balanceType: input.balanceType ?? 'debit',
    displayType: input.displayType ?? undefined,
    hideLabel: input.hideLabel,
    order: input.order ?? 1,
    notes: input.notes,
    templateId: input.templateId,
  })
}

/** History of a balance sheet line of the company: all of it, one version, or two versions compared. */
export async function readBalanceSheetLineHistory(companyId: string, query: z.infer<typeof ConfigHistoryQuerySchema>) {
  await getBalanceSheetLine(companyId, query.configId)
  if (query.version !== undefined) {
    const version = await getConfigVersion(query.configId, query.version)
    if (!version) throw new NotFoundError('Version introuvable')
    return version
  }
  if (query.version1 !== undefined && query.version2 !== undefined) {
    return compareConfigVersions(query.configId, query.version1, query.version2)
  }
  return getConfigHistory(query.configId)
}

/**
 * Snapshot of a balance sheet line of the company (author: the signed-in
 * user), or the restore of one of its versions. Returns whether a row was
 * created, for the 201.
 */
export async function runBalanceSheetHistoryAction(
  companyId: string,
  userId: string,
  input: z.infer<typeof ConfigHistoryActionSchema>,
) {
  await getBalanceSheetLine(companyId, input.configId)
  if (input.action === 'create_snapshot') {
    return { created: true, result: await createConfigHistorySnapshot(input.configId, userId, input.changeReason) }
  }
  if (!input.version) throw new ValidationError('Indiquez la version à restaurer')
  // The version is looked up by (configId, version): scoped by the line.
  return { created: false, result: await restoreConfigVersion(input.configId, input.version) }
}

/** Saves the company's balance sheet layout as a template (author: the signed-in user), or applies a template. */
export async function runBalanceSheetTemplateAction(companyId: string, userId: string, input: z.infer<typeof TemplateActionSchema>) {
  if (input.action === 'create') {
    const template = await createBalanceSheetTemplate(
      companyId,
      input.name,
      input.description || null,
      input.variant,
      input.isPublic || false,
      userId,
    )
    return { created: true, result: template }
  }
  // A private template of another company is not visible: 404 (checked by the service).
  return { created: false, result: await applyBalanceSheetTemplate(input.templateId, companyId) }
}

/** Creates an income statement line; the service checks that the parent is of the company and variant. */
export function createIncomeStatementLine(companyId: string, input: z.infer<typeof CreateIncomeStatementLineSchema>) {
  return createIncomeStatementLineConfig({
    companyId,
    reportVariant: input.reportVariant,
    parentId: input.parentId || null,
    section: input.section || null,
    lineLabel: input.lineLabel,
    formCode: input.formCode || null,
    accountCodes: input.accountCodes || [],
    excludedAccountCodes: input.excludedAccountCodes || [],
    filterType: input.filterType || 'starts_with',
    filterValue: input.filterValue || null,
    balanceType: input.balanceType || 'credit',
    hideLabel: input.hideLabel,
    order: input.order || 1,
    notes: input.notes || null,
  })
}

/** POST .../income-statement/config: a line given in full (codes, sense, order). */
export function createIncomeStatementConfigLine(companyId: string, input: z.infer<typeof CreateIncomeStatementConfigLineSchema>) {
  return createIncomeStatementLineConfig({
    ...input,
    companyId,
    parentId: input.parentId || null,
    excludedAccountCodes: input.excludedAccountCodes ?? undefined,
  })
}

/** Updates an income statement line of the company; a new parent must be a line of the company. */
export async function updateIncomeStatementLine(
  companyId: string,
  lineId: string,
  input: z.infer<typeof UpdateIncomeStatementLineSchema>,
) {
  await getIncomeStatementLine(companyId, lineId)
  if (input.parentId) await getIncomeStatementLine(companyId, input.parentId)
  return updateIncomeStatementLineConfig(lineId, input)
}

/** Deactivates an income statement line of the company. */
export async function deleteIncomeStatementLine(companyId: string, lineId: string): Promise<void> {
  await getIncomeStatementLine(companyId, lineId)
  await deleteIncomeStatementLineConfig(lineId)
}

/** Replaces the income statement layout of the variant by the PCG default, in one transaction. */
export function resetIncomeStatementLayout(companyId: string, variant: ReportVariant) {
  return prisma.$transaction(async (tx) => {
    await lockLayout(tx, companyId, 'income-statement', variant)
    await tx.incomeStatementLineConfig.deleteMany({ where: { companyId, reportVariant: variant } })
    return createDefaultIncomeStatementConfig(companyId, variant, tx)
  }, LAYOUT_TRANSACTION_OPTIONS)
}
