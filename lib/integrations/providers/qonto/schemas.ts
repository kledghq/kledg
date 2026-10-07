/**
 * What Kledg reads in the Qonto responses that feed the books, checked at
 * the edge (lib/banking/provider-response.ts). Loose objects: other fields
 * pass through.
 */

import { z } from 'zod'

const QontoTransactionSchema = z.looseObject({
  transaction_id: z.string(),
  amount: z.number(),
  // Never guessed: a line without its direction would be booked the wrong way
  side: z.enum(['debit', 'credit']),
  emitted_at: z.string().nullish(),
  settled_at: z.string().nullish(),
  status: z.string().nullish(),
})

export const QontoTransactionsResponseSchema = z.looseObject({
  transactions: z.array(QontoTransactionSchema),
  meta: z.looseObject({ next_page: z.number().nullable() }),
})

export const QontoOrganizationSchema = z.looseObject({
  organization: z.looseObject({
    bank_accounts: z.array(z.looseObject({ id: z.string().optional(), iban: z.string(), balance: z.number().optional() })),
  }),
})
