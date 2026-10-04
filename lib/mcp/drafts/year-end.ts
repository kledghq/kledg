/**
 * Draft-level tools of the year-end work (docs/provisions-et-subventions.md):
 * record a provision or an impairment and the balance it requires at a
 * closing, record an investment grant, and prepare the year-end entries
 * (dotations, reprises, grant transfers) as DRAFTS. Thin wrappers over
 * lib/provisions/manage-provisions.service.ts,
 * lib/investment-grants/manage-investment-grants.service.ts and
 * lib/year-end/prepare-year-end-entries.service.ts, with the rights of
 * their API routes (entries:create). Validating the drafts and closing
 * the year stay with a person in Kledg (or full control).
 */

import { z } from 'zod'
import { parseInput } from '@/lib/api/zod-fields'
import { AssessmentBodySchema, ProvisionBodySchema, createProvision, saveAssessment } from '@/lib/provisions/manage-provisions.service'
import { PROVISION_CATEGORIES, PROVISION_NATURES } from '@/lib/provisions/rules'
import { GrantBodySchema, createInvestmentGrant } from '@/lib/investment-grants/manage-investment-grants.service'
import { GRANT_SPREADINGS } from '@/lib/investment-grants/schedule'
import { prepareYearEndEntries } from '@/lib/year-end/prepare-year-end-entries.service'
import { fromCents, parseCents } from '@/lib/utils/money'
import { centsFromEuros, eurosInput, kledgPageUrl } from '@/lib/mcp/tool-meta'
import { draftTool, type RegisterDraftTool } from './define'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ')
const fiscalYearId = z.string().min(1, "L'exercice est requis").max(64).describe('Fiscal year id, from list_fiscal_years.')

const NEVER_VALIDATES = 'validates or posts an entry, never closes a fiscal year and never changes a closed fiscal year (409).'
const NEVER_BOOKS = 'books an entry by itself (prepare_year_end_entries prepares them as drafts), validates or posts an entry, or closes a fiscal year.'

const createProvisionTool = draftTool({
  name: 'create_provision',
  title: 'Enregistrer une provision ou une dépréciation',
  summary:
    'Records a provision for risks and charges (category RISK_CHARGE, accounts 151, 152) or an impairment (FIXED_ASSET 29, INVENTORY 39, RECEIVABLE 49, SECURITY 59) with its justification (object and how the amount is estimated, PCG art. 322-1), its origin date and, for a fixed asset followed in Kledg, the asset. Kledg checks the account against the category and the nature of its movements; an impairment of goodwill (2907) is never reversed (PCG art. 214-19). Then record the balance required at the closing with record_provision_assessment.',
  never: NEVER_BOOKS,
  amounts: 'euros',
  input: {
    category: z.enum(PROVISION_CATEGORIES),
    label: z.string().min(1).max(200),
    justification: z.string().min(1).max(4000).describe('Object of the provision and how its amount is estimated.'),
    accountCode: z.string().regex(/^\d{3,10}$/, 'Numéro de compte invalide').describe('Allowance account: 151 or 152, 29..., 39..., 49..., 59...'),
    nature: z.enum(PROVISION_NATURES).optional().describe('OPERATING, FINANCIAL or EXCEPTIONAL; defaults to the usual nature of the account.'),
    taxDeductible: z.boolean().optional(),
    fixedAssetId: z.string().max(64).optional().describe('Fixed asset impaired (FIXED_ASSET only).'),
    customer: z.string().max(40).optional().describe('Customer auxiliary account (RECEIVABLE only), from list_doubtful_receivables.'),
    openedOn: day.describe('Origin of the risk or of the loss of value.'),
    closedOn: day.optional().describe('End of the risk, to reverse the whole balance.'),
    alreadyBooked: eurosInput.min(0).optional().describe('Balance already booked before Kledg followed it, in euros.'),
  },
  permission: { entries: ['create'] },
  destructive: false,
  idempotent: false,
  async execute(args) {
    const body = parseInput(ProvisionBodySchema, {
      category: args.category,
      label: args.label,
      justification: args.justification,
      accountCode: args.accountCode,
      nature: args.nature,
      taxDeductible: args.taxDeductible,
      fixedAssetId: args.fixedAssetId ?? null,
      tiersCode: args.customer,
      openedOn: args.openedOn,
      closedOn: args.closedOn,
      carriedCents: args.alreadyBooked === undefined ? undefined : centsFromEuros(args.alreadyBooked, 'Montant déjà comptabilisé'),
    })
    const provision = await createProvision(args.companyId, body)
    return {
      provisionId: provision.id,
      changes: { provisionCreated: provision.id, category: provision.category, account: provision.accountCode, nature: provision.nature, taxDeductible: provision.taxDeductible, reversible: provision.reversible },
      reviewUrl: kledgPageUrl(args.companyId, 'provisions'),
      message: `« ${provision.label} » enregistrée : indiquez le montant requis à la clôture, puis préparez les écritures.`,
    }
  },
  audit: (_args, result) => ({ provisionId: result.provisionId }),
})

