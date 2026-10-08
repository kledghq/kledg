/**
 * Request bodies of the fixed asset routes (app/api/fixed-assets/**). The
 * schemas check the JSON types only, with French messages; the services
 * read the values (lib/fixed-assets/inputs.ts: exact cents, decimal rates,
 * dates) and apply the business rules, so the MCP server, which calls the
 * same services, gets the same checks.
 */

import { z } from 'zod'

const invalid = (field: string) => ({ error: `${field} invalide` })

/** Optional text; null clears it. */
const text = (field: string) => z.string(invalid(field)).nullish()
/** An amount, rate, duration or coefficient: a number or a decimal string ("1 234,56"). */
const numeric = (field: string) => z.union([z.number(), z.string()], invalid(field)).nullish()
const flag = (field: string) => z.boolean(invalid(field)).nullish()

/** Fields of a fixed asset, as the form and the MCP server send them. */
const fixedAssetFields = {
  label: text('Libellé'),
  comment: text('Commentaire'),
  acquisitionDate: text("Date d'acquisition"),
  acquisitionValue: numeric("Valeur d'acquisition"),
  amortizableAmount: numeric('Montant amortissable'),
  disposalDate: text('Date de cession'),
  depreciationRate: numeric("Taux d'amortissement"),
  depreciationDuration: numeric("Durée d'amortissement"),
  depreciationMethod: text("Mode d'amortissement"),
  decliningCoefficient: numeric('Coefficient dégressif'),
  depreciationStartDate: text("Date de début d'amortissement"),
  assetAccountId: text("Compte d'immobilisation"),
  depreciationAccountId: text("Compte d'amortissement"),
  expenseAccountId: text('Compte de dotation'),
  isFullyPaid: flag('Indicateur de paiement'),
}

/** POST /api/fixed-assets (the service names the missing required fields). */
export const CreateFixedAssetSchema = z.object(fixedAssetFields)

/** PATCH /api/fixed-assets/[id]: only the fields present change. */
export const UpdateFixedAssetSchema = z.object({ ...fixedAssetFields, isActive: flag('Indicateur actif') })
export type UpdateFixedAssetInput = z.infer<typeof UpdateFixedAssetSchema>

/** POST /api/fixed-assets/[id]/depreciation: the amount of one period, the plan's when absent. */
export const SaveDepreciationRecordSchema = z.object({
  fiscalYearId: z.string({ error: "Choisissez l'exercice de l'amortissement" }).min(1, "Choisissez l'exercice de l'amortissement"),
  periodType: z.enum(['month', 'year'], { error: "Type de période invalide : 'month' (mois) ou 'year' (exercice)" }),
  monthIndex: z.number(invalid('Mois')).int(invalid('Mois')).nullish(),
  amount: z.number(invalid('Montant')).nullish(),
  note: text('Note'),
})
export type SaveDepreciationRecordInput = z.infer<typeof SaveDepreciationRecordSchema>

/** PATCH /api/fixed-assets/[id]/depreciation/[entryId]: links (or unlinks with null) an entry. */
export const LinkDepreciationEntrySchema = z.object({
  accountingEntryId: z.string(invalid('Écriture')).nullish(),
})
