/**
 * Checks credentials typed by the user with the bank before they are saved
 * (listing the accounts proves they work). The API contract is an answer,
 * not an error: `{ valid: false, error }` carries a French reason
 * (lib/banking/errors.ts errorReason), never the provider's message, which
 * goes to the server log only.
 */

import { z } from 'zod'
import { createBankProvider } from '@/lib/banking/providers'
import { errorReason } from '@/lib/banking/errors'
import { TypedCredentials } from '@/lib/integrations/create-integration.service'

export const VerifyBankCredentialsSchema = z.object({
  /** Providers whose credentials can be checked before saving (Revolut goes through OAuth). */
  provider: z
    .string({ message: 'Choisissez le fournisseur : Qonto ou Ponto.' })
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(['QONTO', 'PONTO'], { message: 'Fournisseur non pris en charge : choisissez Qonto ou Ponto.' })),
  credentials: TypedCredentials,
})
export type VerifyBankCredentialsInput = z.infer<typeof VerifyBankCredentialsSchema>

export type VerifyBankCredentialsResult =
  | { valid: true; organization: { bankAccountsCount: number } }
  | { valid: false; error: string }

export async function verifyBankCredentials(input: VerifyBankCredentialsInput): Promise<VerifyBankCredentialsResult> {
  try {
    const accounts = await createBankProvider(input.provider, input.credentials).listAccounts()
    return { valid: true, organization: { bankAccountsCount: accounts.length } }
  } catch (error) {
    // Refused credentials are an expected answer here, not a failure of the request
    return { valid: false, error: errorReason(error) }
  }
}