const recordAssessmentTool = draftTool({
  name: 'record_provision_assessment',
  title: 'Évaluer une provision à la clôture',
  summary:
    'Records the balance a provision or an impairment requires at the closing of a fiscal year (best estimate reviewed at each closing, PCG art. 322-1), or, for the impairment of a fixed asset followed in Kledg, its current value: the impairment is then the excess of the net book value over it (PCG art. 214-15). Give exactly one of requiredBalance and currentValue. It replaces the assessment of that year; a draft entry linked to it is deleted, to be prepared again with prepare_year_end_entries; once its entry is validated, the change is refused (409) until the entry is reversed.',
  never: NEVER_VALIDATES,
  amounts: 'euros',
  input: {
    provisionId: z.string().min(1).max(64).describe('Provision id, from get_year_end_inventory.'),
    fiscalYearId,
    requiredBalance: eurosInput.min(0).optional().describe('Balance required at the closing, in euros.'),
    currentValue: eurosInput.min(0).optional().describe('Current value of the fixed asset at the closing, in euros.'),
    basis: z.string().max(2000).optional().describe('How the amount was estimated (kept with the assessment).'),
  },
  permission: { entries: ['create'] },
  destructive: true,
  idempotent: true,
  async execute(args) {
    const body = parseInput(AssessmentBodySchema, {
      fiscalYearId: args.fiscalYearId,
      amountCents: args.requiredBalance === undefined ? undefined : centsFromEuros(args.requiredBalance, 'Montant requis'),
      currentValueCents: args.currentValue === undefined ? undefined : centsFromEuros(args.currentValue, 'Valeur actuelle'),
      basis: args.basis,
    })
    const saved = await saveAssessment(args.companyId, args.provisionId, body)
    return {
      changes: { provisionId: saved.provisionId, fiscalYearId: saved.fiscalYearId, requiredBalance: fromCents(saved.amountCents), currentValue: saved.currentValueCents === null ? null : fromCents(saved.currentValueCents) },
      reviewUrl: kledgPageUrl(args.companyId, 'year-end'),
      message: 'Évaluation enregistrée : préparez les écritures de clôture (brouillons) puis faites-les valider dans Kledg.',
    }
  },
  audit: (_args, result) => ({ provisionId: result.changes.provisionId, fiscalYearId: result.changes.fiscalYearId }),
})

