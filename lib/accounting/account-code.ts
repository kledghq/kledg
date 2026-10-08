/**
 * The one format of an account number (KLEDG-R3-QUAL-27): the class digit
 * (1 to 9, PCG art. 931-1 and 932-1), then 1 to 19 digits or upper case
 * letters. Kledg's own charts are numeric, but a chart imported from a FEC
 * (CompteNum, LPF art. A47 A-1, alphanumeric) or extended by Kledg (62568
 * padded to the length of the chart) may hold longer or alphanumeric
 * numbers: every form and API accepts what the chart can hold. Forms that
 * need one class add it with `accountCodeOfClass` (lib/api/zod-fields.ts).
 *
 * Pure, no imports: usable on the client.
 */

export const ACCOUNT_CODE_PATTERN = /^[1-9][0-9A-Z]{1,19}$/

export const ACCOUNT_CODE_MESSAGE = 'Numéro de compte invalide : 2 à 20 chiffres ou lettres majuscules, en commençant par le chiffre de la classe.'

export function isAccountCode(code: unknown): code is string {
  return typeof code === 'string' && ACCOUNT_CODE_PATTERN.test(code)
}
