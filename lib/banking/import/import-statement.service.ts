/**
 * Bank statement file import (CSV, Excel, OFX/QFX, camt.053) into a bank
 * account of a company: the analysis shown before importing, and the import.
 * Used by POST /api/banking/import-statement (runStatementForm) and the MCP server.
 *
 * The analysis never writes. The import parses the same file with the same
 * options again and recomputes duplicates (importer.ts), so nothing from a
 * previous analysis is trusted: a probable duplicate is imported only when
 * the caller keeps it and it is still a probable duplicate at the same index
 * with the same key.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { assertFileSize } from '@/lib/api/files'
import { FRENCH_ERRORS } from '@/lib/api/zod-fields'
import { parseStatementFile } from './parse'
import { commitImport, planImport, type KeptProbable } from './importer'
import { centsToDecimal } from '@/lib/utils/money'
import { COLUMN_ROLES, DATE_FORMAT_VALUES, type TabularOptions } from './types'
import { plural } from '@/lib/utils/plural'

const columnIndex = z.number().int().min(0).max(500)

export const statementOptionsSchema = z
  .object({
    mapping: z.partialRecord(z.enum(COLUMN_ROLES), columnIndex).optional(),
    dateFormat: z.enum(DATE_FORMAT_VALUES).optional(),
    decimalSeparator: z.enum([',', '.']).optional(),
    headerRow: z.number().int().min(-1).max(1000).optional(),
    preset: z.string().max(64).optional(),
    delimiter: z.enum([';', ',', '\t', '|']).optional(),
    sheetName: z.string().max(200).optional(),
  })
  .strict()

export const keptProbablesSchema = z
  .array(z.object({ index: z.number().int().min(0), key: z.string().min(1).max(200) }).strict())
  .max(100_000)

const PREVIEW_ROWS = 50
const MAX_ERRORS = 100

export const BANK_ACCOUNT_NOT_FOUND_MESSAGE = 'Compte bancaire non trouvé'

export interface StatementFile {
  companyId: string
  bankAccountId: string
  bytes: Uint8Array
  fileName: string
  options?: TabularOptions
  /** Probable duplicates to import anyway. */
  keep?: KeptProbable[]
}

async function targetAccount(companyId: string, bankAccountId: string) {
  if (!bankAccountId) throw new ValidationError('Choisissez le compte bancaire à alimenter.')
  const account = await prisma.bankAccount.findFirst({
    where: { id: bankAccountId, bankConnection: { companyId } },
    select: { id: true, iban: true, externalAccountId: true, currency: true },
  })
  if (!account) throw new NotFoundError(BANK_ACCOUNT_NOT_FOUND_MESSAGE)
  return account
}

async function plan(file: StatementFile) {
  const account = await targetAccount(file.companyId, file.bankAccountId)
  const parsed = await parseStatementFile(file.bytes, file.options ?? {})
  const result = await planImport(account, parsed, file.keep ?? [])
  const base = {
    format: parsed.format,
    encoding: parsed.encoding ?? null,
    tabular: parsed.tabular ?? null,
    summary: result.summary,
    warnings: result.warnings,
    errors: result.errors.slice(0, MAX_ERRORS),
    errorCount: result.errors.length,
  }
  return { account, parsed, plan: result, base }
}

/**
 * What the import would do: format, summary (new lines, exact and probable
 * duplicates, period, totals), warnings, errors, the first lines and every
 * probable duplicate with the transaction it matches.
 */
export async function analyzeStatement(file: StatementFile) {
  const { plan: result, base } = await plan(file)
  const view = ({ transaction: t, duplicate, externalId, match }: (typeof result.rows)[number], index: number) => ({
    index,
    key: externalId,
    line: t.line,
    bookingDate: t.bookingDate,
    valueDate: t.valueDate ?? null,
    label: t.label,
    reference: t.reference ?? null,
    counterparty: t.counterparty ?? null,
    amount: centsToDecimal(t.amountCents),
    duplicate,
    match: match ? { ...match, amount: centsToDecimal(match.amountCents) } : null,
  })
  return {
    ...base,
    rows: result.rows.slice(0, PREVIEW_ROWS).map(view),
    // Every probable duplicate, so the user can keep any of them
    probable: result.rows.map(view).filter((r) => r.duplicate === 'probable'),
  }
}

