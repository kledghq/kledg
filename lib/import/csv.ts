// Import CSV
import Papa from 'papaparse'
import { prisma } from '@/lib/prisma'
import { validateEntryBalance } from '@/lib/accounting/validator'
import { createAccountingEntryWithWarnings } from '@/lib/accounting/services'
import type { EntryLine } from '@/lib/accounting/types'
import type { PCGWarning } from '@/lib/accounting/services'
import { handleError, ValidationError } from '@/lib/accounting/errors'
import { fromCents } from '@/lib/utils/money'
import { importAmountCents } from './amount'
import { loadExistingEntries } from './duplicate-entries'
import { journalAccounts } from './journal-accounts'

interface CSVImportOptions {
  companyId: string
  content: string
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
 * Parse un fichier CSV
 */
export function parseCSV(content: string): Record<string, string>[] {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
  })

  if (result.errors.length > 0) {
    // Papa Parse rows are 0-based data rows: +2 gives the line of the file (after the header)
    const lines = [...new Set(result.errors.map((e) => (typeof e.row === 'number' ? e.row + 2 : null)))].filter((l) => l !== null)
    throw new ValidationError(
      lines.length
        ? `Fichier CSV illisible, lignes à corriger : ${lines.slice(0, 10).join(', ')}${lines.length > 10 ? '...' : ''}`
        : 'Fichier CSV illisible : vérifiez le séparateur et les guillemets.',
    )
  }

  return result.data
}

/**
 * Importe un fichier CSV
 */
export async function importCSV(
  options: CSVImportOptions
): Promise<ImportResult> {
  const { companyId, content, mapping } = options
  const result: ImportResult = {
    success: true,
    entriesCreated: 0,
    accountsCreated: 0,
    journalsCreated: 0,
    errors: [],
    pcgWarnings: [],
  }

  try {
    const rows = parseCSV(content)

    if (rows.length === 0) {
      throw new ValidationError('Le fichier CSV est vide')
    }

    // Mapping par défaut (première ligne comme en-tête)
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

    // Grouper les lignes par écriture
    const entriesMap = new Map<string, Record<string, string>[]>()

    for (const row of rows) {
      const entryKey = `${row[defaultMapping.journalColumn]}-${row[defaultMapping.entryNumberColumn]}-${row[defaultMapping.dateColumn]}`
      if (!entriesMap.has(entryKey)) {
        entriesMap.set(entryKey, [])
      }
      entriesMap.get(entryKey)!.push(row)
    }

    // Create the journals of the file
    const journalsMap = new Map<string, string>()
    // Accounts are taken in the fiscal year of each entry (journal-accounts.ts)
    const accounts = journalAccounts(companyId, result)

    for (const row of rows) {
      const journalCode = String(row[defaultMapping.journalColumn] || 'OD')
      const accountCode = String(row[defaultMapping.accountColumn] || '')

      if (!journalCode || !accountCode) {
        continue
      }

      // Créer le journal
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
    }

    // Créer les écritures
    // Entries already imported (same journal, day, texts and lines): skipped
    const existingEntries = await loadExistingEntries(
      companyId,
      [...new Set(journalsMap.values())],
      [...entriesMap.values()].map((lines) => new Date(lines[0][defaultMapping.dateColumn])),
    )
    for (const [key, lines] of entriesMap.entries()) {
      try {
        const firstLine = lines[0]
        const journalCode = String(firstLine[defaultMapping.journalColumn] || 'OD')
        const journalId = journalsMap.get(journalCode)!

        if (!journalId) {
          result.errors.push(`Journal introuvable pour l'écriture ${key}`)
          continue
        }

        const entryNumber = String(firstLine[defaultMapping.entryNumberColumn] || '')
        const entryDate = new Date(firstLine[defaultMapping.dateColumn])


        // CSV lines to EntryLine, amounts read exactly (French notation accepted)
        const amounts = lines.map((l) => ({
          debit: importAmountCents(l[defaultMapping.debitColumn]),
          credit: importAmountCents(l[defaultMapping.creditColumn]),
        }))
        if (amounts.some((a) => a.debit === null || a.credit === null)) {
          result.errors.push(`Écriture ${entryNumber}: montant invalide (exemple : 1 234,56)`)
          continue
        }
        const fiscalYearId = await accounts.fiscalYearId(entryDate)
        const lineAccountIds: string[] = []
        for (const l of lines) {
          lineAccountIds.push(await accounts.accountId(fiscalYearId, String(l[defaultMapping.accountColumn] || '')))
        }
        const entryLines: EntryLine[] = lines.map((l, i) => ({
          accountId: lineAccountIds[i],
          debit: fromCents(amounts[i].debit ?? 0),
          credit: fromCents(amounts[i].credit ?? 0),
          description: String(l[defaultMapping.descriptionColumn] || ''),
        }))

        // Valider l'équilibre avec le service centralisé
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

        // Créer l'écriture avec le service métier et capturer les avertissements PCG
        try {
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
          
          // Collecter les avertissements PCG s'il y en a
          if (entryResult.warnings.length > 0) {
            result.pcgWarnings.push({
              entryNumber,
              warnings: entryResult.warnings,
            })
          }
        } catch (error) {
          // Si l'erreur vient d'une validation PCG, on l'ajoute aux erreurs
          result.errors.push(`Écriture ${entryNumber}: ${handleError(error).message}`)
        }
      } catch (error) {
        result.errors.push(`Erreur lors de l'import de l'écriture ${key}: ${handleError(error).message}`)
      }
    }

    result.success = result.errors.length === 0
  } catch (error) {
    result.errors.push(`Import interrompu : ${handleError(error).message}`)
    result.success = false
  }

  return result
}
