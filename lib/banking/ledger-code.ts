/**
 * The 512 account a bank account receives when a sync creates it, so a
 * company with one fitting bank ledger account never sees "Non associé":
 * - a euro account gets the company's default bank account
 *   (defaultBankAccountCode) when it exists, else its only detailed 512
 *   account that is not a currency account (PCG: 5121 "Comptes en euros",
 *   5124 "Comptes en devises"; the parent 512 holds no entry);
 * - an account in another currency gets the only 5124 account;
 * - else null: with several candidates the choice stays explicit, on the
 *   Banque page.
 * Pure; `codes` are the 512 accounts of the company's current fiscal year.
 */
export function pickLedgerCodeForBankAccount(codes: string[], defaultCode: string | null, currency: string): string | null {
  const detailed = codes.filter((code) => code.length > 3)
  if (currency.toUpperCase() !== 'EUR') {
    const foreign = detailed.filter((code) => code.startsWith('5124'))
    return foreign.length === 1 ? foreign[0] : null
  }
  if (defaultCode && codes.includes(defaultCode)) return defaultCode
  const euro = detailed.filter((code) => !code.startsWith('5124'))
  return euro.length === 1 ? euro[0] : null
}
