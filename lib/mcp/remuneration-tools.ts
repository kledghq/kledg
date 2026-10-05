/**
 * Read tool of the "Rémunération et dividendes" simulator
 * (lib/remuneration, docs/remuneration-dividendes.md): simulate_remuneration.
 * Same rule as GET /api/companies/[id]/remuneration: the company guard with
 * REMUNERATION_READ (reports:read), then the same service computes the
 * defaults from the books and the four scenarios (all pay, all dividends,
 * mix, optimum). An indicative simulation, never advice: the result says
 * so and the assistant must say it too.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { parseInput } from '@/lib/api/zod-fields'
import { READ_ONLY, centsFromEuros, describeTool, eurosInput, kledgPageUrl } from '@/lib/mcp/tool-meta'
import { BASES, loadRemuneration } from '@/lib/remuneration/load-remuneration.service'
import { breakdownRows, DISCLAIMER, SCENARIO_ORDER } from '@/lib/remuneration/breakdown'
import { DIRECTOR_STATUSES, DIVIDEND_TAXATIONS, type RemunerationOverrides } from '@/lib/remuneration/schemas'
import { REMUNERATION_READ } from '@/lib/remuneration/permissions'
import { fromCents } from '@/lib/utils/money'

const percent = z.number().finite().min(0).max(100)

const InputSchema = z.object({
  companyId: z.string().min(1, 'La société est requise').describe('Company id, from list_companies.'),
  fiscalYearId: z.string().min(1).max(100).optional().describe('Fiscal year id, from list_fiscal_years; by default the one in progress.'),
  scenarioId: z.string().min(1).max(100).optional().describe('A saved scenario (scenarios of a previous answer): starts from its inputs.'),
  basis: z.enum(BASES).optional().describe('Figure of the books that prefills the result: current (year to date), projection (year to date over twelve months), closed (last closed year).'),
  resultBeforePay: eurosInput.optional().describe('Result of the year before the director’s pay and before the IS, in euros (overrides the books).'),
  status: z.enum(DIRECTOR_STATUSES).optional().describe('assimile (président of SAS, minority gérant) or tns (majority gérant of SARL, EURL); by default from the legal form and the share held.'),
  reducedRate: z.boolean().optional().describe('Whether the 15 % IS rate applies (CGI art. 219, I, b).'),
  sharePercent: percent.optional().describe('Share of the capital held by the director, in percent.'),
  householdParts: z.number().min(1).max(20).optional().describe('Parts of quotient familial of the household (1, 1.5, 2, 2.5...).'),
  otherIncome: eurosInput.min(0).optional().describe('Other net taxable income of the household, in euros.'),
  premiums: eurosInput.min(0).optional().describe('Share premiums held by a TNS director, in euros.'),
  currentAccount: eurosInput.min(0).optional().describe('Average balance of a TNS director’s current account, in euros.'),
  dividendTaxation: z.enum(DIVIDEND_TAXATIONS).optional().describe('pfu (flat tax), bareme (progressive scale with the 40 % abatement) or best (the better of the two).'),
  distributionPercent: percent.optional().describe('Share of the distributable profit paid as dividends, in percent (100 by default).'),
  mixPercent: percent.optional().describe('Share of the result spent on the remuneration in the mix scenario, in percent.'),
})

const bp = (value: number | undefined) => (value === undefined ? undefined : Math.round(value * 100))
const euros = (cents: number | null) => (cents === null ? null : fromCents(cents))

export function registerRemunerationReadTools(server: McpServer, guard: CompanyGuard) {
  server.registerTool(
    'simulate_remuneration',
    {
      title: 'Simulation rémunération et dividendes du dirigeant',
      description: describeTool({
        summary:
          'Simulates, for the director-shareholder of a company at the IS, what remains after pay or dividends for a fiscal year: the result before the director’s pay is read from the books (year to date, projected, or last closed year; 644 and 646 added back) and can be overridden; the status comes from the legal form (assimilé salarié for SAS, SASU, SA, minority gérant; TNS for a majority gérant of SARL or EURL). Compares four scenarios side by side: all remuneration, all dividends, a mix, and the optimum that maximises the director’s net income within the distributable profit. Each scenario gives the cost for the company, the IS (15 % then 25 %), the legal reserve (C. com. L232-10), the dividends, the social contributions (approximated 2026 rates, PASS 48 060 €), the prélèvements sociaux of 18,6 % or the TNS contributions above 10 % of capital (CSS L131-6), the income tax (scale of LFI 2026, quotient familial, PFU 12,8 % or scale with the 40 % abatement) and the net income. An indicative simulation, never advice: repeat the disclaimer to the user.',
        access: 'read',
        permission: REMUNERATION_READ,
        amounts: 'euros',
        units: 'Amounts in euros with cents; shares and rates in percent.',
        never: 'gives advice, saves a scenario, changes the approval of the accounts, posts an entry or pays anything.',
      }),
      inputSchema: InputSchema,
      annotations: READ_ONLY,
    },
    (raw: unknown) =>
      run(async () => {
        const args = parseInput(InputSchema, raw)
        await guard.require(args.companyId, REMUNERATION_READ)
        const overrides: RemunerationOverrides = {
          ...(args.resultBeforePay !== undefined && { resultBeforePayCents: centsFromEuros(args.resultBeforePay, 'Résultat avant rémunération') }),
          ...(args.status !== undefined && { status: args.status }),
          ...(args.reducedRate !== undefined && { reducedRate: args.reducedRate }),
          ...(args.sharePercent !== undefined && { shareBp: bp(args.sharePercent) }),
          ...(args.householdParts !== undefined && { householdParts: args.householdParts }),
          ...(args.otherIncome !== undefined && { otherIncomeCents: centsFromEuros(args.otherIncome, 'Autres revenus') }),
          ...(args.premiums !== undefined && { premiumsCents: centsFromEuros(args.premiums, 'Primes d’émission') }),
          ...(args.currentAccount !== undefined && { currentAccountCents: centsFromEuros(args.currentAccount, 'Compte courant') }),
          ...(args.dividendTaxation !== undefined && { dividendTaxation: args.dividendTaxation }),
          ...(args.distributionPercent !== undefined && { distributionBp: bp(args.distributionPercent) }),
          ...(args.mixPercent !== undefined && { mixBp: bp(args.mixPercent) }),
        }
        const view = await loadRemuneration(args.companyId, {
          fiscalYearId: args.fiscalYearId,
          scenarioId: args.scenarioId,
          basis: args.basis,
          inputs: Object.keys(overrides).length ? JSON.stringify(overrides) : undefined,
        })
        const sim = view.simulation
        const i = view.inputs
        return json({
          disclaimer: DISCLAIMER,
          status: view.status,
          statusReason: view.statusReason,
          rulesYear: view.rulesYear,
          fiscalYear: view.fiscalYear,
          bases: view.bases.map((b) => ({ basis: b.basis, label: b.label, resultBeforeTax: euros(b.resultBeforeTaxCents), directorPayBooked: euros(b.directorPayBookedCents), resultBeforePay: euros(b.resultBeforePayCents) })),
          basis: view.basis,
          inputs: i
            ? {
                resultBeforePay: euros(i.resultBeforePayCents),
                status: i.status,
                reducedRate: i.reducedRate,
                reducedRateCeiling: euros(i.reducedRateCeilingCents),
                legalReserveRequired: i.legalReserveRequired,
                capital: euros(i.capitalCents),
                legalReserve: euros(i.legalReserveCents),
                priorLosses: euros(i.priorLossesCents),
                sharePercent: i.shareBp / 100,
                premiums: euros(i.premiumsCents),
                currentAccount: euros(i.currentAccountCents),
                householdParts: i.householdParts,
                otherIncome: euros(i.otherIncomeCents),
                dividendTaxation: i.dividendTaxation,
                distributionPercent: i.distributionBp / 100,
                mixPercent: i.mixBp / 100,
              }
            : null,
          scenarios: sim
            ? SCENARIO_ORDER.map((id) => {
                const s = sim.scenarios[id]
                return {
                  id,
                  label: s.label,
                  remunerationPercent: s.remunerationShareBp / 100,
                  company: Object.fromEntries(Object.entries(s.company).map(([k, v]) => [k.replace(/Cents$/, ''), euros(v)])),
                  pay: { gross: euros(s.pay.grossCents), employerContributions: euros(s.pay.employerContributionsCents), employeeContributions: euros(s.pay.employeeContributionsCents), net: euros(s.pay.netCents), taxable: euros(s.pay.taxableCents) },
                  dividends: { received: euros(s.dividends.receivedCents), tnsThreshold: euros(s.dividends.thresholdCents), activityPart: euros(s.dividends.activityPartCents), socialLevies: euros(s.dividends.socialLeviesCents), tnsContributions: euros(s.dividends.tnsContributionsCents), taxation: s.dividends.taxation },
                  incomeTax: { director: euros(s.incomeTax.directorCents), marginalRatePercent: s.incomeTax.marginalRateBp / 100, other: s.incomeTax.other ? { taxation: s.incomeTax.other.taxation, director: euros(s.incomeTax.other.directorCents) } : null },
                  netIncome: euros(s.person.netIncomeCents),
                  levies: euros(s.leviesCents),
                }
              })
            : [],
          table: sim ? breakdownRows(sim).map((r) => ({ label: r.label, ...Object.fromEntries(SCENARIO_ORDER.map((id) => [id, euros(r.values[id])])) })) : [],
          notes: [...view.checks, ...(sim?.notes ?? [])],
          savedScenarios: view.scenarios.map((s) => ({ id: s.id, name: s.name, rulesYear: s.rulesYear, remunerationCost: euros(s.remunerationCostCents), dividends: euros(s.dividendsCents), netIncome: euros(s.netIncomeCents) })),
          approvalProposedDividends: euros(view.approval.proposedDividendsCents),
          sources: view.sources,
          reviewUrl: kledgPageUrl(args.companyId, view.fiscalYear ? `remuneration?exercice=${view.fiscalYear.id}` : 'remuneration'),
        })
      }),
  )
}
