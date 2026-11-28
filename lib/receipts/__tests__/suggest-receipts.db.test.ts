/**
 * Receipts that find their transaction (lib/receipts/suggest-receipts.service.ts,
 * lib/receipts/read/guess-receipt.service.ts) against PostgreSQL:
 * - what Kledg read in a file is recorded on a receipt without fields, as
 *   read, never over fields the user or the assistant gave;
 * - searching with the recorded fields keeps them as read, fields given by
 *   the user confirm them and forget a suggestion;
 * - after a bank sync, a receipt dropped before its transaction gets that
 *   transaction as a suggestion, never attached; an ambiguous match gives
 *   none, and a suggestion whose transaction got a receipt elsewhere goes.
 * Skipped when the test database server is unreachable.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('receipt_suggestions')
  process.env.RATE_LIMIT_DISABLED = 'true'
})

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { BankProvider, ProviderTransaction } from '@/lib/banking/providers/types'
import { jpegWith } from './fixtures'

const available = await testDatabaseAvailable()

type Prisma = typeof import('@/lib/prisma').prisma
let prisma: Prisma
let stage: typeof import('../stage-receipt.service')
let file: typeof import('../file-receipt.service')
let guess: typeof import('../read/guess-receipt.service')
let suggest: typeof import('../suggest-receipts.service')
let names: typeof import('../file-name-fields')
let merge: typeof import('../read/guess')
let syncIntegration: typeof import('@/lib/integrations/sync').syncIntegration

const OWNER = { userId: 'u-owner', seesAll: true }
const NOW = new Date('2026-10-20T08:00:00Z')
const ids = {} as Record<string, string>
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

async function seed() {
  await prisma.user.create({ data: { id: 'u-owner', email: 'owner@test.local', name: 'Owner' } })
  const company = await prisma.company.create({ data: { name: 'Atelier Lumen', slug: 'atelier-lumen', siren: '123456782' } })
  const integration = await prisma.integration.create({
    data: {
      companyId: company.id,
      provider: 'QONTO',
      type: 'BANKING',
      name: 'Qonto',
      status: 'active',
      credentials: {},
      credentialsEncrypted: false,
      featureConfigs: { create: [{ feature: 'BANKING_ACCOUNTS' }, { feature: 'BANKING_TRANSACTIONS' }] },
    },
  })
  const connection = await prisma.bankConnection.create({ data: { companyId: company.id, provider: 'QONTO', integrationId: integration.id, login: 'lumen' } })
  const account = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: 'acc-1', name: 'Compte courant', currency: 'EUR' } })
  await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31') } })
  Object.assign(ids, { company: company.id, integration: integration.id, account: account.id })
}

const transaction = (ext: string, amount: number, date: string, label: string) =>
  prisma.bankTransaction.create({ data: { bankAccountId: ids.account, externalTransactionId: ext, amount, date: day(date), side: 'debit', label }, select: { id: true } })

async function stagedWithName(fileName: string) {
  const staged = await stage.stageReceipt(ids.company, OWNER, { bytes: jpegWith(fileName), fileName, source: 'app' })
  const read = merge.mergeGuess(null, names.fieldsFromFileName(fileName))
  return (await guess.prefillStagedReceipt(ids.company, staged.receipt.id, read)) ?? (await prisma.stagedReceipt.findUniqueOrThrow({ where: { id: staged.receipt.id } }))
}

const row = (id: string) => prisma.stagedReceipt.findUniqueOrThrow({ where: { id }, select: { status: true, fieldsReadFrom: true, suggestedTransactionId: true, amount: true, attachmentId: true } })

describe.skipIf(!available)('receipts that find their transaction', () => {
  beforeAll(async () => {
    await prepareTestDatabase('receipt_suggestions')
    ;({ prisma } = await import('@/lib/prisma'))
    stage = await import('../stage-receipt.service')
    file = await import('../file-receipt.service')
    guess = await import('../read/guess-receipt.service')
    suggest = await import('../suggest-receipts.service')
    names = await import('../file-name-fields')
    merge = await import('../read/guess')
    ;({ syncIntegration } = await import('@/lib/integrations/sync'))
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('receipt_suggestions')
    await seed()
  })

  it('records what was read as read, and never over fields already given', async () => {
    const receipt = await stagedWithName('2026-10-03 Boulangerie 43,50.jpg')
    expect(await row(receipt.id)).toMatchObject({ fieldsReadFrom: 'file-name', status: 'staged' })
    expect(Number((await row(receipt.id)).amount)).toBe(43.5)

    // The assistant gave its fields first: a later reading changes nothing
    const other = await stage.stageReceipt(ids.company, OWNER, { bytes: jpegWith('assistant'), fileName: '2026-10-05 Parking 18,00.jpg', source: 'base64' })
    await file.matchStagedReceipt(ids.company, other.receipt.id, OWNER, file.ReceiptFieldsSchema.parse({ amountCents: 1_900, date: '2026-10-05' }))
    const read = merge.mergeGuess(null, names.fieldsFromFileName('2026-10-05 Parking 18,00.jpg'))
    expect(await guess.prefillStagedReceipt(ids.company, other.receipt.id, read)).toBeNull()
    expect(await row(other.receipt.id)).toMatchObject({ fieldsReadFrom: null })
    expect(Number((await row(other.receipt.id)).amount)).toBe(19)
  })

  it('searches with the read fields without confirming them; fields given by the user confirm them', async () => {
    await transaction('bakery', 43.5, '2026-10-04', 'CB BOULANGERIE DU MARCHE')
    const receipt = await stagedWithName('2026-10-03 Boulangerie 43,50.jpg')
    const searched = await file.matchStagedReceipt(ids.company, receipt.id, OWNER)
    expect(searched).toMatchObject({ outcome: 'matched', receipt: { fieldsReadFrom: 'file-name' } })
    const confirmed = await file.matchStagedReceipt(ids.company, receipt.id, OWNER, file.ReceiptFieldsSchema.parse({ amountCents: 4_350, date: '2026-10-03', merchant: 'Boulangerie' }))
    expect(confirmed.receipt.fieldsReadFrom).toBeNull()
  })

  it('suggests the transaction that arrives after the receipt, without attaching it', async () => {
    const receipt = await stagedWithName('2026-10-10 Imprimerie 61,20.jpg')
    expect(await suggest.suggestReceiptMatches(ids.company, NOW)).toEqual({ checked: 1, suggested: 0, cleared: 0 })

    const { id } = await transaction('print', 61.2, '2026-10-13', 'PRLV IMPRIMERIE LEFEVRE')
    expect(await suggest.suggestReceiptMatches(ids.company, NOW)).toEqual({ checked: 1, suggested: 1, cleared: 0 })
    expect(await row(receipt.id)).toMatchObject({ status: 'staged', suggestedTransactionId: id, attachmentId: null })
    expect(await prisma.attachment.count({ where: { bankTransactionId: id } })).toBe(0)
    // Nothing more to do on the next pass
    expect(await suggest.suggestReceiptMatches(ids.company, NOW)).toEqual({ checked: 1, suggested: 0, cleared: 0 })

    // The transaction got its receipt elsewhere (Qonto): the suggestion goes
    await prisma.attachment.create({ data: { companyId: ids.company, bankTransactionId: id, externalAttachmentId: 'qonto-1', fileName: 'facture.pdf' } })
    expect(await suggest.suggestReceiptMatches(ids.company, NOW)).toEqual({ checked: 1, suggested: 0, cleared: 1 })
    expect((await row(receipt.id)).suggestedTransactionId).toBeNull()
  })

  it('suggests nothing when two transactions could be the one', async () => {
    const receipt = await stagedWithName('2026-10-05 18,00.jpg')
    await transaction('twin1', 18, '2026-10-06', 'CB PARKING INDIGO')
    await transaction('twin2', 18, '2026-10-07', 'CB PARKING SAEMES')
    expect((await suggest.suggestReceiptMatches(ids.company, NOW)).suggested).toBe(0)
    expect((await row(receipt.id)).suggestedTransactionId).toBeNull()
  })

  it('suggests after a bank sync that brings the transaction', async () => {
    const receipt = await stagedWithName('2026-10-10 Imprimerie 61,20.jpg')
    const line: ProviderTransaction = {
      externalId: 'q-print',
      accountExternalId: 'acc-1',
      amount: 61.2,
      side: 'debit',
      date: day('2026-10-12'),
      label: 'PRLV IMPRIMERIE LEFEVRE',
      state: 'booked',
      status: null,
    } as ProviderTransaction
    const provider: BankProvider = {
      id: 'QONTO',
      kind: 'direct',
      listAccounts: async () => [{ externalId: 'acc-1', iban: null, name: 'Compte courant', currency: 'EUR', balance: 0 }],
      syncTransactions: async () => [line],
      getBalances: async () => [],
      getConnectionHealth: async () => ({ lastSyncAt: null, consentExpiresAt: null, error: null }),
    }
    const result = await syncIntegration(ids.integration, 'unused-key', undefined, { provider, now: NOW })
    expect(result.errors).toEqual([])
    const synced = await prisma.bankTransaction.findFirstOrThrow({ where: { externalTransactionId: 'q-print' }, select: { id: true } })
    expect(await row(receipt.id)).toMatchObject({ status: 'staged', suggestedTransactionId: synced.id })
  })
})
