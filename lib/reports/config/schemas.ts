/**
 * Request bodies of the statement layout routes
 * (app/api/companies/[id]/balance-sheet/config/** and
 * income-statement/config/**), with French messages. The layout services
 * check the account codes and the parent lines.
 */

import { z } from 'zod'
import { ReportVariantSchema } from '../report-query'

const invalid = (field: string) => ({ error: `${field} invalide` })
const text = (field: string) => z.string(invalid(field)).nullish()
const codes = (field: string) => z.array(z.string(invalid(field)), invalid(field))
const lineLabel = z.string({ error: 'Le libellé de la ligne est requis' }).min(1, 'Le libellé de la ligne est requis')
const order = z.number(invalid('Ordre')).int(invalid('Ordre'))
const balanceType = z.enum(['debit', 'credit', 'auto'], { error: 'Sens invalide : debit, credit ou auto' })
const lineType = z.enum(['group', 'sum', 'line'], { error: 'Type de ligne invalide : group, sum ou line' })
const displayType = z.enum(['net', 'brut_amort_net'], { error: "Type d'affichage invalide : net ou brut_amort_net" })
const balanceSheetSection = z.enum(['actif', 'passif'], { error: 'Section invalide : actif ou passif' }).nullish()
const incomeStatementSection = z.enum(['produits', 'charges'], { error: 'Section invalide : produits ou charges' }).nullish()
const flag = (field: string) => z.boolean(invalid(field)).optional()

/** POST .../config/default: the variant whose layout is reset to the PCG default. */
export const ResetLayoutSchema = z.object({ variant: ReportVariantSchema })

/** POST .../balance-sheet/config/line */
export const CreateBalanceSheetLineSchema = z.object({
  reportVariant: ReportVariantSchema,
  parentId: text('Ligne parente'),
  lineLabel,
  lineType: lineType.nullish(),
  formCode: text('Code du formulaire'),
  amortissementFormCode: text("Code du formulaire (amortissements)"),
  accountCodes: codes('Comptes').nullish(),
  excludedAccountCodes: codes('Comptes exclus').nullish(),
  amortissementAccountCodes: codes("Comptes d'amortissement").nullish(),
  filterType: text('Filtre'),
  filterValue: text('Valeur du filtre'),
  balanceType: balanceType.nullish(),
  displayType: displayType.nullish(),
  order: order.nullish(),
  notes: text('Notes'),
  templateId: text('Modèle'),
})
export type CreateBalanceSheetLineBody = z.infer<typeof CreateBalanceSheetLineSchema>

/** PATCH .../balance-sheet/config/line/[lineId]: only the fields present change. */
export const UpdateBalanceSheetLineSchema = z.object({
  section: balanceSheetSection,
  parentId: text('Ligne parente'),
  lineLabel: lineLabel.optional(),
  lineType: lineType.optional(),
  formCode: text('Code du formulaire'),
  amortissementFormCode: text("Code du formulaire (amortissements)"),
  accountCodes: codes('Comptes').optional(),
  excludedAccountCodes: codes('Comptes exclus').optional(),
  amortissementAccountCodes: codes("Comptes d'amortissement").optional(),
  filterType: text('Filtre'),
  filterValue: text('Valeur du filtre'),
  balanceType: balanceType.optional(),
  displayType: displayType.optional(),
  hideLabel: flag('Masquer le libellé'),
  order: order.optional(),
  notes: text('Notes'),
  isActive: flag('Ligne active'),
})

/** POST .../balance-sheet/config: { action: 'create_default', variant } or { action: 'create_line', ...line }. */
export const BalanceSheetConfigActionSchema = z.discriminatedUnion(
  'action',
  [
    z.object({ action: z.literal('create_default'), variant: ReportVariantSchema }),
    CreateBalanceSheetLineSchema.extend({
      action: z.literal('create_line'),
      section: balanceSheetSection,
      hideLabel: flag('Masquer le libellé'),
    }),
  ],
  { error: 'Action inconnue : create_default ou create_line' },
)

/** POST .../balance-sheet/config/history: a snapshot of a line, or the restore of one of its versions. */
export const ConfigHistoryActionSchema = z.object({
  action: z.enum(['create_snapshot', 'restore'], { error: 'Action inconnue : create_snapshot ou restore' }),
  configId: z.string({ error: 'configId est requis' }).min(1, 'configId est requis'),
  version: z.number(invalid('Version')).int(invalid('Version')).optional(),
  changeReason: z.string(invalid('Motif')).optional(),
})

/** GET .../balance-sheet/config/history: the history of a line, one version, or two versions compared. */
export const ConfigHistoryQuerySchema = z.object({
  configId: z.string({ error: 'configId est requis' }),
  version: z.coerce.number(invalid('Version')).int(invalid('Version')).optional(),
  version1: z.coerce.number(invalid('Version')).int(invalid('Version')).optional(),
  version2: z.coerce.number(invalid('Version')).int(invalid('Version')).optional(),
})

/** POST .../balance-sheet/config/templates: save the layout as a template, or apply one. */
export const TemplateActionSchema = z.discriminatedUnion(
  'action',
  [
    z.object({
      action: z.literal('create'),
      name: z.string({ error: 'Le nom du modèle est requis' }).min(1, 'Le nom du modèle est requis').max(200, 'Nom du modèle trop long (200 caractères au plus)'),
      description: z.string(invalid('Description')).max(1000, 'Description trop longue (1000 caractères au plus)').nullish(),
      variant: ReportVariantSchema,
      // Refused when true (lib/reports/config/manage-layouts.service.ts): a company's template stays its own.
      isPublic: z.boolean(invalid('Visibilité')).optional(),
    }),
    z.object({ action: z.literal('apply'), templateId: z.string({ error: 'templateId est requis' }).min(1, 'templateId est requis') }),
  ],
  { error: 'Action inconnue : create ou apply' },
)

/** POST .../income-statement/config/line */
export const CreateIncomeStatementLineSchema = z.object({
  reportVariant: ReportVariantSchema,
  parentId: text('Ligne parente'),
  section: incomeStatementSection,
  lineLabel,
  formCode: text('Code du formulaire'),
  accountCodes: codes('Comptes').nullish(),
  excludedAccountCodes: codes('Comptes exclus').nullish(),
  filterType: text('Filtre'),
  filterValue: text('Valeur du filtre'),
  balanceType: balanceType.nullish(),
  hideLabel: flag('Masquer le libellé'),
  order: order.nullish(),
  notes: text('Notes'),
})

/** POST .../income-statement/config: a line with its account codes, sense and order. */
export const CreateIncomeStatementConfigLineSchema = CreateIncomeStatementLineSchema.extend({
  accountCodes: codes('Comptes'),
  balanceType,
  order,
})

/** PATCH .../income-statement/config/line/[lineId]: only the fields present change. */
export const UpdateIncomeStatementLineSchema = z.object({
  parentId: text('Ligne parente'),
  section: incomeStatementSection,
  lineLabel: lineLabel.optional(),
  formCode: text('Code du formulaire'),
  accountCodes: codes('Comptes').optional(),
  excludedAccountCodes: codes('Comptes exclus').optional(),
  filterType: text('Filtre'),
  filterValue: text('Valeur du filtre'),
  balanceType: balanceType.optional(),
  hideLabel: flag('Masquer le libellé'),
  order: order.optional(),
  notes: text('Notes'),
})
