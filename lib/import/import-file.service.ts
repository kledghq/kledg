/**
 * Accounting file imports (POST /api/import) and the fiscal years a FEC
 * covers (POST /api/import/preview-fiscal-years): validates the multipart
 * form or the JSON body, guards the file (size, zip bomb), then hands it to
 * the FEC, CSV or Excel importer of the company.
 *
 * The importers record per entry failures with French reasons in `errors`;
 * anything unexpected becomes the generic message (lib/accounting/errors.ts
 * handleError), never a database or library message.
 */

import { z } from 'zod'
import { ValidationError } from '@/lib/accounting/errors'
import { assertFileSize, isZip } from '@/lib/api/files'
import { jsonFormField, parseInput } from '@/lib/api/zod-fields'
import { logger } from '@/lib/logger'
import { importFEC, previewFECFiscalYears } from '@/lib/import/fec'
import { importCSV } from '@/lib/import/csv'
import { importExcel } from '@/lib/import/excel'

/** Columns of the file chosen for each FEC field ('' is a column without header). */
const FecColumnMappingSchema = z.object({
  JournalCode: z.string(),
  JournalLib: z.string(),
  EcritureNum: z.string(),
  EcritureDate: z.string(),
  CompteNum: z.string(),
  CompteLib: z.string(),
  CompAuxNum: z.string().optional(),
  CompAuxLib: z.string().optional(),
  PieceRef: z.string().optional(),
  PieceDate: z.string().optional(),
  EcritureLib: z.string().optional(),
  Debit: z.string(),
  Credit: z.string(),
  EcritureLet: z.string().optional(),
  DateLet: z.string().optional(),
  ValidDate: z.string().optional(),
  Montantdevise: z.string().optional(),
  Idevise: z.string().optional(),
})

/** File code to an existing account or journal id of the company (null: create it). lib/import/fec checks ownership. */
const IdMappingSchema = z.record(z.string(), z.string().nullable())

const IMPORT_TYPE_MESSAGE = 'Type de fichier inconnu : fec, csv ou excel'

/** Fields of the multipart form of POST /api/import (the company comes from `companyId`). */
const ImportFormSchema = z.object({
  file: z.instanceof(File, { error: 'Choisissez le fichier à importer.' }),
  type: z.enum(['fec', 'csv', 'excel'], { error: IMPORT_TYPE_MESSAGE }),
  mapping: jsonFormField(FecColumnMappingSchema, 'Correspondance des colonnes invalide'),
  accountMapping: jsonFormField(IdMappingSchema, 'Correspondance des comptes invalide'),
  journalMapping: jsonFormField(IdMappingSchema, 'Correspondance des journaux invalide'),
  cleanEntryNumbers: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
})

/** Body of POST /api/import/preview-fiscal-years: the FEC content, inline. */
export const PreviewFecFiscalYearsBody = z.object({
  content: z.string({ error: 'Le contenu du fichier FEC est requis' }).min(1, 'Le contenu du fichier FEC est requis'),
  mapping: FecColumnMappingSchema.nullish().transform((value) => value ?? undefined),
})
export type PreviewFecFiscalYearsInput = z.infer<typeof PreviewFecFiscalYearsBody>

/** The form fields as the schema expects them: a missing field is undefined, not null. */
function formFields(form: FormData): Record<string, FormDataEntryValue | undefined> {
  const fields: Record<string, FormDataEntryValue | undefined> = {}
  for (const name of Object.keys(ImportFormSchema.shape)) fields[name] = form.get(name) ?? undefined
  return fields
}

/** Imports the uploaded file into the company and returns the importer's report. */
export async function importAccountingFile(companyId: string, form: FormData) {
  const input = parseInput(ImportFormSchema, formFields(form))
  const { file, type } = input
  assertFileSize(file)

  logger.debug('[import] POST request', {
    type,
    companyId,
    fileName: file.name,
    fileSize: file.size,
    hasMapping: !!input.mapping,
    hasAccountMapping: !!input.accountMapping,
    hasJournalMapping: !!input.journalMapping,
    cleanEntryNumbers: input.cleanEntryNumbers,
  })

  const result = await importByType(companyId, input)

  logger.debug('[import] Result', {
    type,
    companyId,
    success: result.success,
    entriesCreated: result.entriesCreated,
    errorsCount: result.errors?.length ?? 0,
    errorsSample: result.errors?.slice(0, 3),
  })
  return result
}

async function importByType(companyId: string, input: z.infer<typeof ImportFormSchema>) {
  const { file } = input
  switch (input.type) {
    case 'fec':
      // Bytes, not text: the FEC may be encoded in ISO 8859-15 (LPF art. A47 A-1)
      return importFEC({
        companyId,
        bytes: new Uint8Array(await file.arrayBuffer()),
        columnMapping: input.mapping,
        accountMapping: input.accountMapping,
        journalMapping: input.journalMapping,
        cleanEntryNumbers: input.cleanEntryNumbers,
      })
    case 'csv':
      return importCSV({ companyId, content: await file.text() })
    case 'excel': {
      const buffer = Buffer.from(await file.arrayBuffer())
      // ExcelJS only reads .xlsx (a zip); parseExcel inflates it under a byte budget first (zip bomb guard)
      if (!isZip(buffer)) {
        throw new ValidationError('Fichier Excel invalide : seuls les fichiers .xlsx sont acceptés.')
      }
      return importExcel({ companyId, file: buffer })
    }
  }
}

/** Fiscal years the FEC covers (existing or to create), shown by the import dialog before importing. */
export async function previewImportFiscalYears(companyId: string, input: PreviewFecFiscalYearsInput) {
  return previewFECFiscalYears({ companyId, content: input.content, columnMapping: input.mapping })
}
