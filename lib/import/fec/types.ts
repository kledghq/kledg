/**
 * Types for FEC (Fichier des Écritures Comptables) import
 */

import type { FECColumnMapping } from '@/lib/import/types';

/**
 * FEC line structure (the 18 fields of LPF art. A47 A-1)
 */
export interface FECLine {
  JournalCode: string;
  JournalLib: string;
  EcritureNum: string;
  EcritureDate: string;
  CompteNum: string;
  CompteLib: string;
  CompAuxNum?: string;
  CompAuxLib?: string;
  PieceRef?: string;
  PieceDate?: string;
  EcritureLib?: string;
  Debit: string;
  Credit: string;
  EcritureLet?: string;
  DateLet?: string;
  ValidDate?: string;
  Montantdevise?: string;
  Idevise?: string;
}

/**
 * Fiscal year information for import results
 */
export interface FiscalYearInfo {
  id: string;
  year: number;
  startDate: string;
  endDate: string;
  wasCreated: boolean;
  entriesCount: number;
  linesCount: number;
  accountsCount?: number;
  journalsCount?: number;
  /** The fiscal year exists and is closed: nothing can be imported into it. */
  isClosed?: boolean;
}

/** An entry of the file that was not imported, and why (French). */
export interface RefusedFecEntry {
  /** "VT n° 12" */
  entry: string;
  /** First line of the entry in the file (header = line 1). */
  line: number;
  reason: string;
}

/**
 * Result of FEC import operation.
 *
 * The import is atomic: either every entry of the file is imported, or none
 * (success false, `refused` and `errors` say why).
 */
export interface ImportResult {
  success: boolean;
  entriesCreated: number;
  linesCreated?: number;
  accountsCreated: number;
  journalsCreated: number;
  /** One French message per refused entry or blocking problem. */
  errors: string[];
  refused?: RefusedFecEntry[];
  /** Imported anyway, worth checking (French). */
  warnings?: string[];
  fiscalYears?: FiscalYearInfo[];
  encoding?: string;
  separator?: string;
}

/**
 * Options for FEC import
 */
export interface FECImportOptions {
  companyId: string;
  /** Decoded content (UTF-8). Pass `bytes` instead to detect ISO 8859-15. */
  content?: string;
  bytes?: Uint8Array;
  columnMapping?: FECColumnMapping;
  accountMapping?: Record<string, string | null>; // file account code -> existing account id
  journalMapping?: Record<string, string | null>; // file journal code -> existing journal id
  cleanEntryNumbers?: boolean; // If true, removes leading zeros from entry numbers (e.g., "001" -> "1")
}
