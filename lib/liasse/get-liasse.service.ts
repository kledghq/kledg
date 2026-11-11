/**
 * Loads the liasse fiscale of a fiscal year (docs/liasse-fiscale.md): the
 * regime and the tax result of the impôt sur les sociétés worksheet
 * (lib/corporate-tax), the validated entries of the year on the provision
 * and VAT accounts, the balances of the income statement, the balance
 * sheet of the regime's layout, the provisions register (lib/provisions,
 * lib/year-end), the capital composition and the shareholders' records,
 * the participations of the group (lib/group) and the answers of the
 * annexe and of the approval; then runs the pure builders of lib/liasse.
 *
 * Every query is scoped by the company the route resolved; the fiscal year
 * must be the company's (404 otherwise). Read with reports:read. A
 * subsidiary is read through the GroupAccess (counted, never read, when the
 * user cannot read it). Personal data of the shareholders (birth, address)
 * is never returned: only whether it is filled.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ownedFiscalYear } from '@/lib/accounting/manage-fiscal-years.service'
import { CLOSING_JOURNAL } from '@/lib/accounting/fiscal-year-closure/constants'
import { isOpeningJournal } from '@/lib/fec/format'
import type { LedgerLine } from '@/lib/annexe/movements'
import { loadAccountYears, parseStoredAnnexeDetails } from '@/lib/annexe/get-annexe.service'
import { parseStoredDetails } from '@/lib/approval/get-approval.service'
import { buildCorporateTax } from '@/lib/corporate-tax/load-corporate-tax.service'
import { durationOf } from '@/lib/corporate-tax/rules'
import type { CorporateTaxRegime } from '@/lib/corporate-tax/compute'
import { getParticipations } from '@/lib/group/get-participations.service'
import { readIfAllowed } from '@/lib/group/perimeter'
import type { GroupAccess } from '@/lib/management-fees/access'
import { getCapitalComposition } from '@/lib/reports/capital-composition/get-capital-composition.service'
import { generateBalanceSheet } from '@/lib/reports/balance-sheet/generate-balance-sheet.service'
import type { BalanceSheetLine } from '@/lib/reports/balance-sheet/types'
import { loadStatementAccounts } from '@/lib/reports/statements/load'
import { getYearEndInventory } from '@/lib/year-end/get-year-end-inventory.service'
import { todayParis } from '@/lib/accounting/entry-date'
import { calendarDayOf } from '@/lib/utils/date'
import { parseCents, toCents } from '@/lib/utils/money'
import { assembleLiasse, type LiasseView } from './build-liasse'
import { buildCapitalForm, buildSubsidiariesForm, CAPITAL_CODES_2033F, CAPITAL_CODES_2059F, DECLARATION_THRESHOLD_HUNDREDTHS, type AddressText, type CompanyIdentity, type HolderIdentity, type SubsidiaryIdentity } from './capital'
import type { LiasseForm } from './cells'
import type { DeficitsInput } from './deficits'
import { buildForm2033D } from './form-2033d'
import { buildCoverForm } from './form-2065'
import { incomeStatementProvisions, isProvisionAccount, provisionMovements, type ProvisionRegisterItem, type ProvisionsInput } from './provisions'
import { buildForm2056 } from './form-2056'
import { buildForm2057 } from './form-2057'
import { buildForm2058B } from './form-2058b'
import { buildForm2058C } from './form-2058c'
import { buildValueAddedForm, VALUE_ADDED_CODES_2033E, VALUE_ADDED_CODES_2059E } from './value-added'
import { VAT_COLLECTED_PREFIX, VAT_DEDUCTIBLE_PREFIX, VAT_SETTLEMENT_PREFIXES, vatTotals, type VatLine } from './vat'

export const LiasseQuerySchema = z.object({ fiscalYearId: z.string({ error: "L'exercice est requis" }).min(1, "L'exercice est requis").max(64) })

const day = (value: Date) => calendarDayOf(value) as string
const cents = (value: { toString(): string } | null | undefined) => (value == null ? 0 : (parseCents(value) ?? 0))

type AddressRow = { street: string; postalCode: string; city: string; country: string } | null
const addressOf = (row: AddressRow): AddressText | null => (row ? { street: row.street, postalCode: row.postalCode, city: row.city, country: row.country } : null)

/** Balance sheet boxes of the provisions in each layout: provisions réglementées and provisions pour risques et charges. */
const PROVISION_BOXES: Record<CorporateTaxRegime, { regulated: string; riskCharges: string }> = {
  simplified: { regulated: '140', riskCharges: '154' },
  normal: { regulated: 'DK', riskCharges: 'DR' },
}

