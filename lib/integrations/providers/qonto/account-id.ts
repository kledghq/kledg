/**
 * Qonto bank accounts have a UUID id and an IBAN. The sandbox masks IBANs
 * (FRXXXX...), so the id is the only reliable key there.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isQontoAccountId(value: string): boolean {
  return UUID.test(value)
}

/** A masked IBAN as returned by the sandbox: country code then X characters. */
export function isMaskedIban(iban: string | null | undefined): boolean {
  return !iban || /^[A-Z]{2}X{4,}/.test(iban.replace(/\s/g, ''))
}
