// Import Excel
import { assertSafeZip } from '@/lib/api/files'
import ExcelJS from 'exceljs'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { validateEntryBalance } from '@/lib/accounting/validator'
import { createAccountingEntryWithWarnings } from '@/lib/accounting/services'
import type { EntryLine } from '@/lib/accounting/types'
import type { PCGWarning } from '@/lib/accounting/services'
import { handleError, ValidationError } from '@/lib/accounting/errors'
import { fromCents } from '@/lib/utils/money'
import { importAmountCents } from './amount'
import { loadExistingEntries } from './duplicate-entries'

interface ExcelImportOptions {
  companyId: string
  file: Buffer
  sheetName?: string
  mapping?: {
    dateColumn?: string
    journalColumn?: string
    entryNumberColumn?: string
    accountColumn?: string
    debitColumn?: string
    creditColumn?: string
    descriptionColumn?: string
    referenceColumn?: string
  }
}

interface ImportResult {
  success: boolean
  entriesCreated: number
  accountsCreated: number
  journalsCreated: number
  errors: string[]
  pcgWarnings: Array<{
    entryNumber: string
    warnings: PCGWarning[]
  }>
}

/**
 * Parse un fichier Excel (renvoie un tableau d'objets clés = en-têtes)
 */
export async function parseExcel(
  file: Buffer,
  sheetName?: string
): Promise<Array<Record<string, unknown>>> {
  // Zip bomb guard before ExcelJS inflates anything (lib/api/files.ts).
  await assertSafeZip(file)
  const workbook = new ExcelJS.Workbook()
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(file as any)
  } catch (error) {
    // ExcelJS reasons are internal (zip and XML details): logged, not shown
    logger.warn('[import/excel] Unreadable workbook', error)
    throw new ValidationError('Fichier Excel illisible : enregistrez-le au format .xlsx et réessayez.')
  }
  const worksheet = sheetName
    ? workbook.getWorksheet(sheetName)
    : workbook.worksheets[0]

  if (!worksheet) {
    throw new ValidationError('Feuille Excel introuvable')
  }

  const rows: Array<Record<string, unknown>> = []
  let headers: string[] = []
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values = row.values as unknown[]
    if (rowNumber === 1) {
      headers = values.slice(1).map((v) => String(v ?? '').trim())
      return
    }
    const obj: Record<string, unknown> = {}
    headers.forEach((header, i) => {
      if (!header) return
      const raw = values[i + 1]
      if (raw && typeof raw === 'object' && 'text' in (raw as Record<string, unknown>)) {
        obj[header] = (raw as { text: string }).text
      } else if (raw && typeof raw === 'object' && 'result' in (raw as Record<string, unknown>)) {
        obj[header] = (raw as { result: unknown }).result
      } else {
        obj[header] = raw
      }
    })
    rows.push(obj)
  })
  return rows
}

/**
 * Importe un fichier Excel
 */
