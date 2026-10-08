/**
 * Movements of fixed assets and depreciation over a fiscal year, read from
 * the validated entries of the year (pure module, amounts in cents).
 *
 * The year's entries hold the whole story of an account: the opening
 * entry (journal AN, or RAN / OU from an imported FEC) gives the value at
 * the start, the other entries the movements, so the value at the end is
 * the balance the balance sheet shows (PCG art. 832-1: "le montant brut à
 * la clôture de l'exercice est la somme algébrique des colonnes
 * précédentes"). The closing entry (CL) never touches classes 1 to 5.
 *
 * Classification of a movement on a gross account (20 to 27), following
 * the columns of 2054-SD and of the table of PCG art. 832-2:
 * - debit in an entry that credits an écart de réévaluation (105): increase
 *   from a revaluation;
 * - other debit: acquisition, creation, contribution or transfer in;
 * - credit in an entry that debits another gross fixed asset account:
 *   transfer from one line to another (virement de poste à poste, an asset
 *   in progress put in service);
 * - other credit: disposal or retirement (cession, mise hors service).
 * On a depreciation account (28): credit, allowance of the year; debit,
 * depreciation of items that left the assets, or a reversal.
 *
 * An entry and its contre-passation, both in the year, cancel out and are
 * left out, so a mistaken acquisition reversed is not shown as a disposal.
 */

import {
  isDepreciationAccount,
  isGrossFixedAssetAccount,
  lineOf,
  type AssetColumn,
  type DepreciationColumn,
  type FormEntryDef,
  type SimplifiedAssetColumn,
} from './fixed-asset-forms'

export interface LedgerLine {
  entryId: string
  /** The entry this one reverses (contre-passation), if any. */
  reversalOfId: string | null
  /** The entry is an opening entry (à-nouveaux). */
  opening: boolean
  code: string
  debitCents: number
  creditCents: number
}

export interface AssetAccountMovement {
  code: string
  openingCents: number
  revaluationCents: number
  increaseCents: number
  transferOutCents: number
  disposalCents: number
  closingCents: number
}

export interface DepreciationAccountMovement {
  code: string
  openingCents: number
  allowanceCents: number
  decreaseCents: number
  closingCents: number
}

/** Entries cancelled by a contre-passation of the same year, and those reversals. */
function cancelledEntries(lines: readonly LedgerLine[]): Set<string> {
  const ids = new Set(lines.map((l) => l.entryId))
  const cancelled = new Set<string>()
  for (const l of lines) {
    if (l.reversalOfId && ids.has(l.reversalOfId)) {
      cancelled.add(l.entryId)
      cancelled.add(l.reversalOfId)
    }
  }
  return cancelled
}

/** Movements of every gross fixed asset account and depreciation account found in `lines`. */
export function accountMovements(lines: readonly LedgerLine[]): { assets: AssetAccountMovement[]; depreciation: DepreciationAccountMovement[] } {
  const cancelled = cancelledEntries(lines)
  const byEntry = new Map<string, LedgerLine[]>()
  for (const l of lines) byEntry.set(l.entryId, [...(byEntry.get(l.entryId) ?? []), l])

  const assets = new Map<string, AssetAccountMovement>()
  const depreciation = new Map<string, DepreciationAccountMovement>()
  for (const l of lines) {
    if (cancelled.has(l.entryId)) continue
    if (isGrossFixedAssetAccount(l.code)) {
      const m = assets.get(l.code) ?? { code: l.code, openingCents: 0, revaluationCents: 0, increaseCents: 0, transferOutCents: 0, disposalCents: 0, closingCents: 0 }
      const siblings = byEntry.get(l.entryId) ?? []
      if (l.opening) {
        m.openingCents += l.debitCents - l.creditCents
      } else {
        if (l.debitCents > 0) {
          const revalued = siblings.some((o) => o.code.startsWith('105') && o.creditCents > 0)
          if (revalued) m.revaluationCents += l.debitCents
          else m.increaseCents += l.debitCents
        }
        if (l.creditCents > 0) {
          const transfer = siblings.some((o) => o !== l && o.code !== l.code && isGrossFixedAssetAccount(o.code) && o.debitCents > 0)
          if (transfer) m.transferOutCents += l.creditCents
          else m.disposalCents += l.creditCents
        }
      }
      m.closingCents = m.openingCents + m.revaluationCents + m.increaseCents - m.transferOutCents - m.disposalCents
      assets.set(l.code, m)
    } else if (isDepreciationAccount(l.code)) {
      const m = depreciation.get(l.code) ?? { code: l.code, openingCents: 0, allowanceCents: 0, decreaseCents: 0, closingCents: 0 }
      if (l.opening) m.openingCents += l.creditCents - l.debitCents
      else {
        m.allowanceCents += l.creditCents
        m.decreaseCents += l.debitCents
      }
      m.closingCents = m.openingCents + m.allowanceCents - m.decreaseCents
      depreciation.set(l.code, m)
    }
  }
  const byCode = <T extends { code: string }>(map: Map<string, T>) => [...map.values()].sort((x, y) => x.code.localeCompare(y.code))
  return { assets: byCode(assets), depreciation: byCode(depreciation) }
}

