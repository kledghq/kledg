/**
 * Shapes of the deadline calendar (lib/deadlines/engine.ts), shared by the
 * engine, the API, the dashboard widget and the Échéances page. Types only.
 */

export const DEADLINE_CATEGORIES = ['tva', 'is', 'liasse', 'cfe', 'cvae', 'juridique'] as const
export type DeadlineCategory = (typeof DEADLINE_CATEGORIES)[number]

export const DEADLINE_CATEGORY_LABELS: Record<DeadlineCategory, string> = {
  tva: 'TVA',
  is: 'IS',
  liasse: 'Liasse',
  cfe: 'CFE',
  cvae: 'CVAE',
  juridique: 'Juridique',
}

/** An official text a rule comes from. */
export interface DeadlineSource {
  /** "CGI, art. 1668", "BOI-IS-DECLA-20-10-10", "impots.gouv.fr"... */
  label: string
  url: string
}

/** A rule of the calendar: where a family of deadlines comes from. */
export interface DeadlineRule {
  id: string
  category: DeadlineCategory
  /** The official form or obligation: CA3, 2572, 2065... */
  form: string
  /** The rule in one or two French sentences, as the texts state it. */
  summary: string
  sources: DeadlineSource[]
}

export interface Deadline {
  /** Stable: rule and period, so a list can key rows on it. */
  id: string
  /** The day to act by (yyyy-mm-dd), already postponed when the rule says so. */
  date: string
  /** The day the text gives, before postponement (equal to `date` when not moved). */
  legalDate: string
  /** What to do, in French ("Déclaration de TVA de mars 2026"). */
  label: string
  form: string
  category: DeadlineCategory
  ruleId: string
  /**
   * The day is a default because it depends on information Kledg does not
   * hold (the CA3 day of the company): shown as indicative.
   */
  estimated: boolean
  /** When the deadline applies only in some cases ("Si l'IS de l'exercice précédent dépasse 3 000 €"). */
  condition?: string
  /** Extra information shown with the deadline (online filing extension, options). */
  note?: string
  /** Later day the administration grants for an online filing, when it exists. */
  extendedDate?: string
  /** Derived from a fiscal year Kledg extrapolated (the next one is not created yet). */
  projected: boolean
}