function findLine(lines: readonly BalanceSheetLine[], formCode: string): BalanceSheetLine | null {
  for (const line of lines) {
    if (line.formCode === formCode) return line
    const child = line.children ? findLine(line.children, formCode) : null
    if (child) return child
  }
  return null
}

/** Validated lines of the year on the provision accounts (14, 15, 29, 39, 49, 59), closing entry excluded. */
async function loadProvisionLines(companyId: string, fiscalYearId: string): Promise<LedgerLine[]> {
  const rows = await prisma.entryLine.findMany({
    where: {
      accountFiscalYearId: fiscalYearId,
      accountingEntry: { companyId, fiscalYearId, status: 'validated', journal: { code: { not: CLOSING_JOURNAL.code } } },
      OR: ['14', '15', '29', '39', '49', '59'].map((prefix) => ({ account: { code: { startsWith: prefix } } })),
    },
    select: {
      accountingEntryId: true,
      debit: true,
      credit: true,
      account: { select: { code: true } },
      accountingEntry: { select: { reversalOfId: true, journal: { select: { code: true } } } },
    },
  })
  return rows
    .map(
      (r): LedgerLine => ({
        entryId: r.accountingEntryId,
        reversalOfId: r.accountingEntry.reversalOfId,
        opening: isOpeningJournal(r.accountingEntry.journal.code),
        code: r.account.code,
        debitCents: cents(r.debit),
        creditCents: cents(r.credit),
      }),
    )
    .filter((l) => isProvisionAccount(l.code))
}

/** VAT collected and deductible of the year, summed by account in the database, settlement entries apart. */
async function loadVatLines(companyId: string, fiscalYearId: string): Promise<VatLine[]> {
  const journals = await prisma.journal.findMany({ where: { companyId }, select: { code: true } })
  const excluded = [...journals.map((j) => j.code).filter(isOpeningJournal), CLOSING_JOURNAL.code]
  const settles = { lines: { some: { OR: VAT_SETTLEMENT_PREFIXES.map((prefix) => ({ account: { code: { startsWith: prefix } } })) } } }
  const where = (settlement: boolean) => ({
    accountFiscalYearId: fiscalYearId,
    OR: [VAT_COLLECTED_PREFIX, VAT_DEDUCTIBLE_PREFIX].map((prefix) => ({ account: { code: { startsWith: prefix } } })),
    accountingEntry: { companyId, fiscalYearId, status: 'validated', journal: { code: { notIn: excluded } }, ...(settlement ? settles : { NOT: settles }) },
  })
  const [ordinary, settlement] = await Promise.all([
    prisma.entryLine.groupBy({ by: ['accountId'], where: where(false), _sum: { debit: true, credit: true } }),
    prisma.entryLine.groupBy({ by: ['accountId'], where: where(true), _sum: { debit: true, credit: true } }),
  ])
  const ids = [...new Set([...ordinary, ...settlement].map((r) => r.accountId))]
  const accounts = ids.length ? await prisma.account.findMany({ where: { id: { in: ids }, companyId }, select: { id: true, code: true } }) : []
  const codeOf = new Map(accounts.map((a) => [a.id, a.code]))
  const toLine = (settles: boolean) => (r: (typeof ordinary)[number]): VatLine => ({
    code: codeOf.get(r.accountId) ?? '',
    debitCents: cents(r._sum.debit),
    creditCents: cents(r._sum.credit),
    settlement: settles,
    opening: false,
  })
  return [...ordinary.map(toLine(false)), ...settlement.map(toLine(true))].filter((l) => l.code !== '')
}

/** The provisions register at the closing: validated movements only. */
async function loadRegister(companyId: string, fiscalYearId: string): Promise<ProvisionRegisterItem[]> {
  const inventory = await getYearEndInventory(companyId, fiscalYearId)
  return inventory.provisions
    .filter((p) => p.status !== 'not_in_year' || p.openingCents !== 0)
    .map((p) => {
      const validated = p.entry?.status === 'validated' ? p.bookedCents : 0
      return { label: p.label, category: p.category, accountCode: p.accountCode, taxDeductible: p.taxDeductible, movementCents: validated, closingCents: p.openingCents + validated }
    })
}

