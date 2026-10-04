/**
 * Provisions, impairments, investment grants and the year-end entries
 * against PostgreSQL (skipped without the server): a provision assessed,
 * its dotation prepared as a draft (never validated by Kledg), the
 * preparation idempotent, a validated movement fixed until it is reversed,
 * the reprise of the next closing; an impairment computed from the current
 * value of a fixed asset; a grant transferred at the rhythm of the asset's
 * depreciation; doubtful receivables from the aged balance and their
 * transfer to 416; closed years locked by the services and by the database;
 * ids of another company refused; the closing checks warning about what is
 * left. Fictitious data.
 *
 * Sources: PCG art. 322-1 et seq., 214-15 et seq., 214-19, 312-1, 1031-3
 * and 1031-4; CGI art. 39, 1-5°, 42 septies, 272, 1.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('year_end')
})

vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(async () => {}) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedBooks, type Books } from '@/lib/invoices/__tests__/helpers/books'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let provisions: typeof import('@/lib/provisions/manage-provisions.service')
let grants: typeof import('@/lib/investment-grants/manage-investment-grants.service')
let inventory: typeof import('../get-year-end-inventory.service')
let prepare: typeof import('../prepare-year-end-entries.service')
let doubtful: typeof import('@/lib/provisions/doubtful-receivables.service')
let closure: typeof import('@/lib/accounting/fiscal-year-closure/validate-fiscal-year-closure.service')
let deleteAsset: typeof import('@/lib/fixed-assets/delete-fixed-asset.service')

const LITIGATION = {
  category: 'RISK_CHARGE' as const,
  label: 'Litige avec un ancien salarié',
  justification: 'Assignation devant le conseil de prudhommes reçue en mars, estimation de l’avocat.',
  accountCode: '1511',
  openedOn: '2026-03-15',
}

async function linesOf(entryId: string) {
  const lines = await prisma.entryLine.findMany({ where: { accountingEntryId: entryId }, select: { debit: true, credit: true, account: { select: { code: true } } } })
  return lines.map((l) => [l.account.code, l.debit.toString(), l.credit.toString()]).sort()
}

describe.skipIf(!available)('year-end work (PostgreSQL)', () => {
  let books: Books
  let other: Books

  beforeAll(async () => {
    await prepareTestDatabase('year_end')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    provisions = await import('@/lib/provisions/manage-provisions.service')
    grants = await import('@/lib/investment-grants/manage-investment-grants.service')
    inventory = await import('../get-year-end-inventory.service')
    prepare = await import('../prepare-year-end-entries.service')
    doubtful = await import('@/lib/provisions/doubtful-receivables.service')
    closure = await import('@/lib/accounting/fiscal-year-closure/validate-fiscal-year-closure.service')
    deleteAsset = await import('@/lib/fixed-assets/delete-fixed-asset.service')
  })

  beforeEach(async () => {
    await prepareTestDatabase('year_end')
    books = await seedBooks(prisma, svc, { siren: '940000501', slug: 'year-end-a' })
    other = await seedBooks(prisma, svc, { siren: '940000502', slug: 'year-end-b' })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  /** A computer of 10 000 € in service on 1 January 2026, linear over 5 years. */
  async function computer(companyBooks: Books = books) {
    const extra = async (code: string, label: string) =>
      (await prisma.account.create({ data: { companyId: companyBooks.companyId, fiscalYearId: companyBooks.fiscalYearId, code, label } })).id
    return prisma.fixedAsset.create({
      data: {
        companyId: companyBooks.companyId,
        label: 'Serveur de calcul',
        acquisitionDate: new Date('2026-01-01T00:00:00Z'),
        acquisitionValue: 10_000,
        depreciationDuration: 5,
        depreciationStartDate: new Date('2026-01-01T00:00:00Z'),
        assetAccountId: companyBooks.accounts['2183'],
        depreciationAccountId: await extra('28183', 'Matériel de bureau et informatique'),
        expenseAccountId: await extra('6811', 'Dotations aux amortissements'),
      },
    })
  }

  it('prepares the dotation of a provision as a draft, once, and the reprise of the next closing', async () => {
    const created = await provisions.createProvision(books.companyId, LITIGATION)
    expect(created).toMatchObject({ nature: 'OPERATING', taxDeductible: true, reversible: true })

    let view = await inventory.getYearEndInventory(books.companyId, books.fiscalYearId)
    expect(view.provisions[0]).toMatchObject({ status: 'to_assess', openingCents: 0 })
    expect(view.totals.toAssess).toBe(1)

    await provisions.saveAssessment(books.companyId, created.id, { fiscalYearId: books.fiscalYearId, amountCents: 1_200_000, basis: "Note de l'avocat" })
    view = await inventory.getYearEndInventory(books.companyId, books.fiscalYearId)
    expect(view.provisions[0]).toMatchObject({ status: 'to_post', requiredCents: 1_200_000, proposedCents: 1_200_000 })
    expect(view.totals.dotationsCents).toBe(1_200_000)

    const first = await prepare.prepareYearEndEntries(books.companyId, books.fiscalYearId)
    expect(first.created).toHaveLength(1)
    const entryId = first.created[0].entryId
    const entry = await prisma.accountingEntry.findUniqueOrThrow({ where: { id: entryId }, include: { journal: true } })
    expect(entry.status).toBe('draft')
    expect(entry.journal.code).toBe('OD')
    expect(entry.date.toISOString().slice(0, 10)).toBe('2026-12-31')
    expect(entry.description).toBe(`Dotation provision 2026 - ${LITIGATION.label}`)
    expect(await linesOf(entryId)).toEqual([
      ['1511', '0', '12000'],
      ['6815', '12000', '0'],
    ])

    // Idempotent: nothing more to prepare
    expect((await prepare.prepareYearEndEntries(books.companyId, books.fiscalYearId)).created).toEqual([])
    view = await inventory.getYearEndInventory(books.companyId, books.fiscalYearId)
    expect(view.provisions[0]).toMatchObject({ status: 'draft', bookedCents: 1_200_000, proposedCents: 0, closingCents: 1_200_000 })

    // The user validates it; the assessment is then fixed until the entry is reversed
    expect((await svc.validateEntries(books.companyId, [entryId])).errors).toEqual([])
    view = await inventory.getYearEndInventory(books.companyId, books.fiscalYearId)
    expect(view.provisions[0].status).toBe('validated')
    await expect(provisions.saveAssessment(books.companyId, created.id, { fiscalYearId: books.fiscalYearId, amountCents: 900_000 })).rejects.toThrow(/contre-passez l'écriture/)
    await expect(provisions.deleteProvision(books.companyId, created.id)).rejects.toThrow(/mouvements comptabilisés/)
    await expect(provisions.updateProvision(books.companyId, created.id, { ...LITIGATION, accountCode: '1518' })).rejects.toThrow(/ne peuvent plus changer/)

    // Reversed: the movement is proposed again
    await svc.reverseEntry(books.companyId, entryId)
    view = await inventory.getYearEndInventory(books.companyId, books.fiscalYearId)
    expect(view.provisions[0]).toMatchObject({ status: 'to_post', bookedCents: 0, proposedCents: 1_200_000 })
    await provisions.saveAssessment(books.companyId, created.id, { fiscalYearId: books.fiscalYearId, amountCents: 900_000 })
    const again = await prepare.prepareYearEndEntries(books.companyId, books.fiscalYearId)
    expect(again.created.map((c) => c.cents)).toEqual([900_000])
  })

  it('replaces a draft when the assessment changes, and takes the balance back once the risk ends', async () => {
    const created = await provisions.createProvision(books.companyId, LITIGATION)
    await provisions.saveAssessment(books.companyId, created.id, { fiscalYearId: books.fiscalYearId, amountCents: 500_000 })
    const [draft] = (await prepare.prepareYearEndEntries(books.companyId, books.fiscalYearId)).created
    await provisions.saveAssessment(books.companyId, created.id, { fiscalYearId: books.fiscalYearId, amountCents: 700_000 })
    expect(await prisma.accountingEntry.findUnique({ where: { id: draft.entryId } })).toBeNull()
    const [replaced] = (await prepare.prepareYearEndEntries(books.companyId, books.fiscalYearId)).created
    expect(replaced.cents).toBe(700_000)

    // A draft edited by hand no longer matches: preparing again replaces it
    const line = await prisma.entryLine.findFirstOrThrow({ where: { accountingEntryId: replaced.entryId, account: { code: '1511' } } })
    const otherLine = await prisma.entryLine.findFirstOrThrow({ where: { accountingEntryId: replaced.entryId, account: { code: '6815' } } })
    await prisma.entryLine.update({ where: { id: line.id }, data: { credit: 650 } })
    await prisma.entryLine.update({ where: { id: otherLine.id }, data: { debit: 650 } })
    let view = await inventory.getYearEndInventory(books.companyId, books.fiscalYearId)
    expect(view.provisions[0]).toMatchObject({ status: 'to_correct', bookedCents: 65_000, proposedCents: 635_000 })
    const fixed = await prepare.prepareYearEndEntries(books.companyId, books.fiscalYearId)
    expect(fixed.created.map((c) => c.cents)).toEqual([700_000])
    expect(await prisma.accountingEntry.findUnique({ where: { id: replaced.entryId } })).toBeNull()

    // An end date in the year does not override the assessment of that year
    await svc.validateEntries(books.companyId, [fixed.created[0].entryId])
    await provisions.updateProvision(books.companyId, created.id, { ...LITIGATION, closedOn: '2026-12-01' })
    view = await inventory.getYearEndInventory(books.companyId, books.fiscalYearId)
    expect(view.provisions[0]).toMatchObject({ status: 'validated', requiredCents: 700_000 })
  })

  it('computes the impairment of a fixed asset from its current value, and never reverses goodwill', async () => {
    const asset = await computer()
    const impairment = await provisions.createProvision(books.companyId, {
      category: 'FIXED_ASSET',
      label: 'Dépréciation du serveur',
      justification: 'Valeur de revente constatée inférieure à la valeur nette comptable.',
      accountCode: '2918',
      fixedAssetId: asset.id,
      openedOn: '2026-11-30',
    })
    // Net book value at 31/12/2026: 10 000 - 2 000 = 8 000 €; current value 5 000 €: 3 000 €
    const saved = await provisions.saveAssessment(books.companyId, impairment.id, { fiscalYearId: books.fiscalYearId, currentValueCents: 500_000 })
    expect(saved.amountCents).toBe(300_000)
    const view = await inventory.getYearEndInventory(books.companyId, books.fiscalYearId)
    expect(view.provisions[0]).toMatchObject({ requiredCents: 300_000, fixedAsset: { id: asset.id, netBookValueCents: 800_000 }, accounts: { dotation: { code: '68162' } } })
    const [entry] = (await prepare.prepareYearEndEntries(books.companyId, books.fiscalYearId)).created
    expect(await linesOf(entry.entryId)).toEqual([
      ['2918', '0', '3000'],
      ['68162', '3000', '0'],
    ])

    const goodwill = await provisions.createProvision(books.companyId, {
      category: 'FIXED_ASSET',
      label: 'Fonds commercial',
      justification: 'Baisse durable du chiffre d’affaires du fonds.',
      accountCode: '2907',
      openedOn: '2026-01-01',
    })
    expect(goodwill.reversible).toBe(false)
    await expect(provisions.saveAssessment(books.companyId, goodwill.id, { fiscalYearId: books.fiscalYearId, currentValueCents: 100 })).rejects.toThrow(/valeur actuelle ne s'utilise que/)
  })

  it('transfers a grant at the rhythm of the depreciation of the financed asset', async () => {
    const asset = await computer()
    const grant = await grants.createInvestmentGrant(books.companyId, {
      label: 'Aide régionale à l’équipement',
      grantor: 'Région',
      amountCents: 300_000,
      grantedOn: '2026-02-10',
      spreading: 'ASSET',
      fixedAssetId: asset.id,
    })
    expect(grant).toMatchObject({ accountCode: '131', transferAccountCode: '139', incomeAccountCode: '747' })
    const view = await inventory.getYearEndInventory(books.companyId, books.fiscalYearId)
    // 2 000 € of 10 000 € depreciated in 2026: a fifth of 3 000 €
    expect(view.grants[0]).toMatchObject({ status: 'to_post', expectedCumulativeCents: 60_000, proposedCents: 60_000, remainingCents: 240_000 })
    const [entry] = (await prepare.prepareYearEndEntries(books.companyId, books.fiscalYearId)).created
    expect(entry).toMatchObject({ kind: 'grant', cents: 60_000 })
    expect(await linesOf(entry.entryId)).toEqual([
      ['139', '600', '0'],
      ['747', '0', '600'],
    ])
    // The asset can no longer be deleted while the grant follows it
    await expect(deleteAsset.deleteFixedAsset(books.companyId, asset.id)).rejects.toThrow(/subvention d'investissement/)
    await expect(grants.createInvestmentGrant(books.companyId, { label: 'Sans bien', amountCents: 1_000, grantedOn: '2026-01-01', spreading: 'ASSET' })).rejects.toThrow(/Choisissez l'immobilisation financée/)
    await expect(grants.createInvestmentGrant(books.companyId, { label: 'Inaliénable', amountCents: 1_000, grantedOn: '2026-01-01', spreading: 'INALIENABILITY' })).rejects.toThrow(/durée d'inaliénabilité/)
  })

  it('lists doubtful receivables from the aged balance and moves one to 416 as a draft', async () => {
    const sale = await svc.createEntry({
      companyId: books.companyId,
      journalId: books.journals.VE,
      date: '2026-03-01',
      description: 'Facture F-001',
      status: 'validated',
      lines: [
        { accountId: books.accounts['411000'], debit: '1200', credit: '0', auxiliaryAccountNumber: 'C00001' },
        { accountId: books.accounts['706000'], debit: '0', credit: '1000' },
        { accountId: books.accounts['445710'], debit: '0', credit: '200' },
      ],
    })
    expect(sale.status).toBe('validated')
    const list = await doubtful.listDoubtfulReceivables(books.companyId, { fiscalYearId: books.fiscalYearId })
    expect(list).toMatchObject({ asOf: '2026-12-31', minDaysOverdue: 90 })
    expect(list.items).toEqual([
      expect.objectContaining({ tiersCode: 'C00001', label: 'Martin SA', openInclTaxCents: 120_000, overdueInclTaxCents: 120_000, provision: null }),
    ])
    const moved = await doubtful.reclassifyDoubtfulReceivable(books.companyId, { companyId: books.companyId, fiscalYearId: books.fiscalYearId, tiersCode: 'C00001' })
    expect(moved.amountCents).toBe(120_000)
    const entry = await prisma.accountingEntry.findUniqueOrThrow({ where: { id: moved.entryId }, include: { lines: { include: { account: true } } } })
    expect(entry.status).toBe('draft')
    expect(entry.lines.map((l) => [l.account.code, l.debit.toString(), l.credit.toString(), l.auxiliaryAccountNumber]).sort()).toEqual([
      ['411000', '0', '1200', 'C00001'],
      ['416000', '1200', '0', 'C00001'],
    ])
    await expect(doubtful.reclassifyDoubtfulReceivable(books.companyId, { companyId: books.companyId, fiscalYearId: books.fiscalYearId, tiersCode: 'NOBODY' })).rejects.toThrow(/ne doit rien/)

    // The impairment of that customer, on the amount excluding tax
    const impairment = await provisions.createProvision(books.companyId, {
      category: 'RECEIVABLE',
      label: 'Créance douteuse Martin SA',
      justification: 'Relances sans réponse, procédure collective probable : perte estimée à 50 % du hors taxe.',
      accountCode: '491',
      tiersCode: 'C00001',
      openedOn: '2026-12-31',
    })
    const after = await doubtful.listDoubtfulReceivables(books.companyId, { fiscalYearId: books.fiscalYearId, minDaysOverdue: '30' })
    // The 416 draft is not validated: the 411 lines are still in the aged balance
    expect(after.items[0].provision).toEqual({ id: impairment.id, label: 'Créance douteuse Martin SA' })
  })

  it('locks the closed fiscal year, in the services and in the database', async () => {
    const created = await provisions.createProvision(books.companyId, LITIGATION)
    await expect(provisions.saveAssessment(books.companyId, created.id, { fiscalYearId: books.closedFiscalYearId, amountCents: 100 })).rejects.toThrow(/clôturé/)
    await expect(prepare.prepareYearEndEntries(books.companyId, books.closedFiscalYearId)).rejects.toThrow(/clôturé/)
    await expect(
      prisma.provisionAssessment.create({ data: { companyId: books.companyId, provisionId: created.id, fiscalYearId: books.closedFiscalYearId, amount: 1 } }),
    ).rejects.toThrow(/KLEDG_FISCAL_YEAR_CLOSED/)
  })

  it("refuses another company's fiscal year, fixed asset and provision", async () => {
    const foreignAsset = await computer(other)
    await expect(provisions.createProvision(books.companyId, { ...LITIGATION, category: 'FIXED_ASSET', accountCode: '2918', fixedAssetId: foreignAsset.id })).rejects.toThrow(/Immobilisation introuvable/)
    await expect(grants.createInvestmentGrant(books.companyId, { label: 'X', amountCents: 100, grantedOn: '2026-01-01', spreading: 'ASSET', fixedAssetId: foreignAsset.id })).rejects.toThrow(/Immobilisation introuvable/)
    const created = await provisions.createProvision(books.companyId, LITIGATION)
    await expect(provisions.saveAssessment(books.companyId, created.id, { fiscalYearId: other.fiscalYearId, amountCents: 100 })).rejects.toThrow(/Exercice introuvable/)
    await expect(provisions.deleteProvision(other.companyId, created.id)).rejects.toThrow(/introuvable/)
    await expect(inventory.getYearEndInventory(books.companyId, other.fiscalYearId)).rejects.toThrow(/Exercice introuvable/)
    // The composite foreign key keeps an assessment in its provision's company
    await expect(
      prisma.provisionAssessment.create({ data: { companyId: other.companyId, provisionId: created.id, fiscalYearId: other.fiscalYearId, amount: 1 } }),
    ).rejects.toThrow()
  })

  it('refuses an account of another category and a nature the account cannot take', async () => {
    await expect(provisions.createProvision(books.companyId, { ...LITIGATION, accountCode: '491' })).rejects.toThrow(/ne convient pas/)
    await expect(provisions.createProvision(books.companyId, { ...LITIGATION, category: 'SECURITY', accountCode: '5903', nature: 'OPERATING' })).rejects.toThrow(/ne peut pas être exploitation/)
    const fines = await provisions.createProvision(books.companyId, { ...LITIGATION, accountCode: '1514' })
    expect(fines.taxDeductible).toBe(false)
  })

  it('warns at the closing about what is left to assess and to book', async () => {
    const created = await provisions.createProvision(books.companyId, LITIGATION)
    let checks = await closure.validateFiscalYearClosure(books.companyId, books.fiscalYearId, prisma, new Date('2027-02-01T00:00:00Z'))
    expect(checks.warnings).toContain('1 provision ou dépréciation sans montant évalué à la clôture : indiquez le montant requis ou la date de fin dans Saisie, Provisions et dépréciations.')
    await provisions.saveAssessment(books.companyId, created.id, { fiscalYearId: books.fiscalYearId, amountCents: 1_200_000 })
    checks = await closure.validateFiscalYearClosure(books.companyId, books.fiscalYearId, prisma, new Date('2027-02-01T00:00:00Z'))
    expect(checks.warnings.join('\n')).toMatch(
      /Écritures d'inventaire à préparer\u00a0: dotations aux provisions et dépréciations \(12\s000,00 €\)\. Préparez-les en brouillon depuis Saisie, Travaux de clôture, puis validez-les\./,
    )
    await prepare.prepareYearEndEntries(books.companyId, books.fiscalYearId)
    checks = await closure.validateFiscalYearClosure(books.companyId, books.fiscalYearId, prisma, new Date('2027-02-01T00:00:00Z'))
    // The draft blocks the closing until the user validates it
    expect(checks.canClose).toBe(false)
    expect(checks.errors.join(' ')).toMatch(/brouillon/)
  })
})
