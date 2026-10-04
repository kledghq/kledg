/**
 * Revolut Business API responses, shaped like the examples of the official
 * OpenAPI description (github.com/revolut-engineering/revolut-openapi,
 * json/business.json: GET /accounts, GET /accounts/{id}/bank-details,
 * GET /transactions) with fictional ids and amounts.
 */

export const ACCOUNT_EUR = 'a1b2c3d4-0000-4000-8000-00000000e0e0'
export const ACCOUNT_GBP = 'a1b2c3d4-0000-4000-8000-00000000b0b0'

export const accounts = [
  {
    id: ACCOUNT_EUR,
    name: 'Main EUR',
    balance: 12450.32,
    currency: 'EUR',
    state: 'active',
    public: false,
    created_at: '2025-02-05T14:29:22.215785Z',
    updated_at: '2026-09-30T08:01:00.000000Z',
    account_type: 'current',
  },
  {
    id: ACCOUNT_GBP,
    name: 'Main GBP',
    balance: 311.89,
    currency: 'GBP',
    state: 'active',
    public: false,
    created_at: '2025-02-05T14:29:22.215785Z',
    updated_at: '2026-09-30T08:01:00.000000Z',
    account_type: 'current',
  },
  {
    id: 'a1b2c3d4-0000-4000-8000-0000000000ff',
    name: 'Closed EUR',
    balance: 0,
    currency: 'EUR',
    state: 'inactive',
    public: false,
    created_at: '2025-02-05T14:29:22.215785Z',
    updated_at: '2026-01-01T00:00:00.000000Z',
    account_type: 'current',
  },
]

export const bankDetailsEur = [
  {
    iban: 'LT12 3250 0000 0000 0001',
    bic: 'REVOLT21',
    beneficiary: 'Atelier Exemple SAS',
    beneficiary_address: { country: 'FR', postcode: '75011' },
    bank_country: 'LT',
    pooled: false,
    schemes: ['sepa'],
    estimated_time: { unit: 'days', min: 0, max: 1 },
  },
  {
    account_no: '12345678',
    beneficiary: 'Atelier Exemple SAS',
    beneficiary_address: { country: 'FR', postcode: '75011' },
    schemes: ['swift'],
    estimated_time: { unit: 'days', min: 1, max: 3 },
  },
]

type Tx = Record<string, unknown>

export function cardPayment(id: string, createdAt: string, amount: number, state = 'completed'): Tx {
  return {
    id,
    type: 'card_payment',
    state,
    request_id: `REVP:${id}`,
    created_at: createdAt,
    updated_at: createdAt,
    ...(state === 'completed' ? { completed_at: createdAt } : {}),
    merchant: { name: 'Papeterie Centrale', city: 'Paris', category_code: '5943', country: 'FRA' },
    legs: [
      {
        leg_id: `${id}-leg`,
        account_id: ACCOUNT_EUR,
        amount,
        fee: 0,
        currency: 'EUR',
        description: 'Papeterie Centrale',
        balance: 1000,
      },
    ],
  }
}

/** Transfer between two own accounts: one leg per account. */
export function internalTransfer(id: string, createdAt: string): Tx {
  return {
    id,
    type: 'exchange',
    state: 'completed',
    created_at: createdAt,
    updated_at: createdAt,
    completed_at: createdAt,
    reference: 'Change GBP',
    legs: [
      { leg_id: `${id}-out`, account_id: ACCOUNT_EUR, amount: -100, currency: 'EUR', description: 'To GBP' },
      { leg_id: `${id}-in`, account_id: ACCOUNT_GBP, amount: 86.5, currency: 'GBP', description: 'From EUR' },
    ],
  }
}
