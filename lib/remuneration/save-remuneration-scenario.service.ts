/**
 * Saved scenarios of the "Rémunération et dividendes" simulator
 * (docs/remuneration-dividendes.md), one table row per name and fiscal
 * year (remuneration_scenarios), and the link to the approval of the
 * accounts: the dividends of a scenario become the dividends proposed in
 * the approval pack of that fiscal year (lib/approval), which the
 * shareholders vote and Kledg books with the allocation of the result.
 *
 * - The inputs are validated by RemunerationInputsSchema; the figures saved
 *   with them are computed here by the same simulation as the page, with
 *   the rules year (RULES_YEAR), so a scenario keeps what it showed.
 * - Saving a name again replaces that scenario (upsert on fiscal year,
 *   company and name): retried calls write nothing twice.
 * - Every lookup is scoped by company (a fiscal year or a scenario of
 *   another company is "introuvable"); writes are audited.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { writeAuditLog } from '@/lib/audit'
import { ConflictError, NotFoundError } from '@/lib/accounting/errors'
import { ownedFiscalYear } from '@/lib/accounting/manage-fiscal-years.service'
import { parseStoredDetails } from '@/lib/approval/get-approval.service'
import { saveApproval } from '@/lib/approval/save-approval.service'
import { centsToDecimal, parseCents } from '@/lib/utils/money'
import { RULES_YEAR } from './rules'
import { RemunerationInputsSchema, ScenarioNameSchema, type RemunerationInputs } from './schemas'
import { simulate } from './simulate'

export const SaveScenarioBodySchema = z.object({
  fiscalYearId: z.string({ error: 'L’exercice est requis' }).min(1, 'L’exercice est requis').max(100),
  name: ScenarioNameSchema,
  inputs: RemunerationInputsSchema,
  /** Which scenario of the simulation is kept: the mix of the slider or the optimum found. */
  pick: z.enum(['mix', 'optimum', 'allPay', 'allDividends'], { error: 'Scénario inconnu' }).default('mix'),
})
export type SaveScenarioBody = z.infer<typeof SaveScenarioBodySchema>

export const ScenarioQuerySchema = z.object({
  scenarioId: z.string({ error: 'Le scénario est requis' }).min(1, 'Le scénario est requis').max(100),
})

export const ProposeDividendBodySchema = z.object({
  scenarioId: z.string({ error: 'Le scénario est requis' }).min(1, 'Le scénario est requis').max(100),
})

export interface SavedScenario {
  id: string
  fiscalYearId: string
  name: string
  inputs: RemunerationInputs
  rulesYear: number
  remunerationCostCents: number
  dividendsCents: number
  netIncomeCents: number
  updatedAt: string
}

const cents = (value: { toString(): string }) => parseCents(value.toString()) ?? 0

/** Reads a stored row; inputs that no longer validate (a rule changed) are reported as null and the row is skipped. */
export function toSavedScenario(row: {
  id: string
  fiscalYearId: string
  name: string
  inputs: unknown
  rulesYear: number
  remunerationCost: { toString(): string }
  dividends: { toString(): string }
  netIncome: { toString(): string }
  updatedAt: Date
}): SavedScenario | null {
  const parsed = RemunerationInputsSchema.safeParse(row.inputs)
  if (!parsed.success) return null
  return {
    id: row.id,
    fiscalYearId: row.fiscalYearId,
    name: row.name,
    inputs: parsed.data,
    rulesYear: row.rulesYear,
    remunerationCostCents: cents(row.remunerationCost),
    dividendsCents: cents(row.dividends),
    netIncomeCents: cents(row.netIncome),
    updatedAt: row.updatedAt.toISOString(),
  }
}

const SCENARIO_SELECT = { id: true, fiscalYearId: true, name: true, inputs: true, rulesYear: true, remunerationCost: true, dividends: true, netIncome: true, updatedAt: true } as const

/** Creates the scenario of that name in the fiscal year, or replaces it. */
export async function saveRemunerationScenario(companyId: string, body: SaveScenarioBody, userId: string): Promise<SavedScenario> {
  const fiscalYear = await ownedFiscalYear(companyId, body.fiscalYearId)
  const result = simulate(body.inputs)
  const kept = result.scenarios[body.pick]
  const figures = {
    inputs: body.inputs,
    rulesYear: RULES_YEAR,
    remunerationCost: centsToDecimal(kept.company.remunerationCostCents),
    dividends: centsToDecimal(kept.company.dividendsCents),
    netIncome: centsToDecimal(kept.person.netIncomeCents),
  }
  const row = await prisma.remunerationScenario.upsert({
    where: { fiscalYearId_companyId_name: { fiscalYearId: fiscalYear.id, companyId, name: body.name } },
    create: { companyId, fiscalYearId: fiscalYear.id, name: body.name, createdById: userId, ...figures },
    update: figures,
    select: SCENARIO_SELECT,
  })
  await writeAuditLog('info', `Scénario de rémunération « ${body.name} » enregistré pour l'exercice ${fiscalYear.year}`, {
    action: 'SAVE_REMUNERATION_SCENARIO',
    companyId,
    metadata: { fiscalYearId: fiscalYear.id, scenarioId: row.id, pick: body.pick },
  })
  return toSavedScenario(row) as SavedScenario
}

async function ownedScenario(companyId: string, scenarioId: string) {
  const row = await prisma.remunerationScenario.findFirst({ where: { id: scenarioId, companyId }, select: { ...SCENARIO_SELECT, fiscalYear: { select: { year: true } } } })
  if (!row) throw new NotFoundError('Scénario introuvable')
  return row
}

export async function deleteRemunerationScenario(companyId: string, scenarioId: string): Promise<void> {
  const row = await ownedScenario(companyId, scenarioId)
  await prisma.remunerationScenario.deleteMany({ where: { id: row.id, companyId } })
  await writeAuditLog('info', `Scénario de rémunération « ${row.name} » supprimé`, {
    action: 'DELETE_REMUNERATION_SCENARIO',
    companyId,
    metadata: { fiscalYearId: row.fiscalYearId, scenarioId: row.id },
  })
}

/**
 * Proposes the dividends of a saved scenario in the approval of the
 * accounts of its fiscal year (allocation.dividendsCents of the approval
 * details), through the approval's own service: the other details stay as
 * saved. The shareholders vote; the allocation of the result books it.
 */
export async function proposeScenarioDividends(companyId: string, scenarioId: string, userId: string): Promise<{ fiscalYearId: string; dividendsCents: number }> {
  const row = await ownedScenario(companyId, scenarioId)
  const scenario = toSavedScenario(row)
  if (!scenario) throw new ConflictError('Ce scénario a été enregistré avec des règles qui ont changé : simulez-le de nouveau et enregistrez-le avant de le proposer.')
  const approval = await prisma.accountsApproval.findUnique({
    where: { fiscalYearId_companyId: { fiscalYearId: row.fiscalYearId, companyId } },
    select: { details: true },
  })
  const details = parseStoredDetails(approval?.details)
  await saveApproval(companyId, row.fiscalYearId, { ...details, allocation: { ...details.allocation, dividendsCents: scenario.dividendsCents } }, userId)
  await writeAuditLog('info', `Dividendes du scénario « ${row.name} » proposés à l'approbation des comptes ${row.fiscalYear.year}`, {
    action: 'PROPOSE_SCENARIO_DIVIDENDS',
    companyId,
    metadata: { fiscalYearId: row.fiscalYearId, scenarioId: row.id, dividendsCents: scenario.dividendsCents },
  })
  return { fiscalYearId: row.fiscalYearId, dividendsCents: scenario.dividendsCents }
}
