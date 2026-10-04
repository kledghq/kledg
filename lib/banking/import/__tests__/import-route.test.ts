/**
 * Statement import route against PostgreSQL (lib/__tests__/helpers/test-db.ts),
 * only the session mocked: access rules, dedupe across imports and with the
 * API sync, atomic and idempotent insertion, exact amounts and dates.
 *
 * Skipped when the test database server is unreachable.
 */

import { readFileSync } from 'fs'
import path from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('bank_import')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

// Archived companies are read-only (lib/companies/archive-company.service.ts): none here.
vi.mock('@/lib/companies/archive-company.service', () => ({ assertCompanyWritable: async () => undefined }))
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => state.user,
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Prisma = typeof import('@/lib/prisma').prisma

let prisma: Prisma
let POST: Handler

const USERS = {
  accountant: { id: 'u-accountant', email: 'accountant@test.local', name: 'Accountant', role: 'user' },
  viewer: { id: 'u-viewer', email: 'viewer@test.local', name: 'Viewer', role: 'user' },
  memberB: { id: 'u-member-b', email: 'b@test.local', name: 'Member of B', role: 'user' },
} as const
type Who = keyof typeof USERS | 'anonymous'

const IBAN = 'FR7630006000011234567890189'
const ids = {} as Record<string, string>

async function seed() {
  for (const user of Object.values(USERS)) {
    await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name ?? '', role: user.role } })
  }
  for (const [prefix, name, slug] of [
    ['a', 'Atelier Alpha', 'atelier-alpha'],
    ['b', 'Bureau Beta', 'bureau-beta'],
  ] as const) {
    const company = await prisma.company.create({ data: { name, slug, siren: prefix === 'a' ? '111111111' : '222222222' } })
    await prisma.organization.create({ data: { id: `org-${prefix}`, name, slug: `org-${slug}`, createdAt: new Date(), companyId: company.id } })
    const connection = await prisma.bankConnection.create({ data: { companyId: company.id, login: `login-${prefix}`, secretKeyEncrypted: 'x' } })
    const account = await prisma.bankAccount.create({
      data: { bankConnectionId: connection.id, externalAccountId: prefix === 'a' ? IBAN : `ext-${prefix}`, iban: prefix === 'a' ? IBAN : null, name: 'Compte courant' },
    })
    ids[`${prefix}Company`] = company.id
    ids[`${prefix}Account`] = account.id
  }
  const members: Array<[string, string, string]> = [
    ['u-accountant', 'org-a', 'accountant'],
    ['u-viewer', 'org-a', 'viewer'],
    ['u-member-b', 'org-b', 'companyAdmin'],
  ]
  for (const [userId, organizationId, role] of members) {
    await prisma.member.create({ data: { id: `m-${userId}`, userId, organizationId, role, createdAt: new Date() } })
  }
}

const fixture = (name: string) => readFileSync(path.join(__dirname, 'fixtures', name))

interface CallOptions {
  who?: Who
  file?: Buffer | string
  fileName?: string
  mode?: 'preview' | 'import'
  account?: string
  company?: string
  options?: unknown
  allowErrors?: boolean
  keep?: Array<{ index: number; key: string }>
}

async function call(o: CallOptions): Promise<Response> {
  const who = o.who ?? 'accountant'
  state.user = who === 'anonymous' ? null : { ...USERS[who] }
  const form = new FormData()
  form.append('companyId', o.company ?? ids.aCompany)
  form.append('bankAccountId', o.account ?? ids.aAccount)
  form.append('mode', o.mode ?? 'import')
  const content = typeof o.file === 'string' ? new TextEncoder().encode(o.file) : new Uint8Array(o.file ?? Buffer.alloc(0))
  form.append('file', new File([content], o.fileName ?? 'releve.csv'))
  if (o.options) form.append('options', JSON.stringify(o.options))
  if (o.allowErrors) form.append('allowErrors', 'true')
  if (o.keep) form.append('keep', JSON.stringify(o.keep))
  return POST(new NextRequest('http://localhost/api/banking/import-statement', { method: 'POST', body: form }))
}

const json = async (r: Response) => (await r.json()) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const countA = () => prisma.bankTransaction.count({ where: { bankAccountId: ids.aAccount } })

