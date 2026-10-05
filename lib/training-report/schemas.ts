/**
 * What the training organisation enters for its bilan pédagogique et
 * financier (cerfa 10443*17, notice 50199#17): the frames the books cannot
 * give. Stored as JSON in training_reports.data, one row per closed fiscal
 * year. Pure (zod only): the page, the API and the MCP tool use the same
 * schema; a stored value that does not parse falls back to empty frames.
 */

import { z } from 'zod'

const count = z.number({ error: 'Un nombre entier est attendu' }).int('Un nombre entier est attendu').min(0, 'Pas de nombre négatif').max(10_000_000, 'Nombre trop grand')
/** Trainees or trainers and hours (hours rounded to the whole hour, notice frame E). */
export const CountHours = z.object({ count: count.default(0), hours: count.default(0) })
export type CountHours = z.infer<typeof CountHours>

const pair = CountHours.default({ count: 0, hours: 0 })
const centsOrNull = z.number().int().min(0).max(100_000_000_000_000).nullable().default(null)

export const TrainingReportDataSchema = z.object({
  /** Frame B: training given wholly or partly at a distance during the period. */
  distanceLearning: z.boolean().nullable().default(null),
  /** Frame D overrides; null: the figure read in the books. */
  charges: z
    .object({ totalCents: centsOrNull, trainerSalariesCents: centsOrNull, trainingPurchasesCents: centsOrNull })
    .default({ totalCents: null, trainerSalariesCents: null, trainingPurchasesCents: null }),
  /** Frame E: people of the organisation, people outside it under subcontracting. */
  trainers: z.object({ internal: pair, external: pair }).default({ internal: { count: 0, hours: 0 }, external: { count: 0, hours: 0 } }),
  /** Frame F-1: type of trainees. */
  trainees: z
    .object({ employees: pair, apprentices: pair, jobSeekers: pair, individuals: pair, others: pair })
    .default({ employees: { count: 0, hours: 0 }, apprentices: { count: 0, hours: 0 }, jobSeekers: { count: 0, hours: 0 }, individuals: { count: 0, hours: 0 }, others: { count: 0, hours: 0 } }),
  /** Frame F-2: trainees whose training the organisation entrusted to another one. */
  subcontracted: pair,
  /** Frame F-3: general objective. */
  objectives: z
    .object({
      rncp: pair,
      rncpLevel6to8: pair,
      rncpLevel5: pair,
      rncpLevel4: pair,
      rncpLevel3: pair,
      rncpLevel2: pair,
      rncpCqpWithoutLevel: pair,
      rs: pair,
      cqpNotRegistered: pair,
      other: pair,
      skillsAssessment: pair,
      vae: pair,
    })
    .default({
      rncp: { count: 0, hours: 0 },
      rncpLevel6to8: { count: 0, hours: 0 },
      rncpLevel5: { count: 0, hours: 0 },
      rncpLevel4: { count: 0, hours: 0 },
      rncpLevel3: { count: 0, hours: 0 },
      rncpLevel2: { count: 0, hours: 0 },
      rncpCqpWithoutLevel: { count: 0, hours: 0 },
      rs: { count: 0, hours: 0 },
      cqpNotRegistered: { count: 0, hours: 0 },
      other: { count: 0, hours: 0 },
      skillsAssessment: { count: 0, hours: 0 },
      vae: { count: 0, hours: 0 },
    }),
  /** Frame F-4: the five main specialities (NSF code, three digits) and the others. */
  specialities: z
    .array(z.object({ code: z.string().trim().regex(/^\d{3}$/, 'Le code de spécialité NSF a trois chiffres'), label: z.string().trim().min(1, 'Le libellé est requis').max(200), count, hours: count }))
    .max(5, 'Cinq spécialités au plus : les autres vont dans « Autres spécialités »')
    .default([]),
  otherSpecialities: pair,
  /** Frame G: training entrusted to the organisation by another training organisation. */
  entrusted: pair,
  note: z.string().max(2000).nullable().default(null),
})
export type TrainingReportData = z.infer<typeof TrainingReportDataSchema>

export const EMPTY_TRAINING_REPORT: TrainingReportData = TrainingReportDataSchema.parse({})

/** The stored JSON read leniently: an unreadable value gives empty frames. */
export function parseTrainingReportData(json: unknown): TrainingReportData {
  const parsed = TrainingReportDataSchema.safeParse(json ?? {})
  return parsed.success ? parsed.data : EMPTY_TRAINING_REPORT
}
