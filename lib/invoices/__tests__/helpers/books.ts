/**
 * Books for the invoice database tests: a company with an open 2026 fiscal
 * year, a closed 2025 one, the purchase, sales, bank and miscellaneous
 * journals, the accounts invoices post to, a customer and a supplier, and a
 * helper booking a validated bank payment reconciled with a transaction.
 * Fictitious data.
 */

type Prisma = typeof import('@/lib/prisma').prisma
type EntryService = typeof import('@/lib/accounting/services/entry-lifecycle.service')

export const BOOK_ACCOUNTS: Array<[string, string]> = [
  ['2183', 'Matériel de bureau et matériel informatique'],
  ['401000', 'Fournisseurs'],
  ['411000', 'Clients'],
  ['445620', 'TVA sur immobilisations'],
  ['445660', 'TVA sur autres biens et services'],
  ['445710', 'TVA collectée'],
  ['445740', 'TVA collectée en attente d’encaissement'],
  ['512000', 'Banque'],
  ['6064', 'Fournitures administratives'],
  ['6241', 'Transports sur achats'],
  ['706000', 'Prestations de services'],
  ['707000', 'Ventes de marchandises'],
]

export interface Books {
  companyId: string
  fiscalYearId: string
  closedFiscalYearId: string
  accounts: Record<string, string>
  journals: Record<string, string>
  customerId: string
  supplierId: string
  /** A validated bank entry on the tiers account (401 debit or 411 credit), reconciled with a transaction; returns its tiers line id. */
  payment: (kind: 'customer' | 'supplier', date: string, amount: string, options?: { status?: 'draft' | 'validated'; reconciled?: boolean; aux?: string | null }) => Promise<string>
}

export async function seedBooks(prisma: Prisma, svc: EntryService, options: { siren: string; slug: string }): Promise<Books> {
  const company = await prisma.company.create({ data: { name: options.slug, slug: options.slug, siren: options.siren, vatNumber: null } })
  const closed = await prisma.fiscalYear.create({
    data: { companyId: company.id, year: 2025, startDate: new Date('2025-01-01T00:00:00Z'), endDate: new Date('2025-12-31T00:00:00Z') },
  })
  const fy = await prisma.fiscalYear.create({
    data: { companyId: company.id, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') },
  })
  const journals: Record<string, string> = {}
  for (const [code, label] of [['AC', 'Achats'], ['VE', 'Ventes'], ['BQ', 'Banque'], ['OD', 'Opérations diverses']]) {
    journals[code] = (await prisma.journal.create({ data: { companyId: company.id, code, label } })).id
  }
  const accounts: Record<string, string> = {}
  for (const [code, label] of BOOK_ACCOUNTS) {
    accounts[code] = (await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label } })).id
    await prisma.account.create({ data: { companyId: company.id, fiscalYearId: closed.id, code, label } })
  }
  // Closed after its chart exists: the closing lock refuses writes in a closed year
  await prisma.fiscalYear.update({ where: { id: closed.id }, data: { isClosed: true, closedAt: new Date('2026-02-01T00:00:00Z') } })
  const customer = await prisma.tiers.create({ data: { companyId: company.id, kind: 'CUSTOMER', name: 'Martin SA', auxiliaryAccountNumber: 'C00001' } })
  const supplier = await prisma.tiers.create({
    data: { companyId: company.id, kind: 'SUPPLIER', name: 'Papeterie Durand', auxiliaryAccountNumber: 'F00001', defaultAccountCode: '6064' },
  })
  const connection = await prisma.bankConnection.create({ data: { companyId: company.id, provider: 'MANUAL' } })
  const bankAccount = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: `acc-${options.slug}`, name: 'Compte courant' } })
  let counter = 0

  const payment: Books['payment'] = async (kind, date, amount, opts = {}) => {
    const tiersCode = kind === 'customer' ? '411000' : '401000'
    const aux = opts.aux === undefined ? null : opts.aux
    const created = await svc.createEntry({
      companyId: company.id,
      journalId: journals.BQ,
      date,
      description: `Règlement ${kind}`,
      status: opts.status ?? 'validated',
      lines:
        kind === 'customer'
          ? [
              { accountId: accounts['512000'], debit: amount, credit: '0' },
              { accountId: accounts[tiersCode], debit: '0', credit: amount, auxiliaryAccountNumber: aux },
            ]
          : [
              { accountId: accounts[tiersCode], debit: amount, credit: '0', auxiliaryAccountNumber: aux },
              { accountId: accounts['512000'], debit: '0', credit: amount },
            ],
    })
    if (opts.reconciled !== false) {
      counter += 1
      await prisma.bankTransaction.create({
        data: {
          bankAccountId: bankAccount.id,
          externalTransactionId: `tx-${options.slug}-${counter}`,
          amount,
          date: new Date(`${date}T00:00:00Z`),
          side: kind === 'customer' ? 'credit' : 'debit',
          reconciled: true,
          reconciledWith: created.id,
        },
      })
    }
    const line = await prisma.entryLine.findFirstOrThrow({ where: { accountingEntryId: created.id, accountId: accounts[tiersCode] }, select: { id: true } })
    return line.id
  }

  return {
    companyId: company.id,
    fiscalYearId: fy.id,
    closedFiscalYearId: closed.id,
    accounts,
    journals,
    customerId: customer.id,
    supplierId: supplier.id,
    payment,
  }
}