export interface FormRow<C extends string> {
  id: string
  label: string
  isTotal: boolean
  /** Box code of each column on the official form. */
  codes: Partial<Record<C, string>>
  amounts: Record<C, number | null>
  /** Accounts read for the line (empty for totals). */
  accounts: string[]
}

function rows<C extends string>(form: readonly FormEntryDef<C>[], columns: readonly C[], amountsByAccount: Array<{ code: string; amounts: Partial<Record<C, number>> }>, nullColumns: readonly C[] = []): FormRow<C>[] {
  const empty = () => Object.fromEntries(columns.map((c) => [c, nullColumns.includes(c) ? null : 0])) as Record<C, number | null>
  const lineRows = new Map<string, FormRow<C>>()
  for (const entry of form) {
    if (entry.kind === 'line') lineRows.set(entry.id, { id: entry.id, label: entry.label, isTotal: false, codes: entry.codes, amounts: empty(), accounts: [] })
  }
  for (const account of amountsByAccount) {
    const def = lineOf(form, account.code)
    if (!def) continue
    const row = lineRows.get(def.id)!
    row.accounts.push(account.code)
    for (const c of columns) {
      if (nullColumns.includes(c)) continue
      row.amounts[c] = (row.amounts[c] ?? 0) + (account.amounts[c] ?? 0)
    }
  }
  return form.map((entry) => {
    if (entry.kind === 'line') return lineRows.get(entry.id)!
    const amounts = empty()
    for (const id of entry.of) {
      const part = lineRows.get(id)
      if (!part) continue
      for (const c of columns) {
        if (nullColumns.includes(c)) continue
        amounts[c] = (amounts[c] ?? 0) + (part.amounts[c] ?? 0)
      }
    }
    return { id: entry.id, label: entry.label, isTotal: true, codes: entry.codes, amounts, accounts: [] }
  })
}

const COLUMNS_2054: readonly AssetColumn[] = ['opening', 'revaluation', 'increase', 'transferOut', 'disposal', 'closing', 'origin']
const COLUMNS_DEPRECIATION: readonly DepreciationColumn[] = ['opening', 'allowance', 'decrease', 'closing']
const COLUMNS_2033C: readonly SimplifiedAssetColumn[] = ['opening', 'increase', 'decrease', 'closing']

/**
 * Rows of 2054-SD. The original value of revalued items (cadre B, column 4)
 * is left empty: Kledg does not follow a legal revaluation item by item.
 */
export function form2054Rows(form: readonly FormEntryDef<AssetColumn>[], assets: readonly AssetAccountMovement[]): FormRow<AssetColumn>[] {
  return rows(
    form,
    COLUMNS_2054,
    assets.map((m) => ({
      code: m.code,
      amounts: { opening: m.openingCents, revaluation: m.revaluationCents, increase: m.increaseCents, transferOut: m.transferOutCents, disposal: m.disposalCents, closing: m.closingCents },
    })),
    ['origin'],
  )
}

/** Rows of 2055-SD cadre A or 2033-C-SD cadre II. */
export function depreciationRows(form: readonly FormEntryDef<DepreciationColumn>[], accounts: readonly DepreciationAccountMovement[]): FormRow<DepreciationColumn>[] {
  return rows(
    form,
    COLUMNS_DEPRECIATION,
    accounts.map((m) => ({ code: m.code, amounts: { opening: m.openingCents, allowance: m.allowanceCents, decrease: m.decreaseCents, closing: m.closingCents } })),
  )
}

/** Rows of 2033-C-SD cadre I: one increase column (revaluations included) and one decrease column (transfers included). */
export function form2033cRows(form: readonly FormEntryDef<SimplifiedAssetColumn>[], assets: readonly AssetAccountMovement[]): FormRow<SimplifiedAssetColumn>[] {
  return rows(
    form,
    COLUMNS_2033C,
    assets.map((m) => ({
      code: m.code,
      amounts: { opening: m.openingCents, increase: m.revaluationCents + m.increaseCents, decrease: m.transferOutCents + m.disposalCents, closing: m.closingCents },
    })),
  )
}

/** The amount of a row's column, 0 when absent. */
export function amountOf<C extends string>(rowsOfForm: readonly FormRow<C>[], id: string, column: C): number {
  return rowsOfForm.find((r) => r.id === id)?.amounts[column] ?? 0
}