async function loadCompany(companyId: string) {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: {
      name: true,
      siren: true,
      email: true,
      legalType: true,
      legalForm: true,
      activityCode: true,
      headquartersAddress: { select: { street: true, postalCode: true, city: true, country: true } },
      address: { select: { street: true, postalCode: true, city: true, country: true } },
      establishments: { where: { isMain: true }, select: { siret: true }, take: 1 },
    },
  })
  return company
}

/** Shareholders with the identity the forms need: legal form and address of a legal person, whether a natural person's record is complete. */
async function loadHolders(companyId: string, fiscalYearId: string) {
  const [composition, records] = await Promise.all([
    getCapitalComposition(companyId, { fiscalYearId }),
    prisma.shareholder.findMany({
      where: { companyId },
      select: {
        id: true,
        person: { select: { name: true, firstName: true, usualName: true, birthDate: true, birthCity: true, birthDepartment: true, birthCountry: true, addressId: true } },
        companyShareholder: {
          select: {
            legalType: true,
            legalForm: true,
            headquartersAddress: { select: { street: true, postalCode: true, city: true, country: true } },
            address: { select: { street: true, postalCode: true, city: true, country: true } },
          },
        },
      },
    }),
  ])
  const byId = new Map(records.map((r) => [r.id, r]))
  const holders: HolderIdentity[] = composition.rows.map((row) => {
    const record = byId.get(row.id)
    const person = record?.person ?? null
    const legal = record?.companyShareholder ?? null
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      shares: row.shares,
      percentHundredths: row.sharesPercentHundredths ?? row.percentHundredths,
      siren: row.siren,
      legalForm: legal ? (legal.legalForm ?? legal.legalType ?? null) : null,
      address: legal ? addressOf(legal.headquartersAddress ?? legal.address) : null,
      lastName: person?.name || null,
      firstNames: person?.firstName || null,
      usualName: person?.usualName || null,
      birthRecorded: Boolean(person?.birthDate && person.birthCity && (person.birthDepartment || (person.birthCountry && person.birthCountry !== 'FR'))),
      addressRecorded: Boolean(person?.addressId),
    }
  })
  return { composition, holders }
}

/** Companies held for 10 % or more: subsidiaries recorded in Kledg (read when the user can) and participations answered on the annexe. */
async function loadSubsidiaries(companyId: string, fiscalYearId: string, access: GroupAccess | null, annexeParticipations: ReadonlyArray<{ name: string; siren: string | null; sharePercent: number }>) {
  const fromAnnexe: SubsidiaryIdentity[] = annexeParticipations.map((p) => ({
    name: p.name,
    siren: p.siren,
    ownershipHundredths: Math.round(p.sharePercent * 100),
    legalForm: null,
    address: null,
    from: 'annexe',
  }))
  if (!access) return { subsidiaries: fromAnnexe, unreachable: 0, unattributed: [] }
  const report = await getParticipations(companyId, { fiscalYearId }, access)
  const fromGroup: SubsidiaryIdentity[] = []
  // One read per subsidiary, each in its own scope (lib/group/perimeter.ts): a group holds a handful.
  for (const row of report.rows) {
    const read = await readIfAllowed(access, row.subsidiaryId, () =>
      prisma.company.findUnique({
        where: { id: row.subsidiaryId },
        select: {
          legalType: true,
          legalForm: true,
          headquartersAddress: { select: { street: true, postalCode: true, city: true, country: true } },
          address: { select: { street: true, postalCode: true, city: true, country: true } },
        },
      }),
    )
    const identity = read.ok ? read.value : null
    fromGroup.push({
      name: row.name,
      siren: row.siren,
      ownershipHundredths: row.ownershipBp,
      legalForm: identity ? (identity.legalForm ?? identity.legalType ?? null) : null,
      address: identity ? addressOf(identity.headquartersAddress ?? identity.address) : null,
      from: 'group',
    })
  }
  return { subsidiaries: [...fromGroup, ...fromAnnexe], unreachable: report.unreachable.length, unattributed: report.unattributed.filter((u) => u.accountCode.startsWith('261')) }
}

/**
 * The allocation voted at the approval of the accounts of the fiscal year
 * before (the one the 2058-C-SD of this year shows), when recorded in Kledg.
 */
