/**
 * Request bodies of the entry routes. Amounts stay as sent (numbers or
 * decimal strings): the entry services convert them to exact cents and
 * refuse a third decimal; dates are checked by the services too
 * (lib/accounting/entry-date.ts), with French messages.
 */

import { z } from 'zod'
import type { EntryLineInput } from '@/lib/accounting/services'

const optionalText = z.string({ error: 'Texte attendu' }).nullish()
const amount = z.union([z.number(), z.string()], { error: 'Montant attendu (nombre ou texte décimal)' }).nullish()

export const EntryLineBody = z.object({
  accountId: z.string({ error: 'Chaque ligne doit indiquer son compte' }),
  debit: amount,
  credit: amount,
  description: optionalText,
  auxiliaryAccountNumber: optionalText,
  auxiliaryAccountLabel: optionalText,
})

const EntryLinesBody = z.array(EntryLineBody, { error: 'Les lignes doivent être une liste' })

const status = z.enum(['draft', 'validated'], { error: 'Le statut doit être "draft" ou "validated"' })

export const CreateEntryBody = z.object({
  journalId: z.string({ error: 'Le journal est requis' }),
  date: z.string({ error: "La date de l'écriture est requise" }),
  description: optionalText,
  reference: optionalText,
  pieceDate: optionalText,
  status: status.nullish(),
  fiscalYearId: optionalText,
  lines: EntryLinesBody.nullish(),
})

export const UpdateEntryBody = z.object({
  journalId: optionalText,
  date: optionalText,
  description: optionalText,
  reference: optionalText,
  pieceDate: optionalText,
  status: status.optional(),
  lines: EntryLinesBody.nullish(),
})

/** Lines in the shape of the entry services (absent optional fields become null). */
export function entryLines(lines: z.infer<typeof EntryLineBody>[] | null | undefined): EntryLineInput[] {
  return (lines ?? []).map((line) => ({
    accountId: line.accountId,
    debit: line.debit,
    credit: line.credit,
    description: line.description ?? null,
    auxiliaryAccountNumber: line.auxiliaryAccountNumber ?? null,
    auxiliaryAccountLabel: line.auxiliaryAccountLabel ?? null,
  }))
}

/** Ids of the entries a bulk action applies to; ids that are not strings are reported one by one. */
export const EntryIdsBody = z.object({
  entryIds: z.array(z.unknown(), { error: 'entryIds doit être une liste' }).min(1, 'Sélectionnez au moins une écriture'),
})
