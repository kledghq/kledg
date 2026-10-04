/**
 * French plurals for counts shown to users: "1 relevé", "3 relevés",
 * never "relevé(s)". French rule: 0 and 1 take the singular ("0 erreur",
 * "1 erreur"), from 2 on the plural.
 *
 * Pure, no imports: usable on the server and in client components.
 */

/** True when a French count takes the plural (2 and more, in absolute value). */
export function isPlural(count: number): boolean {
  return Math.abs(count) >= 2
}

/** The word alone, singular or plural for the count: pluralWord(3, 'créée') is "créées". */
export function pluralWord(count: number, singular: string, pluralForm = `${singular}s`): string {
  return isPlural(count) ? pluralForm : singular
}

/**
 * The count and its noun: plural(1, 'relevé') is "1 relevé", plural(3,
 * 'relevé') "3 relevés", plural(2, 'nouveau compte', 'nouveaux comptes')
 * for irregular forms.
 */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${pluralWord(count, singular, pluralForm)}`
}
