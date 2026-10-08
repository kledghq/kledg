/**
 * Where the sales of works (704 travaux and its rebates 7094) go on the
 * income statement. The notices define the production vendue de biens as
 * "les ventes de biens produits ou transformés par l'entreprise, la fourniture
 * de logements, les travaux effectués par les entreprises qui fournissent à
 * la fois la main-d'œuvre, les matériaux ou matières premières entrant à
 * titre principal dans les ouvrages exécutés" (2032-NOT-SD 2026, FF; 2033-B
 * line 214), and the production vendue de services as "le montant des
 * travaux, études et prestations de services exécutés" (FI; line 218).
 *
 * Kledg decides from the activity the company declares (Informations,
 * secteur d'activité): a construction company supplies its materials, its
 * works are goods (FD, 214); any other company's works are services (FG,
 * 218). The default layout is created that way; the user can still move the
 * accounts in the layout editor.
 */

import type { DefaultIncomeStatementConfigEntry } from './default-pcg-config-complete-2026'

const WORKS_ACCOUNTS = ['704', '7094'] as const

/** Sectors whose works supply the materials (construction, building trades). */
const WORKS_AS_GOODS_SECTORS = new Set(['construction'])

export function worksSoldAsGoods(sector: string | null | undefined): boolean {
  return !!sector && WORKS_AS_GOODS_SECTORS.has(sector)
}

const GOODS_CODES = new Set(['FD', '214'])
const SERVICES_CODES = new Set(['FG', '218'])

/** A copy of the default layout with the works on the goods line. */
export function withWorksAsGoods<T extends DefaultIncomeStatementConfigEntry>(entries: T[]): T[] {
  const move = (entry: T): T => {
    const codes = entry.accountCodes ?? []
    let accountCodes = codes
    if (entry.formCode && SERVICES_CODES.has(entry.formCode)) accountCodes = codes.filter((c) => !(WORKS_ACCOUNTS as readonly string[]).includes(c))
    if (entry.formCode && GOODS_CODES.has(entry.formCode)) accountCodes = [...codes, ...WORKS_ACCOUNTS]
    return { ...entry, accountCodes, children: entry.children?.map((c) => move(c as T)) }
  }
  return entries.map(move)
}
