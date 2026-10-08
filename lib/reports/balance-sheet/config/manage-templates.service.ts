/**
 * Manages balance sheet configuration templates.
 *
 * A template a company saves stays its own (KLEDG-R3-AUTHZ-01). Templates
 * shared across the instance are Kledg's own: rows without company, written
 * by an unrestricted context only (migration 20261121090000, docs/rls.md).
 * A template of another company is never listed, applied nor read.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { buildConfigTree } from '../../config/shared/config-tree'
import { getBalanceSheetConfig } from './get-balance-sheet-config.service'
import type { BalanceSheetConfigTemplate, BalanceSheetConfig, BalanceSheetLineConfig } from '../types'

/** The templates a company may list, apply or read: its own, and Kledg's shared ones. */
export function usableTemplateWhere(companyId: string): Prisma.BalanceSheetConfigTemplateWhereInput {
  return { OR: [{ companyId }, { companyId: null, isPublic: true }] }
}

/**
 * Saves the company's current layout as a template of the company.
 *
 * @param companyId - Company ID
 * @param name - Template name
 * @param description - Template description
 * @param reportVariant - 'complete' | 'simplified'
 * @param createdBy - User ID who created the template
 * @returns Created template
 */
export async function createBalanceSheetTemplate(
  companyId: string,
  name: string,
  description: string | null,
  reportVariant: 'complete' | 'simplified',
  createdBy?: string
): Promise<BalanceSheetConfigTemplate> {
  // Get current configuration
  const config = await getBalanceSheetConfig(companyId, reportVariant)

  // Create template
  const template = await prisma.balanceSheetConfigTemplate.create({
    data: {
      name,
      description: description || null,
      reportVariant,
      isPublic: false,
      createdBy: createdBy || null,
      companyId,
      configData: JSON.parse(JSON.stringify(config)),
      usageCount: 0,
    },
  })

  return {
    id: template.id,
    name: template.name,
    description: template.description,
    reportVariant: template.reportVariant as 'complete' | 'simplified',
    isPublic: template.isPublic,
    createdBy: template.createdBy,
    companyId: template.companyId,
    configData: template.configData as unknown as BalanceSheetConfig,
    usageCount: template.usageCount,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  }
}

/**
 * Lists available templates
 * 
 * @param companyId - Company ID
 * @param reportVariant - 'complete' | 'simplified'
 * @returns Available templates
 */
export async function listBalanceSheetTemplates(
  companyId: string,
  reportVariant: 'complete' | 'simplified'
): Promise<BalanceSheetConfigTemplate[]> {
  const templates = await prisma.balanceSheetConfigTemplate.findMany({
    where: { reportVariant, ...usableTemplateWhere(companyId) },
    orderBy: [
      { isPublic: 'desc' },
      { usageCount: 'desc' },
      { createdAt: 'desc' },
    ],
  })

  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    reportVariant: t.reportVariant as 'complete' | 'simplified',
    isPublic: t.isPublic,
    // Who saved a shared template is not the company's business.
    createdBy: t.companyId === companyId ? t.createdBy : null,
    companyId: t.companyId,
    configData: t.configData as unknown as BalanceSheetConfig,
    usageCount: t.usageCount,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }))
}

/**
 * Applies a template to a company
 * 
 * @param templateId - Template ID
 * @param companyId - Company ID
 * @returns Applied configuration
 */
export async function applyBalanceSheetTemplate(
  templateId: string,
  companyId: string
): Promise<BalanceSheetConfig> {
  // A template of another company is not confirmed: 404 like a missing one.
  const template = await prisma.balanceSheetConfigTemplate.findFirst({
    where: { id: templateId, ...usableTemplateWhere(companyId) },
  })
  if (!template) throw new NotFoundError('Modèle introuvable')

  const configData = template.configData as unknown as BalanceSheetConfig

  // Delete existing configurations for this variant
  await prisma.balanceSheetLineConfig.deleteMany({
    where: {
      companyId,
      reportVariant: configData.reportVariant,
    },
  })

  // Create configurations from template
  // Sort by depth using parentId hierarchy
  const configsById = new Map<string, BalanceSheetLineConfig>()
  const buildConfigMap = (configs: BalanceSheetLineConfig[]) => {
    configs.forEach(config => {
      configsById.set(config.id, config)
      if (config.children) {
        buildConfigMap(config.children)
      }
    })
  }
  buildConfigMap(configData.lines)

  // Calculate depth for each config
  const getDepth = (config: BalanceSheetLineConfig): number => {
    if (!config.parentId) return 0
    const parent = configsById.get(config.parentId)
    return parent ? getDepth(parent) + 1 : 0
  }

  // Every line of the tree, parents before their children (configData.lines
  // holds the roots only, with their children nested).
  const sortedLines = [...configsById.values()].sort((a, b) => {
    const depthA = getDepth(a)
    const depthB = getDepth(b)
    return depthA - depthB
  })

  const createdConfigsById = new Map<string, { id: string }>()
  const createdConfigs = []

  for (const lineConfig of sortedLines) {
    // Use parentId from config (should be set from nested structure)
    let parentId: string | null = lineConfig.parentId || null
    
    // If parentId references a config that was just created, use the created ID
    if (parentId && createdConfigsById.has(parentId)) {
      parentId = createdConfigsById.get(parentId)!.id
    }

    const created = await prisma.balanceSheetLineConfig.create({
      data: {
        companyId,
        reportVariant: lineConfig.reportVariant,
        parentId,
        // The section decides actif or passif for a whole subtree (lib/reports/statements/allocation.ts).
        section: lineConfig.section ?? null,
        lineLabel: lineConfig.lineLabel,
        lineType: lineConfig.lineType,
        hideLabel: lineConfig.hideLabel ?? false,
        formCode: lineConfig.formCode || null,
        amortissementFormCode: lineConfig.amortissementFormCode || null,
        accountCodes: lineConfig.accountCodes,
        excludedAccountCodes: lineConfig.excludedAccountCodes,
        amortissementAccountCodes: lineConfig.amortissementAccountCodes || [],
        filterType: lineConfig.filterType || null,
        filterValue: lineConfig.filterValue || null,
        balanceType: lineConfig.balanceType,
        displayType: lineConfig.displayType,
        order: lineConfig.order,
        notes: lineConfig.notes || null,
        version: 1,
        templateId: template.id,
        isActive: true,
      },
    })

    // Store in map for parent lookup (by original ID from template)
    createdConfigsById.set(lineConfig.id, { id: created.id })

    createdConfigs.push(created)
  }

  // Usage count of the company's own templates; Kledg's shared ones are
  // written by an unrestricted context only (row level security).
  if (template.companyId === companyId) {
    await prisma.balanceSheetConfigTemplate.update({
      where: { id: templateId },
      data: { usageCount: { increment: 1 } },
    })
  }

  return {
    companyId,
    reportVariant: configData.reportVariant,
    lines: buildConfigTree(createdConfigs) as BalanceSheetLineConfig[],
  }
}

/**
 * Deletes a template of the company (KLEDG-R3-AUTHZ-01). Kledg's shared
 * templates and those of other companies answer 404 like a missing one.
 * Layout lines created from it keep their own copy (templateId is only a
 * reference, without foreign key).
 */
export async function deleteBalanceSheetTemplate(companyId: string, templateId: string): Promise<{ id: string }> {
  const { count } = await prisma.balanceSheetConfigTemplate.deleteMany({ where: { id: templateId, companyId } })
  if (count === 0) throw new NotFoundError('Modèle introuvable')
  return { id: templateId }
}
