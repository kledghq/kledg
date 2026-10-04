/**
 * Ponto API responses, shaped like the examples of the official reference
 * (https://documentation.myponto.com/api: create access token, list
 * accounts, list transactions, list financial institutions, create
 * synchronization) with fictional ids, IBANs and amounts.
 */

export const API = 'https://api.myponto.com'
export const ACCOUNT_ID = '2ca42e3a-357b-4dc4-a22f-197d049cd2fa'
export const INSTITUTION_ID = 'fce49936-8ea7-4e8a-945e-1a1b42c95df7'

export const token = { access_token: 'ponto_access_1', expires_in: 1799, scope: 'ai pi', token_type: 'bearer' }

export const accountsPage = {
  data: [
    {
      attributes: {
        deprecated: false,
        description: 'Compte courant pro',
        reference: 'FR7630004000031234567890143',
        product: 'Current account',
        currency: 'EUR',
        subtype: 'checking',
        availableBalance: 8200.15,
        currentBalance: 8150.15,
        holderName: 'Atelier Exemple SAS',
        referenceType: 'IBAN',
        authorizationExpirationExpectedAt: '2027-03-30T09:55:40.898Z',
        authorizedAt: '2026-10-01T09:55:40.898Z',
        internalReference: 'b97d53de-ba75-4191-9ce0-f7798b4b62ae',
      },
      id: ACCOUNT_ID,
      meta: {
        availability: 'available',
        latestSynchronization: {
          attributes: {
            createdAt: '2026-10-03T06:00:00.000Z',
            customerOnline: false,
            errors: [],
            resourceId: ACCOUNT_ID,
            resourceType: 'account',
            status: 'success',
            subtype: 'accountDetails',
            updatedAt: '2026-10-03T06:00:05.000Z',
          },
          id: '43707b3a-46fc-4843-8209-acd1617dc530',
          type: 'synchronization',
        },
        synchronizedAt: '2026-10-03T06:00:05.000Z',
      },
      type: 'account',
      relationships: {
        financialInstitution: { data: { id: INSTITUTION_ID, type: 'financialInstitution' } },
      },
    },
    {
      attributes: {
        deprecated: true,
        description: 'Ancien compte',
        reference: 'FR7610107001011234567890129',
        product: 'Current account',
        currency: 'EUR',
        availableBalance: 0,
        currentBalance: 0,
        referenceType: 'IBAN',
        authorizationExpirationExpectedAt: null,
      },
      id: 'deprecated-account',
      type: 'account',
    },
  ],
  links: { first: `${API}/accounts?page[limit]=100` },
  meta: { paging: { limit: 100 } },
}

export function transaction(id: string, executionDate: string, amount: number, extra: Record<string, unknown> = {}) {
  return {
    attributes: {
      description: 'Virement',
      currency: 'EUR',
      digest: `digest-${id}`,
      amount,
      fee: null,
      additionalInformation: null,
      bankTransactionCode: 'PMNT-RCDT-ESCT',
      cardReference: null,
      cardReferenceType: null,
      counterpartName: 'Client Durand',
      counterpartReference: 'FR7610107001011234567890129',
      createdAt: executionDate,
      creditorId: null,
      endToEndId: `E2E-${id}`,
      executionDate,
      mandateId: null,
      proprietaryBankTransactionCode: null,
      purposeCode: null,
      remittanceInformation: `FACTURE ${id}`,
      remittanceInformationType: 'unstructured',
      updatedAt: executionDate,
      valueDate: executionDate,
      internalReference: `internal-${id}`,
      ...extra,
    },
    id,
    type: 'transaction',
    relationships: { account: { data: { id: ACCOUNT_ID, type: 'account' } } },
  }
}

export function transactionsPage(items: unknown[], next?: string) {
  return {
    data: items,
    links: { first: `${API}/accounts/${ACCOUNT_ID}/transactions?page[limit]=100`, ...(next ? { next } : {}) },
    meta: { paging: { limit: 100 }, synchronizedAt: '2026-10-03T06:00:05.000Z' },
  }
}

export const institutionsPage = {
  data: [
    {
      attributes: {
        name: 'BNP Paribas - Ma Banque Entreprise',
        status: 'beta',
        deprecated: false,
        country: 'FR',
        logoUrl: 'https://ibanity-production-financial-institution-assets.s3.eu-central-1.amazonaws.com/bnp.svg',
        primaryColor: '#009662',
        expectedAuthorizationLifetime: 180,
        pendingTransactionsAvailable: true,
      },
      id: INSTITUTION_ID,
      type: 'financialInstitution',
    },
    {
      attributes: {
        name: 'Ancienne banque',
        status: 'stable',
        deprecated: true,
        country: 'FR',
        logoUrl: null,
        primaryColor: null,
        expectedAuthorizationLifetime: 90,
      },
      id: 'old-bank',
      type: 'financialInstitution',
    },
  ],
  links: {},
  meta: { paging: { limit: 100 } },
}

export const pontoError = (code: string, detail: string) => ({ errors: [{ code, detail, meta: {} }] })