async function loadPreviousAllocation(companyId: string, startDate: Date) {
  const previous = await prisma.fiscalYear.findFirst({ where: { companyId, endDate: { lt: startDate } }, orderBy: { endDate: 'desc' }, select: { id: true, year: true } })
  if (!previous) return null
  const row = await prisma.accountsApproval.findUnique({ where: { fiscalYearId_companyId: { fiscalYearId: previous.id, companyId } }, select: { details: true } })
  if (!row) return null
  const allocation = parseStoredDetails(row.details).allocation
  return { year: previous.year, dividendsCents: allocation.dividendsCents, otherReservesCents: allocation.otherReservesCents }
}

export async function getLiasse(companyId: string, fiscalYearId: string, access: GroupAccess | null, now?: Date): Promise<LiasseView> {
  const fy = await ownedFiscalYear(companyId, fiscalYearId)
  const fiscalYear = { id: fy.id, year: fy.year, startDate: day(fy.startDate), endDate: day(fy.endDate), isClosed: fy.isClosed }
  const [{ view: is }, company] = await Promise.all([buildCorporateTax(companyId, { fiscalYearId: fy.id }, { access, now }), loadCompany(companyId)])
  const base = { company: { name: company.name, siren: company.siren }, fiscalYear }
  if (is.status === 'not-subject' || is.status === 'missing-regime') return assembleLiasse({ ...base, status: is.status, regime: null, forms: [], warnings: [] })
  const regime = is.regime as CorporateTaxRegime

  const [ledger, register, sheet, vatLines, accounts, annexeRow, approvalRow, holders, drafts] = await Promise.all([
    loadProvisionLines(companyId, fy.id),
    loadRegister(companyId, fy.id),
    generateBalanceSheet(companyId, fy.id, regime === 'simplified' ? 'simplified' : 'complete'),
    loadVatLines(companyId, fy.id),
    loadStatementAccounts(companyId, fy),
    prisma.annexeNote.findUnique({ where: { fiscalYearId_companyId: { fiscalYearId: fy.id, companyId } }, select: { details: true } }),
    prisma.accountsApproval.findUnique({ where: { fiscalYearId_companyId: { fiscalYearId: fy.id, companyId } }, select: { details: true } }),
    loadHolders(companyId, fy.id),
    prisma.accountingEntry.count({ where: { companyId, fiscalYearId: fy.id, status: 'draft' } }),
  ])
  const annexe = parseStoredAnnexeDetails(annexeRow?.details)
  const approval = parseStoredDetails(approvalRow?.details)
  const { subsidiaries, unreachable, unattributed } = await loadSubsidiaries(companyId, fy.id, access, annexe.externalParticipations ?? [])

  const identity: CompanyIdentity = {
    name: company.name,
    siren: company.siren,
    siret: company.establishments[0]?.siret ?? null,
    legalType: company.legalType,
    address: addressOf(company.headquartersAddress ?? company.address),
    endDate: fiscalYear.endDate,
  }
  const boxes = PROVISION_BOXES[regime]
  const boxValue = (box: string) => {
    const line = findLine(sheet.passif.lines, box)
    return line ? { box, cents: toCents(line.value) ?? 0 } : null
  }
  const provisions: ProvisionsInput = {
    movements: provisionMovements(ledger),
    register,
    balanceSheet: { regulated: boxValue(boxes.regulated), riskCharges: boxValue(boxes.riskCharges) },
    incomeStatement: incomeStatementProvisions(accounts),
  }
  const computation = is.computation
  const deficits: DeficitsInput | null = computation
    ? { known: computation.deficits.known, openingCents: computation.deficits.openingCents, imputedCents: computation.deficits.imputedCents, createdCents: computation.deficits.createdCents }
    : null
  const deficitsWhy = computation && !computation.deficits.known ? "Les déficits reportés à l'ouverture ne sont pas connus : indiquez-les sur la page Impôt sur les sociétés." : "Aucun calcul de l'impôt sur les sociétés pour cet exercice."
  const employees = annexe.employees !== null ? { value: annexe.employees, from: 'annexe' as const } : approval.size.employees !== null ? { value: approval.size.employees, from: 'approval' as const } : null
  const titresCents = accounts.filter((a) => a.code.startsWith('261')).reduce((s, a) => s + a.debitCents - a.creditCents, 0)
  const salariesCents = accounts.filter((a) => a.code.startsWith('641')).reduce((s, a) => s + a.debitCents - a.creditCents, 0)

  const forms: LiasseForm[] = [
    buildCoverForm({
      regime,
      company: { ...identity, email: company.email, activityCode: company.activityCode },
      fiscalYear,
      corporateTax: computation
        ? {
            normalBaseCents: computation.normalRate.baseCents,
            reducedBaseCents: computation.reducedRate.baseCents,
            deficitCents: computation.deficits.createdCents,
            eligibilityUnknown: computation.eligibility.eligible === null,
            reliable: is.reliable,
          }
        : null,
      why: "Aucun calcul de l'impôt sur les sociétés pour cet exercice.",
      salariesCents,
    }),
  ]
  const duration = durationOf(fiscalYear.startDate, fiscalYear.endDate)
  const vat = vatTotals(vatLines)
  const listed = subsidiaries.filter((x) => x.ownershipHundredths >= DECLARATION_THRESHOLD_HUNDREDTHS).length
  if (regime === 'simplified') {
    forms.push(
      buildForm2033D({ provisions, deficits, deficitsWhy, vat }),
      buildValueAddedForm({ form: { id: '2033-E', number: '2033-E-SD' }, notice: '2033-NOT-SD', codes: VALUE_ADDED_CODES_2033E, fiscalYear, duration, accounts, employees }),
      buildCapitalForm({
        form: { id: '2033-F', number: '2033-F-SD', title: 'Composition du capital social' },
        codes: CAPITAL_CODES_2033F,
        identifier: 'siren',
        company: identity,
        holders: holders.holders,
        compositionChecks: holders.composition.checks,
      }),
      buildSubsidiariesForm({ form: { id: '2033-G', number: '2033-G-SD', title: 'Filiales et participations' }, countBox: '905', identifier: 'siren', company: identity, subsidiaries, unreachable, titresCents, unattributed }),
    )
  } else {
    const [accountYears, previousAllocation] = await Promise.all([loadAccountYears(companyId, fy.id), loadPreviousAllocation(companyId, fy.startDate)])
    const debts = findLine(sheet.passif.lines, 'EC')
    const leasing = annexe.commitments?.items.filter((c) => c.kind === 'leasing' && c.amountCents !== null).reduce((sum, c) => sum + (c.amountCents ?? 0), 0) ?? null
    forms.push(
      buildForm2056(provisions),
      buildForm2057({
        accounts: accountYears,
        receivableMaturities: annexe.receivableMaturities,
        debtMaturities: annexe.debtMaturities,
        balanceSheetDebtsCents: debts ? (toCents(debts.value) ?? 0) : null,
      }),
      buildForm2058B({ deficits, deficitsWhy, register }),
      buildForm2058C({ accounts: accountYears, vat, approvedAllocation: previousAllocation, leasingCommitmentsCents: leasing || null, subsidiaries: { listed, unreachable } }),
      buildValueAddedForm({ form: { id: '2059-E', number: '2059-E-SD' }, notice: '2032-NOT-SD', codes: VALUE_ADDED_CODES_2059E, fiscalYear, duration, accounts, employees }),
      buildCapitalForm({
        form: { id: '2059-F', number: '2059-F-SD', title: 'Composition du capital social' },
        codes: CAPITAL_CODES_2059F,
        identifier: 'siret',
        company: identity,
        holders: holders.holders,
        compositionChecks: holders.composition.checks,
      }),
      buildSubsidiariesForm({ form: { id: '2059-G', number: '2059-G-SD', title: 'Filiales et participations' }, countBox: 'P5', identifier: 'siret', company: identity, subsidiaries, unreachable, titresCents, unattributed }),
    )
  }
  const warnings = drafts > 0 ? [`${drafts} écriture${drafts > 1 ? 's' : ''} en brouillon sur l'exercice : elle${drafts > 1 ? 's' : ''} ne compte${drafts > 1 ? 'nt' : ''} qu'une fois validée${drafts > 1 ? 's' : ''}.`] : []
  if (fiscalYear.endDate >= todayParis(now)) warnings.push("L'exercice n'est pas terminé : la liasse se prépare après la clôture, sur les comptes définitifs.")
  return assembleLiasse({ ...base, status: 'ready', regime, forms, warnings })
}
