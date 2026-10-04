/**
 * The ledger account (Banques, PCG art. 512) that holds the entries of a
 * bank account in a fiscal year.
 *
 * One rule for every screen: the bank account's own 512 mapping
 * (BankAccount.ledgerAccountCode) when it is set and exists in that fiscal
 * year, else the company's default bank account (resolveBankLedgerAccount:
 * defaultBankAccountCode, then the first detailed 512 account). A prefix
 * match on "51" is never used: it can pick the parent class 51 or 512,
 * which holds no entry, or a 511 account (valeurs à l'encaissement).
 */

import { prisma } from '@/lib/prisma'
import { resolveBankLedgerAccount } from '@/lib/reconciliation/service'
import { pickLedgerCodeForBankAccount } from './ledger-code'

export interface LedgerAccountRef {
  id: string
  code: string
  label: string
}

const SELECT = { id: true, code: true, label: true } as const

/** Ledger account of one bank account of the company (its mapping, else the company default). */
export async function resolveBankAccountLedger(
  companyId: string,
  fiscalYearId: string,
  bankAccountId: string,
): Promise<LedgerAccountRef | null> {
  const bankAccount = await prisma.bankAccount.findFirst({
    where: { id: bankAccountId, bankConnection: { companyId } },
    select: { ledgerAccountCode: true },
  })
  if (bankAccount?.ledgerAccountCode) {
    const mapped = await prisma.account.findFirst({
      where: { companyId, fiscalYearId, code: bankAccount.ledgerAccountCode },
      select: SELECT,
    })
    if (mapped) return mapped
  }
  return resolveBankLedgerAccount(companyId, fiscalYearId)
}

/**
 * Every bank ledger account in use in a fiscal year: the company default
 * and the mapping of each bank account, without duplicates, default first.
 */
export async function bankLedgerAccountsInUse(companyId: string, fiscalYearId: string): Promise<LedgerAccountRef[]> {
  const [fallback, mappings] = await Promise.all([
    resolveBankLedgerAccount(companyId, fiscalYearId),
    prisma.bankAccount.findMany({
      where: { bankConnection: { companyId }, ledgerAccountCode: { not: null } },
      select: { ledgerAccountCode: true },
    }),
  ])
  const codes = [...new Set(mappings.map((m) => m.ledgerAccountCode).filter((c): c is string => !!c))]
  const mapped = codes.length
    ? await prisma.account.findMany({ where: { companyId, fiscalYearId, code: { in: codes } }, select: SELECT, orderBy: { code: 'asc' } })
    : []
  const result = fallback ? [fallback] : []
  for (const account of mapped) if (!result.some((a) => a.id === account.id)) result.push(account)
  return result
}

/**
 * Loads once what pickLedgerCodeForBankAccount needs for a company: its
 * default bank account and the 512 accounts of its current fiscal year (the
 * most recent open one, else the most recent). Returns the picker.
 */
export async function ledgerCodePickerForNewBankAccounts(companyId: string): Promise<(currency: string) => string | null> {
  const [company, fiscalYear] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { defaultBankAccountCode: true } }),
    prisma.fiscalYear.findFirst({
      where: { companyId },
      orderBy: [{ isClosed: 'asc' }, { year: 'desc' }],
      select: { id: true },
    }),
  ])
  if (!fiscalYear) return () => null
  const accounts = await prisma.account.findMany({
    where: { companyId, fiscalYearId: fiscalYear.id, code: { startsWith: '512' } },
    select: { code: true },
  })
  const codes = accounts.map((a) => a.code)
  return (currency) => pickLedgerCodeForBankAccount(codes, company?.defaultBankAccountCode ?? null, currency)
}