const createGrantTool = draftTool({
  name: 'create_investment_grant',
  title: 'Enregistrer une subvention d’investissement',
  summary:
    'Records an investment grant (account 131 by default, 138 possible; transfers to 139 and income to 747 by default) with its amount, grant date and spreading: ASSET follows the depreciation of the financed fixed asset (PCG art. 312-1), LINEAR over a duration in years, INALIENABILITY over the inalienability period for a non-depreciable asset, TENTHS by tenths without such clause. The share of each fiscal year is booked by prepare_year_end_entries, as a draft.',
  never: NEVER_BOOKS,
  amounts: 'euros',
  input: {
    label: z.string().min(1).max(200),
    grantor: z.string().max(200).optional(),
    amount: eurosInput.positive().describe('Grant amount, in euros.'),
    grantedOn: day,
    spreading: z.enum(GRANT_SPREADINGS),
    fixedAssetId: z.string().max(64).optional().describe('Financed fixed asset (required for ASSET).'),
    durationYears: z.number().int().min(1).max(100).optional().describe('Years, for LINEAR and INALIENABILITY.'),
    accountCode: z.string().max(10).optional(),
    transferAccountCode: z.string().max(10).optional(),
    incomeAccountCode: z.string().max(10).optional(),
    alreadyTransferred: eurosInput.min(0).optional().describe('Share already transferred to the result before Kledg followed it, in euros.'),
    notes: z.string().max(2000).optional(),
  },
  permission: { entries: ['create'] },
  destructive: false,
  idempotent: false,
  async execute(args) {
    const body = parseInput(GrantBodySchema, {
      label: args.label,
      grantor: args.grantor,
      amountCents: centsFromEuros(args.amount, 'Montant de la subvention'),
      grantedOn: args.grantedOn,
      spreading: args.spreading,
      fixedAssetId: args.fixedAssetId ?? null,
      durationYears: args.durationYears ?? null,
      accountCode: args.accountCode,
      transferAccountCode: args.transferAccountCode,
      incomeAccountCode: args.incomeAccountCode,
      carriedCents: args.alreadyTransferred === undefined ? undefined : centsFromEuros(args.alreadyTransferred, 'Montant déjà repris'),
      notes: args.notes,
    })
    const grant = await createInvestmentGrant(args.companyId, body)
    return {
      grantId: grant.id,
      changes: { grantCreated: grant.id, amount: fromCents(parseCents(grant.amount.toString()) ?? 0), spreading: grant.spreading, accounts: { grant: grant.accountCode, transfer: grant.transferAccountCode, income: grant.incomeAccountCode } },
      reviewUrl: kledgPageUrl(args.companyId, 'investment-grants'),
      message: `Subvention « ${grant.label} » enregistrée : sa quote-part sera préparée avec les écritures de clôture.`,
    }
  },
  audit: (_args, result) => ({ grantId: result.grantId }),
})

const prepareYearEndTool = draftTool({
  name: 'prepare_year_end_entries',
  title: 'Préparer les écritures de clôture',
  summary:
    'Prepares the year-end entries of a fiscal year as DRAFTS in the OD journal on its last day: dotations and reprises of the provisions and impairments assessed (681/686/687, 781/786/787) and the shares of investment grants transferred to the result (139 to 747). Idempotent: a second call creates nothing more; a linked draft that no longer matches is replaced; a validated entry that no longer matches is reported, never changed. Answers the drafts created and the items skipped with the reason. A person then checks and validates the drafts in Kledg; the closing refuses a year that still holds drafts.',
  never: NEVER_VALIDATES,
  amounts: 'euros',
  input: { fiscalYearId },
  permission: { entries: ['create'] },
  destructive: true,
  idempotent: true,
  async execute(args) {
    const result = await prepareYearEndEntries(args.companyId, args.fiscalYearId)
    return {
      changes: {
        draftsCreated: result.created.map((c) => ({ kind: c.kind, itemId: c.itemId, label: c.label, entryId: c.entryId, amount: fromCents(c.cents), movement: c.kind === 'grant' ? 'transfer' : c.cents > 0 ? 'dotation' : 'reprise' })),
        skipped: result.skipped,
      },
      reviewUrl: kledgPageUrl(args.companyId, 'year-end'),
      message:
        result.created.length > 0
          ? `${result.created.length} écriture(s) préparée(s) en brouillon : elles doivent être vérifiées et validées dans Kledg.`
          : 'Aucune écriture à préparer : tout est à jour, ou des évaluations manquent encore.',
    }
  },
  audit: (args, result) => ({ fiscalYearId: args.fiscalYearId, entryIds: result.changes.draftsCreated.map((d) => d.entryId) }),
})

export function registerYearEndDraftTools(register: RegisterDraftTool) {
  register(createProvisionTool)
  register(recordAssessmentTool)
  register(createGrantTool)
  register(prepareYearEndTool)
}
