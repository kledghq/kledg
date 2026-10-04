/**
 * Small ledger of a fiscal year 2025 (closing 31/12) used by the golden FEC
 * test: opening entry validated at closing time of 2024 but listed first, a sale to a client with an auxiliary account and lettrage, its
 * payment, a purchase in US dollars, and labels that contain separators.
 */

import type { FecLedgerEntry, FecLedgerLine } from '../../export'

const line = (overrides: Partial<FecLedgerLine> & Pick<FecLedgerLine, 'accountCode' | 'accountLabel'>): FecLedgerLine => ({
  auxiliaryAccountNumber: null,
  auxiliaryAccountLabel: null,
  description: null,
  debit: '0.00',
  credit: '0.00',
  letteringCode: null,
  letteringDate: null,
  currencyAmount: null,
  currencyCode: null,
  ...overrides,
})

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

export const GOLDEN_LEDGER: FecLedgerEntry[] = [
  {
    journalCode: 'VE',
    journalLabel: 'Ventes',
    entryNumber: '1',
    date: day('2025-03-15'),
    reference: 'FA-2025-001',
    pieceDate: day('2025-03-14'),
    description: 'Facture Dupont',
    validatedAt: new Date('2025-03-31T22:30:00.000Z'), // 1 April in Paris
    lines: [
      line({
        accountCode: '411000',
        accountLabel: 'Clients',
        auxiliaryAccountNumber: 'C0001',
        auxiliaryAccountLabel: 'Dupont SARL',
        debit: '1200.00',
        letteringCode: 'AA',
        letteringDate: day('2025-04-10'),
      }),
      line({ accountCode: '706000', accountLabel: 'Prestations de services', credit: '1000' }),
      line({ accountCode: '445710', accountLabel: 'TVA collectée', description: 'TVA 20 %', credit: '200.00' }),
    ],
  },
  {
    journalCode: 'BQ',
    journalLabel: 'Banque',
    entryNumber: '2',
    date: day('2025-04-10'),
    reference: 'VIR 12\t34',
    pieceDate: null,
    description: 'Règlement Dupont | virement',
    validatedAt: new Date('2025-04-10T08:00:00.000Z'),
    lines: [
      line({ accountCode: '512000', accountLabel: 'Banque', debit: '1200.00' }),
      line({
        accountCode: '411000',
        accountLabel: 'Clients',
        auxiliaryAccountNumber: 'C0001',
        auxiliaryAccountLabel: 'Dupont SARL',
        credit: '1200.00',
        letteringCode: 'AA',
        letteringDate: day('2025-04-10'),
      }),
    ],
  },
  {
    journalCode: 'AC',
    journalLabel: 'Achats',
    entryNumber: '4',
    date: day('2025-12-31'),
    reference: null,
    pieceDate: null,
    description: 'Licence logicielle\nannuelle',
    validatedAt: new Date('2025-12-31T23:30:00.000Z'), // 1 January 2026 in Paris
    lines: [
      line({ accountCode: '651000', accountLabel: 'Redevances', debit: '0.10' }),
      line({ accountCode: '651000', accountLabel: 'Redevances', debit: '0.20' }),
      line({
        accountCode: '401000',
        accountLabel: 'Fournisseurs',
        auxiliaryAccountNumber: 'F0001',
        auxiliaryAccountLabel: 'Soft Inc',
        credit: '0.30',
        currencyAmount: '-0.35',
        currencyCode: 'USD',
      }),
    ],
  },
  // Opening entry (à-nouveaux): validated when 2024 was closed, after the
  // first entries of 2025, hence number 3; listed first all the same.
  {
    journalCode: 'AN',
    journalLabel: 'À-nouveaux',
    entryNumber: '3',
    date: day('2025-01-01'),
    reference: 'OU-2025',
    pieceDate: null,
    description: "Écriture d'ouverture",
    validatedAt: new Date('2025-04-20T10:00:00.000Z'),
    lines: [
      line({ accountCode: '512000', accountLabel: 'Banque', debit: '10000.00' }),
      line({ accountCode: '101000', accountLabel: 'Capital', credit: '10000.00' }),
    ],
  },
]