describe.skipIf(!available)('POST /api/banking/import-statement', () => {
  beforeAll(async () => {
    await prepareTestDatabase('bank_import')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ POST } = (await import('@/app/api/banking/import-statement/route')) as unknown as { POST: Handler })
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('bank_import')
    await seed()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('access', () => {
    it('anonymous: 401', async () => {
      expect((await call({ who: 'anonymous', file: fixture('bpce.csv') })).status).toBe(401)
    })

    it('viewer cannot import nor preview: 403', async () => {
      for (const mode of ['preview', 'import'] as const) {
        const response = await call({ who: 'viewer', mode, file: fixture('bpce.csv') })
        expect(response.status).toBe(403)
        expect((await json(response)).error).toMatch(/Action non autorisée/)
      }
      expect(await countA()).toBe(0)
    })

    it('a member of another company gets 404', async () => {
      expect((await call({ who: 'memberB', file: fixture('bpce.csv') })).status).toBe(404)
      expect(await countA()).toBe(0)
    })

    it("a bank account of another company, or one that doesn't exist, is a 404", async () => {
      const other = await call({ account: ids.bAccount, file: fixture('bpce.csv') })
      expect(other.status).toBe(404)
      expect((await json(other)).error).toBe('Compte bancaire non trouvé')
      expect((await call({ account: 'does-not-exist', file: fixture('bpce.csv') })).status).toBe(404)
      expect(await prisma.bankTransaction.count()).toBe(0)
    })

    it('rejects files over the upload limit', async () => {
      const big = Buffer.alloc(20 * 1024 * 1024 + 1, 0x41)
      const response = await call({ file: big })
      expect(response.status).toBe(400)
      expect((await json(response)).error).toMatch(/Fichier trop volumineux/)
    })

    it('answers 400 with a French message on a malformed file, never 500', async () => {
      for (const name of ['broken.xml', 'fake.pdf', 'camt052.xml', 'entity-bomb.xml']) {
        const response = await call({ file: fixture(name), fileName: name })
        expect(response.status, name).toBe(400)
        expect((await json(response)).error, name).toMatch(/^[A-ZÉ]/)
      }
      const badOptions = await call({ file: fixture('bpce.csv'), options: { mapping: { date: 'x' } } })
      expect(badOptions.status).toBe(400)
    })

    it('validates the form fields with French messages and writes nothing', async () => {
      state.user = { ...USERS.accountant }
      const send = async (fields: Record<string, string | File>) => {
        const form = new FormData()
        form.append('companyId', ids.aCompany)
        for (const [name, value] of Object.entries(fields)) form.append(name, value)
        const response = await POST(new NextRequest('http://localhost/api/banking/import-statement', { method: 'POST', body: form }))
        return { status: response.status, error: ((await response.json()) as { error?: string }).error }
      }
      const file = new File([fixture('bpce.csv')], 'releve.csv')
      expect(await send({ file })).toEqual({ status: 400, error: 'Choisissez le compte bancaire à alimenter.' })
      expect(await send({ bankAccountId: ids.aAccount })).toEqual({ status: 400, error: 'Aucun fichier reçu.' })
      expect(await send({ bankAccountId: ids.aAccount, file, options: '{not json' })).toEqual({
        status: 400,
        error: "Options d'import invalides.",
      })
      expect(await send({ bankAccountId: ids.aAccount, file, keep: '[' })).toEqual({
        status: 400,
        error: 'Liste des doublons probables à conserver invalide.',
      })
      expect(await countA()).toBe(0)
    })
  })

  describe('preview', () => {
    it('detects, summarizes and writes nothing', async () => {
      const response = await call({ mode: 'preview', file: fixture('bpce.csv') })
      expect(response.status).toBe(200)
      const body = await json(response)
      expect(body.format).toBe('csv')
      expect(body.tabular.preset).toEqual({ id: 'bpce', name: "Banque Populaire / Caisse d'Epargne" })
      expect(body.summary).toEqual({
        total: 2,
        new: 2,
        duplicates: 0,
        probable: 0,
        probableKept: 0,
        from: '2026-03-03',
        to: '2026-03-04',
        debitsCents: 95000,
        creditsCents: 360000,
      })
      expect(body.probable).toEqual([])
      expect(body.rows[0]).toMatchObject({ bookingDate: '2026-03-03', amount: '-950.00', duplicate: false })
      expect(await countA()).toBe(0)
    })
  })

  describe('import', () => {
    it('stores exact amounts, sides and calendar dates', async () => {
      const body = await json(await call({ file: fixture('societe-generale.csv') }))
      expect(body.created).toBe(3)
      const rows = await prisma.bankTransaction.findMany({ where: { bankAccountId: ids.aAccount }, orderBy: { date: 'asc' } })
      expect(rows.map((r) => [r.date.toISOString(), r.amount.toFixed(2), r.side, r.imported, r.status])).toEqual([
        ['2026-03-02T00:00:00.000Z', '1234.56', 'debit', true, 'completed'],
        ['2026-03-04T00:00:00.000Z', '2400.00', 'credit', true, 'completed'],
        ['2026-03-05T00:00:00.000Z', '12.50', 'debit', true, 'completed'],
      ])
      expect(rows.every((r) => r.externalTransactionId.startsWith('import:'))).toBe(true)
    })

    it('is idempotent: re-importing the same file creates nothing', async () => {
      expect((await json(await call({ file: fixture('generic.tsv') }))).created).toBe(3)
      const again = await json(await call({ file: fixture('generic.tsv') }))
      expect(again.created).toBe(0)
      expect(again.duplicates).toBe(3)
      expect(await countA()).toBe(3)
    })

    it('imports only the new lines of an overlapping file, keeping genuine same-day identical lines', async () => {
      const header = 'Date;Libellé;Montant\n'
      const first = header + '01/03/2026;Frais bancaires;-3,50\n02/03/2026;Café;-2,00\n02/03/2026;Café;-2,00\n'
      const second = header + '02/03/2026;Café;-2,00\n02/03/2026;Café;-2,00\n02/03/2026;Café;-2,00\n03/03/2026;Loyer;-900,00\n'
      expect((await json(await call({ file: first }))).created).toBe(3)

      const preview = await json(await call({ mode: 'preview', file: second }))
      expect(preview.summary).toMatchObject({ total: 4, new: 2, duplicates: 2, from: '2026-03-02', to: '2026-03-03', debitsCents: 90200 })

      const result = await json(await call({ file: second }))
      expect(result.created).toBe(2)
      expect(await prisma.bankTransaction.count({ where: { bankAccountId: ids.aAccount, label: 'Café' } })).toBe(3)
      expect(await countA()).toBe(5)
    })

    it('skips lines already synced from the bank API (same bank reference)', async () => {
      await prisma.bankTransaction.create({
        data: {
          bankAccountId: ids.aAccount,
          externalTransactionId: 'org-1-transaction-101',
          amount: '120.00',
          side: 'debit',
          date: new Date('2026-03-03T00:00:00Z'),
          label: 'Fournisseur Delta',
        },
      })
      const preview = await json(await call({ mode: 'preview', file: fixture('qonto.csv') }))
      expect(preview.rows.map((r: { duplicate: unknown }) => r.duplicate)).toEqual(['sync', false])
      const body = await json(await call({ file: fixture('qonto.csv') }))
      expect(body.created).toBe(1)
      expect(await countA()).toBe(2)
    })

    it('matches a synced line by its reference on the same day and amount', async () => {
      await prisma.bankTransaction.create({
        data: {
          bankAccountId: ids.aAccount,
          externalTransactionId: 'api-uuid-1',
          reference: 'shn_tx_001',
          amount: '29.00',
          side: 'debit',
          date: new Date('2026-03-03T00:00:00Z'),
        },
      })
      expect((await json(await call({ file: fixture('shine.csv') }))).created).toBe(1)
    })

    it('imports concurrent uploads of the same file once', async () => {
      const results = await Promise.all([1, 2, 3].map(() => call({ file: fixture('statement-v2.qfx'), fileName: 'releve.qfx' })))
      expect(results.every((r) => r.status === 200)).toBe(true)
      expect(await countA()).toBe(2)
    })

    it('keeps only the statement of the selected account in a multi-account camt.053', async () => {
      const body = await json(await call({ file: fixture('camt053.xml'), fileName: 'releve.xml' }))
      expect(body.created).toBe(4)
      expect(body.warnings.join(' ')).toMatch(/FR7630006000019876543210123/)
      expect(await prisma.bankTransaction.count({ where: { label: 'FRAIS AUTRE COMPTE' } })).toBe(0)
    })

    it('asks for a confirmation before importing a statement of another account', async () => {
      await prisma.bankAccount.update({ where: { id: ids.aAccount }, data: { iban: 'FR7612345000010000000000123', externalAccountId: 'FR7612345000010000000000123' } })
      const preview = await json(await call({ mode: 'preview', file: fixture('statement-v1.ofx'), fileName: 'releve.ofx' }))
      expect(preview.errors[0]).toEqual({
        line: -1,
        message: 'Ce relevé concerne le compte 12345678901, qui ne correspond pas au compte sélectionné (FR7612345000010000000000123).',
      })
      expect((await call({ file: fixture('statement-v1.ofx'), fileName: 'releve.ofx' })).status).toBe(400)
      expect(await countA()).toBe(0)
      expect((await json(await call({ file: fixture('statement-v1.ofx'), fileName: 'releve.ofx', allowErrors: true }))).created).toBe(3)
    })

    it('matches an OFX account number inside the IBAN of the account', async () => {
      // IBAN FR76 30006 00001 12345678901 89 holds ACCTID 12345678901
      expect((await json(await call({ file: fixture('statement-v1.ofx'), fileName: 'releve.ofx' }))).created).toBe(3)
    })

    it('requires a confirmation to import a file with bad lines, then imports the valid ones', async () => {
      const refused = await call({ file: fixture('bad-amount.csv') })
      expect(refused.status).toBe(400)
      expect((await json(refused)).error).toMatch(/2 lignes en erreur/)
      expect(await countA()).toBe(0)
      const accepted = await json(await call({ file: fixture('bad-amount.csv'), allowErrors: true }))
      expect(accepted.created).toBe(1)
      expect(accepted.errorCount).toBe(2)
    })

    it('honours a forced column mapping', async () => {
      const csv = 'Quand,Quoi,Combien\n03/04/2026,Achat,"1,234.50"\n'
      const body = await json(
        await call({ file: csv, options: { mapping: { date: 0, label: 1, amount: 2 }, dateFormat: 'mm/dd/yyyy', decimalSeparator: '.', headerRow: 0 } }),
      )
      expect(body.created).toBe(1)
      const row = await prisma.bankTransaction.findFirstOrThrow({ where: { bankAccountId: ids.aAccount } })
      expect([row.date.toISOString(), row.amount.toFixed(2), row.side]).toEqual(['2026-03-04T00:00:00.000Z', '1234.50', 'credit'])
    })

    it('rejects a currency other than the account currency', async () => {
      const csv = 'Date;Libellé;Montant;Devise\n01/03/2026;Achat;-5,00;USD\n'
      const response = await call({ file: csv })
      expect(response.status).toBe(400)
      expect(await countA()).toBe(0)
    })
  })
  describe('probable duplicates (same date and amount, other source)', () => {
    type Probable = { index: number; key: string; line: number; amount: string; match: { label: string | null; source: string; format: string | null; date: string } }

    it('CSV then OFX of the same period: zero new lines, every OFX line flagged', async () => {
      const csv = 'Date;Libellé;Montant\n02/03/2026;Carte station;-45,90\n03/03/2026;Virement Theta;980,00\n04/03/2026;Chèque;-120,00\n'
      expect((await json(await call({ file: csv }))).created).toBe(3)

      const preview = await json(await call({ mode: 'preview', file: fixture('statement-v1.ofx'), fileName: 'releve.ofx' }))
      expect(preview.summary).toMatchObject({ total: 3, new: 0, duplicates: 0, probable: 3, probableKept: 0 })
      expect(preview.probable.map((p: Probable) => [p.amount, p.match.label, p.match.source, p.match.format])).toEqual([
        ['-45.90', 'Carte station', 'file', 'csv'],
        ['980.00', 'Virement Theta', 'file', 'csv'],
        ['-120.00', 'Chèque', 'file', 'csv'],
      ])

      const body = await json(await call({ file: fixture('statement-v1.ofx'), fileName: 'releve.ofx' }))
      expect([body.created, body.duplicates, body.probableSkipped]).toEqual([0, 0, 3])
      expect(await countA()).toBe(3)
    })

    it('flags exactly one of two identical same-day card payments when one is already there', async () => {
      await prisma.bankTransaction.create({
        data: { bankAccountId: ids.aAccount, externalTransactionId: 'api-card-1', amount: '3.50', side: 'debit', date: new Date('2026-03-02T00:00:00Z'), label: 'CB CAFE DU COIN' },
      })
      const csv = 'Date;Libellé;Montant\n02/03/2026;CARTE 02/03 CAFE;-3,50\n02/03/2026;CARTE 02/03 CAFE;-3,50\n'
      const preview = await json(await call({ mode: 'preview', file: csv }))
      expect(preview.rows.map((r: { duplicate: unknown }) => r.duplicate)).toEqual(['probable', false])
      expect(preview.summary).toMatchObject({ new: 1, probable: 1 })
      expect((await json(await call({ file: csv }))).created).toBe(1)
      expect(await countA()).toBe(2)
    })

    it('recognizes a transaction synced from the bank API under another label', async () => {
      await prisma.bankTransaction.create({
        data: {
          bankAccountId: ids.aAccount,
          externalTransactionId: 'qonto-tx-77',
          amount: '84.20',
          side: 'debit',
          date: new Date('2026-03-03T00:00:00Z'),
          label: 'Fournisseur Energie',
        },
      })
      const preview = await json(await call({ mode: 'preview', file: fixture('../../../../../public/examples/exemple-releve.csv') }))
      const probable = preview.probable as Probable[]
      expect(probable).toHaveLength(1)
      expect(probable[0]).toMatchObject({ amount: '-84.20', match: { label: 'Fournisseur Energie', source: 'sync', format: null, date: '2026-03-03' } })
      const body = await json(await call({ file: fixture('../../../../../public/examples/exemple-releve.csv') }))
      expect([body.created, body.probableSkipped]).toEqual([5, 1])
    })

    it('needs the same amount and the same day: no wider tolerance, sign matters', async () => {
      await prisma.bankTransaction.createMany({
        data: [
          { bankAccountId: ids.aAccount, externalTransactionId: 'api-1', amount: '10.00', side: 'debit', date: new Date('2026-03-01T00:00:00Z') },
          { bankAccountId: ids.aAccount, externalTransactionId: 'api-2', amount: '20.00', side: 'credit', date: new Date('2026-03-05T00:00:00Z') },
        ],
      })
      const csv = 'Date;Libellé;Montant\n02/03/2026;Un jour plus tard;-10,00\n05/03/2026;Sens inverse;-20,00\n'
      const preview = await json(await call({ mode: 'preview', file: csv }))
      expect(preview.summary).toMatchObject({ new: 2, probable: 0 })
    })

    it('matches on the value date when both sides have one', async () => {
      const first = 'Date;Date de valeur;Libellé;Montant\n03/03/2026;05/03/2026;REMISE CHEQUES;250,00\n'
      expect((await json(await call({ file: first }))).created).toBe(1)
      // Another export books the same remittance on its value date
      const second = 'Date;Date de valeur;Libellé;Montant\n04/03/2026;05/03/2026;Remise de chèques n° 12;250,00\n'
      const preview = await json(await call({ mode: 'preview', file: second }))
      expect(preview.summary).toMatchObject({ new: 0, probable: 1 })
      // Without a value date on the file side, only the booking date counts
      const third = 'Date;Libellé;Montant\n04/03/2026;Remise;250,00\n'
      expect((await json(await call({ mode: 'preview', file: third }))).summary).toMatchObject({ new: 1, probable: 0 })
    })

    it('imports a probable duplicate the user keeps, and only with a matching index and key', async () => {
      await prisma.bankTransaction.create({
        data: { bankAccountId: ids.aAccount, externalTransactionId: 'api-x', amount: '12.00', side: 'debit', date: new Date('2026-03-09T00:00:00Z'), label: 'FRAIS' },
      })
      const csv = 'Date;Libellé;Montant\n09/03/2026;Frais tenue de compte;-12,00\n09/03/2026;Autre ligne;-1,00\n'
      const preview = await json(await call({ mode: 'preview', file: csv }))
      const [p] = preview.probable as Probable[]
      expect(p.index).toBe(0)

      // A stale or forged choice is ignored: the line stays skipped
      const forged = await json(await call({ file: csv, keep: [{ index: 0, key: 'import:forged:0' }, { index: 1, key: preview.rows[1].key }] }))
      expect([forged.created, forged.probableSkipped]).toEqual([1, 1])

      const kept = await json(await call({ file: csv, keep: [{ index: p.index, key: p.key }] }))
      expect(kept.created).toBe(1)
      expect(kept.summary).toMatchObject({ probable: 1, probableKept: 1 })
      expect(await prisma.bankTransaction.count({ where: { bankAccountId: ids.aAccount, amount: '12.00' } })).toBe(2)

      // Idempotent: the kept line is now an exact duplicate
      const again = await json(await call({ mode: 'preview', file: csv }))
      expect(again.summary).toMatchObject({ new: 0, duplicates: 2, probable: 0 })
    })

    it('rejects a malformed keep list', async () => {
      const response = await call({ file: fixture('bpce.csv'), keep: [{ index: -1, key: '' }] })
      expect(response.status).toBe(400)
    })
  })
})
