/**
 * Query and body schemas of the year-end routes (provisions, impairments,
 * investment grants and their year-end entries): the fiscal year of the
 * closing, checked against the company by the services.
 */

import { z } from 'zod'

/** ?fiscalYearId= */
export const FiscalYearQuerySchema = z.object({ fiscalYearId: z.string({ error: "L'exercice est requis" }).min(1, "L'exercice est requis").max(64) })

/** { companyId, fiscalYearId } */
export const PrepareYearEndBodySchema = z.object({ companyId: z.string(), fiscalYearId: z.string({ error: "L'exercice est requis" }).min(1, "L'exercice est requis").max(64) })
