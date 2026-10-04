/** Display helpers shared by the bank screens. */

interface NamedBankAccount {
  name: string
  displayName?: string | null
  iban?: string | null
}

/**
 * A provider identifier such as Qonto's account slug
 * ("atelier-lumen-compte-principal"): lower case words joined by dashes,
 * no spaces. Banks that give a real name ("Compte courant") never match.
 */
export function isTechnicalName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(name.trim())
}

/** "•••• 3143": the last four characters of an IBAN, enough to tell accounts apart. */
export function ibanTail(iban: string): string {
  const compact = iban.replace(/\s+/g, '')
  return `•••• ${compact.slice(-4)}`
}

/**
 * Name of a bank account for people: the name chosen in Kledg, else the
 * bank's name, unless the bank only gave a technical identifier (Qonto
 * slugs), in which case "Compte •••• 3143" from the IBAN, or "Compte
 * bancaire" without one. A slug is never shown.
 */
export function bankAccountName(account: NamedBankAccount): string {
  const chosen = account.displayName?.trim()
  if (chosen) return chosen
  if (!isTechnicalName(account.name)) return account.name
  if (account.iban && account.iban.replace(/\s+/g, '').length > 4) return `Compte ${ibanTail(account.iban)}`
  return 'Compte bancaire'
}

/** The bank's own name, when it says more than the name shown (a real name, not a slug). */
export function bankAccountSubtitle(account: NamedBankAccount): string | null {
  if (isTechnicalName(account.name)) return null
  return bankAccountName(account) === account.name ? null : account.name
}

export { plural } from '@/lib/utils/plural'

/** File size in French units: "820 o", "12,4 Ko", "1,2 Mo". */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  const one = (value: number) => value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${one(bytes / 1024)} Ko`
  return `${one(bytes / (1024 * 1024))} Mo`
}

/** Qonto statement period "MM-YYYY" as the first day of that month (UTC), or null when malformed. */
export function statementMonth(period: string): Date | null {
  const match = /^(\d{2})-(\d{4})$/.exec(period.trim())
  if (!match) return null
  const month = Number(match[1])
  if (month < 1 || month > 12) return null
  return new Date(Date.UTC(Number(match[2]), month - 1, 1))
}