export type StatementAnalysis = Awaited<ReturnType<typeof analyzeStatement>>

/**
 * Imports the new lines (and the kept probable duplicates) atomically.
 * Refused when the file has a blocking error, or lines in error unless
 * `allowErrors`. Importing the same file twice creates nothing the second time.
 */
export async function importStatement(file: StatementFile & { allowErrors?: boolean }) {
  const { account, parsed, plan: result, base } = await plan(file)
  const blocking = result.errors.filter((e) => e.line === 0)
  if (blocking.length > 0) throw new ValidationError(blocking[0].message)
  const fileLevel = result.errors.find((e) => e.line === -1)
  if (fileLevel && !file.allowErrors) throw new ValidationError(`${fileLevel.message} Confirmez pour importer quand même.`)
  if (result.errors.length > 0 && !file.allowErrors) {
    throw new ValidationError(
      `Le fichier contient ${plural(result.errors.length, 'ligne')} en erreur : corrigez la correspondance des colonnes ou confirmez l'import des lignes valides.`,
    )
  }
  if (result.rows.length === 0) throw new ValidationError('Aucune opération à importer dans ce fichier.')

  const created = await commitImport(account, result, { format: parsed.format, fileName: file.fileName }, file.keep ?? [])
  return {
    ...base,
    created,
    // Lines another import inserted meanwhile count as exact duplicates
    duplicates: result.summary.duplicates + (result.summary.new - created),
    probableSkipped: result.summary.probable - result.summary.probableKept,
  }
}

export type StatementImportResult = Awaited<ReturnType<typeof importStatement>>

/**
 * A form field holding JSON, validated by `schema`; absent or empty gives
 * `fallback`. Unreadable JSON and invalid content both report `message`.
 */
function jsonFormField<T>(schema: z.ZodType<T>, fallback: T, message: string) {
  return z.unknown().transform((value, ctx): T => {
    if (value === undefined || value === null || value === '') return fallback
    let json: unknown
    try {
      json = typeof value === 'string' ? JSON.parse(value) : undefined
    } catch {
      json = undefined
    }
    const parsed = json === undefined ? null : schema.safeParse(json)
    if (!parsed?.success) {
      ctx.addIssue({ code: 'custom', message })
      return z.NEVER
    }
    return parsed.data
  })
}

const BANK_ACCOUNT_REQUIRED = 'Choisissez le compte bancaire à alimenter.'

/**
 * Multipart form of POST /api/banking/import-statement: companyId (read by
 * the route's resolver), bankAccountId, file, mode ("preview" or "import"),
 * options (JSON TabularOptions: column mapping, date and amount formats),
 * allowErrors ("true" imports the valid lines of a file with bad lines),
 * keep (JSON [{ index, key }]: probable duplicates to import anyway).
 */
export const StatementFormSchema = z.object({
  bankAccountId: z.string({ error: BANK_ACCOUNT_REQUIRED }).min(1, BANK_ACCOUNT_REQUIRED).max(200),
  file: z.instanceof(File, { error: 'Aucun fichier reçu.' }),
  mode: z.unknown().transform((value): 'preview' | 'import' => (value === 'import' ? 'import' : 'preview')),
  options: jsonFormField<TabularOptions>(statementOptionsSchema as z.ZodType<TabularOptions>, {}, "Options d'import invalides."),
  allowErrors: z.unknown().transform((value) => value === 'true'),
  keep: jsonFormField<KeptProbable[]>(keptProbablesSchema, [], 'Liste des doublons probables à conserver invalide.'),
})

/**
 * Runs the statement form of the import dialog: validates its fields and the
 * file size, then analyzes the file (preview, never writes) or imports it.
 */
export async function runStatementForm(companyId: string, form: FormData) {
  const parsed = StatementFormSchema.safeParse(Object.fromEntries(form.entries()), { error: FRENCH_ERRORS })
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(' '))
  const { bankAccountId, file, mode, options, allowErrors, keep } = parsed.data
  assertFileSize(file)
  const statement: StatementFile = {
    companyId,
    bankAccountId,
    bytes: new Uint8Array(await file.arrayBuffer()),
    fileName: file.name,
    options,
    keep,
  }
  return mode === 'preview' ? analyzeStatement(statement) : importStatement({ ...statement, allowErrors })
}
