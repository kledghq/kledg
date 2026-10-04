/**
 * Manages balance sheet configuration templates
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { buildConfigTree } from '../../config/shared/config-tree'
import { getBalanceSheetConfig } from './get-balance-sheet-config.service'
import type { BalanceSheetConfigTemplate, BalanceSheetConfig, BalanceSheetLineConfig } from '../types'

/**
 * Creates a template from current configuration
 * 
 * @param companyId - Company ID
 * @param name - Template name
 * @param description - Template description
 * @param reportVariant - 'complete' | 'simplified'
 * @param isPublic - Whether template is public
 * @param createdBy - User ID who created the template
 * @returns Created template
 */
export async function createBalanceSheetTemplate(
  companyId: string,
  name: string,
  description: string | null,
  reportVariant: 'complete' | 'simplified',
  isPublic: boolean = false,
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
      isPublic,
      createdBy: createdBy || null,
      companyId: isPublic ? null : companyId,
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
    where: {
      reportVariant,
      OR: [
        { isPublic: true },
        { companyId },
      ],
    },
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
    createdBy: t.createdBy,
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
  // Get template
  const template = await prisma.balanceSheetConfigTemplate.findUnique({
    where: { id: templateId },
  })

  // A private template of another company is not confirmed: 404 like a missing one.
  if (!template || (!template.isPublic && template.companyId !== companyId)) {
    throw new NotFoundError('Modèle introuvable')
  }

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

  // Update template usage count
  await prisma.balanceSheetConfigTemplate.update({
    where: { id: templateId },
    data: {
      usageCount: {
        increment: 1,
      },
    },
  })

  return {
    companyId,
    reportVariant: configData.reportVariant,
    lines: buildConfigTree(createdConfigs) as BalanceSheetLineConfig[],
  }
}