export async function importExcel(
  options: ExcelImportOptions
): Promise<ImportResult> {
  const { companyId, file, sheetName, mapping } = options
  const result: ImportResult = {
    success: true,
    entriesCreated: 0,
    accountsCreated: 0,
    journalsCreated: 0,
    errors: [],
    pcgWarnings: [],
  }

  try {
    const rows = await parseExcel(file, sheetName)

    logger.debug('[import/excel] Parse done', {
      companyId,
      sheetName,
      rowsCount: rows.length,
      columns: rows[0] ? Object.keys(rows[0] as Record<string, unknown>) : [],
    })

    if (rows.length === 0) {
      throw new ValidationError('Le fichier Excel est vide')
    }

    // Default mapping
    const defaultMapping = {
      dateColumn: mapping?.dateColumn || 'date',
      journalColumn: mapping?.journalColumn || 'journal',
      entryNumberColumn: mapping?.entryNumberColumn || 'entryNumber',
      accountColumn: mapping?.accountColumn || 'account',
      debitColumn: mapping?.debitColumn || 'debit',
      creditColumn: mapping?.creditColumn || 'credit',
      descriptionColumn: mapping?.descriptionColumn || 'description',
      referenceColumn: mapping?.referenceColumn || 'reference',
    }

    // Group lines by entry
    const entriesMap = new Map<string, Record<string, unknown>[]>()

    for (const row of rows) {
      const entryKey = `${row[defaultMapping.journalColumn]}-${row[defaultMapping.entryNumberColumn]}-${row[defaultMapping.dateColumn]}`
      if (!entriesMap.has(entryKey)) {
        entriesMap.set(entryKey, [])
      }
      entriesMap.get(entryKey)!.push(row)
    }

    logger.debug('[import/excel] Entries grouped', {
      companyId,
      entriesCount: entriesMap.size,
      entryKeysSample: Array.from(entriesMap.keys()).slice(0, 5),
    })

    // Create necessary journals and accounts
    const journalsMap = new Map<string, string>()
    const accountsMap = new Map<string, string>()

    for (const row of rows) {
      const journalCode = String(row[defaultMapping.journalColumn] || 'OD')
      const accountCode = String(row[defaultMapping.accountColumn] || '')

      if (!journalCode || !accountCode) {
        continue
      }

      // Create the journal
      if (!journalsMap.has(journalCode)) {
        // An existing journal of the company is reused and not counted as created
        const existingJournal = await prisma.journal.findUnique({
          where: { companyId_code: { companyId, code: journalCode } },
          select: { id: true },
        })
        const journal =
          existingJournal ??
          (await prisma.journal.create({ data: { companyId, code: journalCode, label: journalCode }, select: { id: true } }))
        if (!existingJournal) result.journalsCreated++
        journalsMap.set(journalCode, journal.id)
      }

      // Create the account
      if (!accountsMap.has(accountCode)) {
        // Get active fiscal year
        const { getOrCreateActiveFiscalYear } = await import('@/lib/accounting/fiscal-year-utils')
        const activeFiscalYear = await getOrCreateActiveFiscalYear(companyId)

        logger.debug('[import/excel] Active fiscal year for accounts', {
          companyId,
          activeFiscalYearId: activeFiscalYear.id,
          activeFiscalYearYear: activeFiscalYear.year,
          accountCode,
        })

        let account = await prisma.account.findFirst({
          where: {
            companyId,
            code: accountCode,
            fiscalYearId: activeFiscalYear.id,
          },
        })
        
        if (!account) {
          account = await prisma.account.create({
            data: {
              companyId,
              code: accountCode,
              label: accountCode,
              fiscalYearId: activeFiscalYear.id,
            },
          })
          result.accountsCreated++
        }
        
        accountsMap.set(accountCode, account.id)
      }
    }

    // Create entries
    // Entries already imported (same journal, day, texts and lines): skipped
    const existingEntries = await loadExistingEntries(
      companyId,
      [...new Set(journalsMap.values())],
      [...entriesMap.values()].map((lines) => new Date(lines[0][defaultMapping.dateColumn] as string | number | Date)),
    )
    for (const [key, lines] of entriesMap.entries()) {
      try {
        const firstLine = lines[0]
        const journalCode = String(firstLine[defaultMapping.journalColumn] || 'OD')
        const journalId = journalsMap.get(journalCode)!

        if (!journalId) {
          logger.debug('[import/excel] Journal not found for entry', { key, journalCode })
          result.errors.push(`Journal introuvable pour l'écriture ${key}`)
          continue
        }

        const entryNumber = String(firstLine[defaultMapping.entryNumberColumn] || '')
        const entryDate = new Date(firstLine[defaultMapping.dateColumn] as string | number | Date)

        logger.debug('[import/excel] Processing entry', {
          key,
          entryNumber,
          entryDate: entryDate.toISOString(),
          journalId,
          linesCount: lines.length,
        })


        // Excel lines to EntryLine, amounts read exactly (French notation accepted)
        const amounts = lines.map((l) => ({
          debit: importAmountCents(l[defaultMapping.debitColumn]),
          credit: importAmountCents(l[defaultMapping.creditColumn]),
        }))
        if (amounts.some((a) => a.debit === null || a.credit === null)) {
          result.errors.push(`Écriture ${entryNumber}: montant invalide (exemple : 1 234,56)`)
          continue
        }
        const entryLines: EntryLine[] = lines.map((l, i) => ({
          accountId: accountsMap.get(String(l[defaultMapping.accountColumn]))!,
          debit: fromCents(amounts[i].debit ?? 0),
          credit: fromCents(amounts[i].credit ?? 0),
          description: String(l[defaultMapping.descriptionColumn] || ''),
        }))

        const accountIds = entryLines.map((l) => l.accountId)
        const missingAccount = entryLines.some((l) => !l.accountId)
        if (missingAccount) {
          logger.debug('[import/excel] Missing accountId in entryLines', {
            entryNumber,
            entryLinesRaw: lines.map((l) => ({
              accountColumn: l[defaultMapping.accountColumn],
              resolvedId: accountsMap.get(String(l[defaultMapping.accountColumn])),
            })),
          })
        }

        // Validate balance with centralized service
        const validation = validateEntryBalance(entryLines)
        if (!validation.valid) {
          result.errors.push(
            `Écriture ${entryNumber}: ${validation.errors.join(', ')}`
          )
          continue
        }

        const description = String(firstLine[defaultMapping.descriptionColumn] || '')
        const reference = String(firstLine[defaultMapping.referenceColumn] || '')
        // The file's number is not compared: numbers are assigned at validation (PCG art. 1031-3)
        const duplicate = existingEntries.take({
          journalId,
          date: entryDate,
          description,
          reference,
          lines: entryLines.map((l, i) => ({ accountId: l.accountId, debitCents: amounts[i].debit ?? 0, creditCents: amounts[i].credit ?? 0 })),
        })
        if (duplicate) continue

        // Create entry with business service and capture PCG warnings
        try {
          logger.debug('[import/excel] Calling createAccountingEntryWithWarnings', {
            entryNumber,
            date: entryDate.toISOString(),
            linesCount: entryLines.length,
            accountIds,
          })
          const entryResult = await createAccountingEntryWithWarnings({
            companyId,
            journalId,
            entryNumber,
            date: entryDate,
            description,
            reference,
            status: 'validated',
            lines: entryLines,
          })

          result.entriesCreated++
          logger.debug('[import/excel] Entry created', {
            entryNumber,
            entryId: entryResult.entry.id,
            fiscalYearId: entryResult.entry.fiscalYearId,
          })

          // Collect PCG warnings if any
          if (entryResult.warnings.length > 0) {
            result.pcgWarnings.push({
              entryNumber,
              warnings: entryResult.warnings,
            })
          }
        } catch (error) {
          logger.debug('[import/excel] createAccountingEntryWithWarnings failed', {
            entryNumber,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined,
          })
          // Si l'erreur vient d'une validation PCG, on l'ajoute aux erreurs
          result.errors.push(`Écriture ${entryNumber}: ${handleError(error).message}`)
        }
      } catch (error) {
        logger.debug('[import/excel] Outer catch for entry', {
          key,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        })
        result.errors.push(`Erreur lors de l'import de l'écriture ${key}: ${handleError(error).message}`)
      }
    }

    result.success = result.errors.length === 0
  } catch (error) {
    result.errors.push(`Import interrompu : ${handleError(error).message}`)
    result.success = false
  }

  return result
}
