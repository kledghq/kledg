/**
 * Fingerprint of a statement layout (the line configuration of a company's
 * balance sheet or income statement), to tell an untouched default layout
 * from one the user changed.
 *
 * What makes a layout: the lines (label path, section, form code, order)
 * and their account rules (codes, exclusions, depreciation codes, balance
 * type). Ids, line types (income statement lines have none), display
 * options and timestamps are left out, so the
 * fingerprint of the rows stored by createDefault*Config equals the
 * fingerprint of the default entries they were made from.
 */

import { createHash } from 'crypto'

export interface LayoutRow {
  id: string
  parentId?: string | null
  section?: string | null
  lineLabel: string
  lineType?: string | null
  formCode?: string | null
  accountCodes: string[]
  excludedAccountCodes?: string[] | null
  amortissementAccountCodes?: string[] | null
  balanceType: string
  order: number
}

export function layoutFingerprint(rows: LayoutRow[]): string {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const pathOf = (row: LayoutRow): { path: string; section: string | null } => {
    const labels: string[] = []
    let section: string | null = null
    let current: LayoutRow | undefined = row
    const seen = new Set<string>()
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      labels.unshift(current.lineLabel)
      section = section ?? current.section ?? null
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
    return { path: labels.join(' > '), section }
  }
  const sorted = (codes: string[] | null | undefined) => [...(codes ?? [])].sort()
  const entries = rows
    .map((row) => {
      const { path, section } = pathOf(row)
      return JSON.stringify([
        path,
        section,
        row.formCode ?? null,
        sorted(row.accountCodes),
        sorted(row.excludedAccountCodes),
        sorted(row.amortissementAccountCodes),
        row.balanceType,
        row.order,
      ])
    })
    .sort()
  return createHash('sha256').update(entries.join('\n')).digest('hex')
}
