/**
 * A small ledger with third-party accounts for the lettering and report
 * database tests: a company, its fiscal year, journals, accounts and
 * validated entries booked through the entry services. Fictitious data.
 */

type Prisma = typeof import('@/lib/prisma').prisma
type EntryService = typeof import('@/lib/accounting/services/entry-lifecycle.service')

export interface LineSpec {
  code: string
  debit?: string
  credit?: string
  aux?: [string, string]
  label?: string
}

export interface Ledger {
  companyId: string
  fiscalYearId: string
  accounts: Record<string, string>
  journals: Record<string, string>
  /** Books an entry (validated unless told otherwise); `line(code)` is the id of its line on that account. */
  entry: (
    journal: string,
    date: string,
    description: string,
    lines: LineSpec[],
    status?: 'draft' | 'validated',
  ) => Promise<{ id: string; line: (code: string) => string }>
}

export const LEDGER_ACCOUNTS: Array<[string, string]> = [
  ['101300', 'Capital souscrit appelé versé'],
  ['401000', 'Fournisseurs'],
  ['411000', 'Clients'],
  ['411DUPONT', 'Client Dupont'],
  ['445660', 'TVA déductible'],
  ['445710', 'TVA collectée'],
  ['467000', 'Autres comptes débiteurs ou créditeurs'],
  ['512000', 'Banque'],
  ['606100', 'Fournitures'],
  ['706000', 'Prestations de services'],
]

export async function bookLedger(
  prisma: Prisma,
  svc: EntryService,
  options: { siren: string; slug: string; year?: number },
): Promise<Ledger> {
  const year = options.year ?? 2026
  const company = await prisma.company.create({ data: { name: options.slug, slug: options.slug, siren: options.siren } })
  const fy = await prisma.fiscalYear.create({
    data: { companyId: company.id, year, startDate: new Date(`${year}-01-01T00:00:00Z`), endDate: new Date(`${year}-12-31T00:00:00Z`) },
  })
  const journals: Record<string, string> = {}
  for (const [code, label] of [['AN', 'À-nouveaux'], ['VE', 'Ventes'], ['AC', 'Achats'], ['BQ', 'Banque'], ['OD', 'Opérations diverses']]) {
    journals[code] = (await prisma.journal.create({ data: { companyId: company.id, code, label } })).id
  }
  const accounts: Record<string, string> = {}
  for (const [code, label] of LEDGER_ACCOUNTS) {
    accounts[code] = (await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label } })).id
  }
  const entry: Ledger['entry'] = async (journal, date, description, lines, status = 'validated') => {
    const created = await svc.createEntry({
      companyId: company.id,
      journalId: journals[journal],
      date,
      description,
      status,
      lines: lines.map((l) => ({
        accountId: accounts[l.code],
        debit: l.debit ?? '0',
        credit: l.credit ?? '0',
        description: l.label ?? description,
        auxiliaryAccountNumber: l.aux?.[0] ?? null,
        auxiliaryAccountLabel: l.aux?.[1] ?? null,
      })),
    })
    const rows = await prisma.entryLine.findMany({ where: { accountingEntryId: created.id }, select: { id: true, account: { select: { code: true } } } })
    return {
      id: created.id,
      line: (code: string) => {
        const row = rows.find((r) => r.account.code === code)
        if (!row) throw new Error(`No line on ${code}`)
        return row.id
      },
    }
  }
  return { companyId: company.id, fiscalYearId: fy.id, accounts, journals, entry }
}
