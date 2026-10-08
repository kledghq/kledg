/**
 * The bank account selected for a company (POST /api/banking/select-account).
 *
 * A company may hold several connections (one per provider): the selected
 * account is stored on its own connection and cleared on the others, in one
 * transaction, so at most one account is selected at a time.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'

/** Body: the company and the account (Kledg id, provider id or IBAN); empty or null clears the selection. */
export const SelectBankAccountSchema = z.object({
  companyId: z.string().optional(),
  accountId: z.string().max(200, 'Compte bancaire invalide.').nullish(),
})

const NO_BANK_CONNECTION_MESSAGE = "Aucune banque n'est connectée à cette société : connectez-en une depuis la page Banque."
const SELECTED_ACCOUNT_NOT_FOUND_MESSAGE = "Ce compte bancaire n'appartient à aucune connexion de la société."

export interface SelectedBankAccount {
  success: true
  selectedAccountId: string | null
  selectedAccount: { id: string; iban: string | null; name: string } | null
}

export async function selectBankAccount(companyId: string, accountRef: string | null | undefined): Promise<SelectedBankAccount> {
  const connections = await prisma.bankConnection.findMany({
    where: { companyId },
    select: {
      id: true,
      bankAccounts: { select: { id: true, externalAccountId: true, iban: true, name: true } },
    },
  })
  if (connections.length === 0) throw new NotFoundError(NO_BANK_CONNECTION_MESSAGE)

  let selected: { id: string; iban: string | null; name: string; connectionId: string } | null = null
  if (accountRef) {
    for (const connection of connections) {
      const account = connection.bankAccounts.find(
        (a) => a.id === accountRef || a.externalAccountId === accountRef || a.iban === accountRef,
      )
      if (account) {
        selected = { id: account.id, iban: account.iban, name: account.name, connectionId: connection.id }
        break
      }
    }
    if (!selected) throw new ValidationError(SELECTED_ACCOUNT_NOT_FOUND_MESSAGE)
  }

  await prisma.$transaction([
    prisma.bankConnection.updateMany({
      where: { companyId, ...(selected ? { id: { not: selected.connectionId } } : {}) },
      data: { selectedAccountId: null },
    }),
    ...(selected
      ? [prisma.bankConnection.update({ where: { id: selected.connectionId }, data: { selectedAccountId: selected.id }, select: { id: true } })]
      : []),
  ])

  return {
    success: true,
    selectedAccountId: selected?.id ?? null,
    selectedAccount: selected ? { id: selected.id, iban: selected.iban, name: selected.name } : null,
  }
}
