/**
 * Draft-level tool of the "Rémunération et dividendes" simulator
 * (docs/remuneration-dividendes.md): save_remuneration_scenario saves a
 * named scenario of a fiscal year (the inputs and the figures they give),
 * deletes one, or proposes its dividends in the approval of the accounts of
 * its fiscal year, through the services of the routes
 * PUT and DELETE /api/companies/[id]/remuneration/scenarios and
 * POST /api/companies/[id]/remuneration/propose-dividends, with their right
 * (closing:execute). The inputs not given come from the books, as
 * simulate_remuneration reads them.
 *
 * It never books the allocation of the result, never votes for the
 * shareholders and never gives advice: a person reviews the simulation in
 * Kledg.
 */

import { z } from 'zod'
import { ValidationError } from '@/lib/accounting/errors'
import { centsFromEuros, eurosInput, kledgPageUrl } from '@/lib/mcp/tool-meta'
import { loadRemuneration } from '@/lib/remuneration/load-remuneration.service'
import { deleteRemunerationScenario, proposeScenarioDividends, saveRemunerationScenario } from '@/lib/remuneration/save-remuneration-scenario.service'
import { DIRECTOR_STATUSES, DIVIDEND_TAXATIONS, ScenarioNameSchema, type RemunerationOverrides } from '@/lib/remuneration/schemas'
import { REMUNERATION_WRITE } from '@/lib/remuneration/permissions'
import { fromCents } from '@/lib/utils/money'
import { percentInput } from '@/lib/mcp/euros'
import { draftTool, type RegisterDraftTool } from './define'

/** Two decimals at most: 12,345 % is refused, never rounded to 1 235 basis points. */
const percent = percentInput
const bp = (value: number) => Math.round(value * 100)

const input = {
  action: z.enum(['save', 'delete', 'propose']).describe('save a scenario (replaced when the name exists in the fiscal year), delete one, or propose its dividends in the approval of the accounts.'),
  fiscalYearId: z.string().min(1).max(100).optional().describe('Fiscal year of the scenario (save), from list_fiscal_years; by default the one in progress.'),
  scenarioId: z.string().min(1).max(100).optional().describe('Saved scenario (delete, propose), from simulate_remuneration.'),
  name: ScenarioNameSchema.optional().describe('Name of the scenario (save).'),
  pick: z.enum(['mix', 'optimum', 'allPay', 'allDividends']).default('optimum').describe('Which scenario of the simulation is kept (save).'),
  resultBeforePay: eurosInput.optional().describe('Result before the director’s pay and the IS, in euros.'),
  status: z.enum(DIRECTOR_STATUSES).optional(),
  reducedRate: z.boolean().optional(),
  sharePercent: percent.optional(),
  householdParts: z.number().min(1).max(20).optional(),
  otherIncome: eurosInput.min(0).optional(),
  dividendTaxation: z.enum(DIVIDEND_TAXATIONS).optional(),
  distributionPercent: percent.optional(),
  mixPercent: percent.optional(),
}

const saveScenarioTool = draftTool({
  name: 'save_remuneration_scenario',
  title: 'Enregistrer un scénario de rémunération',
  summary:
    'Saves a named scenario of the remuneration and dividends simulator for a fiscal year (inputs not given come from the books, as simulate_remuneration reads them), deletes a saved scenario, or proposes the dividends of a saved scenario in the approval of the accounts of its fiscal year (the allocation the shareholders vote). Answers the scenario and its figures.',
  never: 'books the allocation of the result, votes or approves anything for the shareholders, or gives advice (the figures are an indicative simulation).',
  amounts: 'euros',
  units: 'Shares in percent.',
  input,
  permission: REMUNERATION_WRITE,
  destructive: true,
  idempotent: true,
  async execute({ companyId, ...args }, ctx) {
    const reviewUrl = kledgPageUrl(companyId, 'remuneration')
    if (args.action === 'delete' || args.action === 'propose') {
      if (!args.scenarioId) throw new ValidationError('Indiquez le scénario (scenarioId).')
      if (args.action === 'delete') {
        await deleteRemunerationScenario(companyId, args.scenarioId)
        return { changes: { deleted: args.scenarioId }, reviewUrl, message: 'Scénario supprimé.' }
      }
      const proposed = await proposeScenarioDividends(companyId, args.scenarioId, ctx.access.user.id)
      return {
        changes: { proposedDividends: fromCents(proposed.dividendsCents), fiscalYearId: proposed.fiscalYearId },
        reviewUrl: kledgPageUrl(companyId, 'approval'),
        message: 'Dividendes proposés dans l’approbation des comptes : les associés les votent, puis l’affectation du résultat les comptabilise.',
      }
    }
    if (!args.name) throw new ValidationError('Indiquez le nom du scénario.')
    const overrides: RemunerationOverrides = {
      ...(args.resultBeforePay !== undefined && { resultBeforePayCents: centsFromEuros(args.resultBeforePay, 'Résultat avant rémunération') }),
      ...(args.status !== undefined && { status: args.status }),
      ...(args.reducedRate !== undefined && { reducedRate: args.reducedRate }),
      ...(args.sharePercent !== undefined && { shareBp: bp(args.sharePercent) }),
      ...(args.householdParts !== undefined && { householdParts: args.householdParts }),
      ...(args.otherIncome !== undefined && { otherIncomeCents: centsFromEuros(args.otherIncome, 'Autres revenus') }),
      ...(args.dividendTaxation !== undefined && { dividendTaxation: args.dividendTaxation }),
      ...(args.distributionPercent !== undefined && { distributionBp: bp(args.distributionPercent) }),
      ...(args.mixPercent !== undefined && { mixBp: bp(args.mixPercent) }),
    }
    const view = await loadRemuneration(companyId, { fiscalYearId: args.fiscalYearId, inputs: Object.keys(overrides).length ? JSON.stringify(overrides) : undefined })
    if (view.status !== 'ready' || !view.inputs || !view.fiscalYear) throw new ValidationError(view.statusReason ?? 'Aucune simulation possible pour cette société.')
    const saved = await saveRemunerationScenario(companyId, { fiscalYearId: view.fiscalYear.id, name: args.name, inputs: view.inputs, pick: args.pick }, ctx.access.user.id)
    return {
      changes: { scenarioId: saved.id, name: saved.name, fiscalYearId: saved.fiscalYearId },
      scenario: { remunerationCost: fromCents(saved.remunerationCostCents), dividends: fromCents(saved.dividendsCents), netIncome: fromCents(saved.netIncomeCents), rulesYear: saved.rulesYear },
      reviewUrl: kledgPageUrl(companyId, `remuneration?exercice=${saved.fiscalYearId}&scenario=${saved.id}`),
      message: 'Scénario enregistré. Simulation indicative : faites valider le choix par votre expert-comptable.',
    }
  },
  audit: (args, result) => ({ action: args.action, scenarioId: args.scenarioId ?? null, changes: result.changes }),
})

export function registerRemunerationDraftTools(register: RegisterDraftTool) {
  register(saveScenarioTool)
}
