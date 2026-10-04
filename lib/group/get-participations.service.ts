/**
 * Participations of a holding (tableau des filiales et participations):
 * for each subsidiary, the share of its capital the holding holds, the book
 * value of the titres in the holding (261, net of the 2961 depreciation),
 * the subsidiary's capital, capitaux propres, chiffre d'affaires and result
 * of the year, the holding's share of those capitaux propres, its loans and
 * advances to the subsidiary and the dividends it received. These are the
 * columns of the forms 2059-G-SD (régime réel normal) and 2033-G-SD (régime
 * simplifié, filiales et participations), and of the table of the annexe.
 *
 * Classification (Code de commerce): more than 50 % of the capital, a
 * filiale (art. L233-1); 10 % to 50 %, a participation (art. L233-2).
 *
 * The book value is read in the holding's books: a 261 sub-account is
 * attributed to the subsidiary its label names (or whose SIREN it carries);
 * the titres no label attributes are listed apart, never guessed. The
 * subsidiary's own figures are read in its scope after the access check: a
 * subsidiary the user cannot read is counted, not read.
 */

import type { GroupAccess } from '@/lib/management-fees/access'
import { computeBalanceIndicators } from '@/lib/reports/financial-indicators/balance-indicators'
import { computeSig } from '@/lib/reports/financial-indicators/sig'
import { loadStatementAccounts } from '@/lib/reports/statements/load'
import type { AccountTotals } from '@/lib/reports/statements/allocation'
import { GroupViewQuerySchema, periodRef, resolveHoldingFiscalYear, type GroupViewQuery, type PeriodRef } from './get-group-view.service'
import { companyNamedIn } from './match'
import { readIfAllowed, resolveGroup, type UnreachableSubsidiary } from './perimeter'
import { participationKindOf, samePeriod, shareOfCents, type ParticipationKind } from './periods'
import { matchFiscalYear, readBalanceObservations, readDividendObservations } from './read-member'

export const ParticipationsQuerySchema = GroupViewQuerySchema
export type ParticipationsQuery = GroupViewQuery

export interface ParticipationRow {
  subsidiaryId: string
  name: string
  siren: string | null
  kind: ParticipationKind
  ownershipBp: number
  numberOfShares: number | null
  /** Titres 261 attributed to the subsidiary, gross, in the holding's books. */
  bookValueGrossCents: number
  /** Dépréciation 2961 attributed to it. */
  depreciationCents: number
  bookValueNetCents: number
  /** The subsidiary's fiscal year read, null when none covers the period. */
  fiscalYear: PeriodRef | null
  samePeriod: boolean
  /** Capital (101 to 104 and 108), capitaux propres (result included), chiffre d'affaires and result, in its books. */
  capitalCents: number | null
  capitauxPropresCents: number | null
  /** ownership x capitaux propres, rounded to the cent. */
  quotePartCents: number | null
  chiffreAffairesCents: number | null
  resultatCents: number | null
  /** Loans and advances of the holding to the subsidiary (267, 451, 455 in debit, 168 aside). */
  loansCents: number
  /** Dividends the holding received from it over the year (761). */
  dividendsCents: number
}

export interface UnattributedTitres {
  accountCode: string
  label: string
  cents: number
}

export interface ParticipationsReport {
  holding: { id: string; name: string }
  fiscalYear: PeriodRef
  rows: ParticipationRow[]
  unreachable: UnreachableSubsidiary[]
  /** 261 and 2961 sub-accounts of the holding whose label names no readable subsidiary. */
  unattributed: UnattributedTitres[]
  totals: { bookValueGrossCents: number; depreciationCents: number; bookValueNetCents: number; dividendsCents: number }
}

const balanceOf = (a: AccountTotals) => a.debitCents - a.creditCents
const sumPrefixes = (accounts: readonly AccountTotals[], prefixes: readonly string[]) =>
  accounts.filter((a) => prefixes.some((p) => a.code.startsWith(p))).reduce((sum, a) => sum + balanceOf(a), 0)

/** Capital accounts read for the "capital" column: capital (101), primes (104), compte de l'exploitant (108). */
const CAPITAL_PREFIXES = ['101', '104', '108']

export async function getParticipations(holdingId: string, query: ParticipationsQuery, access: GroupAccess): Promise<ParticipationsReport> {
  const fy = await resolveHoldingFiscalYear(holdingId, query.fiscalYearId)
  const perimeter = await resolveGroup(holdingId, access)
  const subs = perimeter.subsidiaries
  const refs = [perimeter.holding, ...subs]

  // The holding's own books, in the request's scope: the route or the tool checked the holding.
  const [accounts, balances, dividends] = await Promise.all([
    loadStatementAccounts(holdingId, fy),
    readBalanceObservations(holdingId, fy.id, refs),
    readDividendObservations(holdingId, fy.id, refs),
  ])
  const observations = [...balances, ...dividends]

  const titres = new Map<string, { gross: number; depreciation: number }>()
  const unattributed: UnattributedTitres[] = []
  for (const account of accounts) {
    const isTitre = account.code.startsWith('261')
    const isDepreciation = account.code.startsWith('2961')
    const cents = isTitre ? balanceOf(account) : isDepreciation ? -balanceOf(account) : 0
    if (cents === 0) continue
    const sub = companyNamedIn(subs, account.label)
    if (!sub) {
      unattributed.push({ accountCode: account.code, label: account.label ?? '', cents })
      continue
    }
    const current = titres.get(sub.id) ?? { gross: 0, depreciation: 0 }
    if (isTitre) current.gross += cents
    else current.depreciation += cents
    titres.set(sub.id, current)
  }

  const rows: ParticipationRow[] = []
  const unreachable = [...perimeter.unreachable]
  for (const sub of subs) {
    const read = await readIfAllowed(access, sub.id, async () => {
      const year = await matchFiscalYear(sub.id, fy.startDate, fy.endDate)
      return { year, accounts: year ? await loadStatementAccounts(sub.id, year) : [] }
    })
    if (!read.ok) {
      unreachable.push(read.unreachable)
      continue
    }
    const { year, accounts: subAccounts } = read.value
    const ownershipBp = sub.stake?.percentBp ?? 0
    const book = titres.get(sub.id) ?? { gross: 0, depreciation: 0 }
    const capitauxPropres = year ? computeBalanceIndicators(subAccounts).capitauxPropresCents : null
    const sig = year ? computeSig(subAccounts) : null
    const fromHolding = observations.filter((o) => o.counterpartyId === sub.id)
    rows.push({
      subsidiaryId: sub.id,
      name: sub.name,
      siren: sub.siren,
      kind: participationKindOf(ownershipBp),
      ownershipBp,
      numberOfShares: sub.stake?.numberOfShares ?? null,
      bookValueGrossCents: book.gross,
      depreciationCents: book.depreciation,
      bookValueNetCents: book.gross - book.depreciation,
      fiscalYear: year ? periodRef(year) : null,
      samePeriod: year ? samePeriod(year, fy.startDate, fy.endDate) : false,
      capitalCents: year ? -sumPrefixes(subAccounts, CAPITAL_PREFIXES) : null,
      capitauxPropresCents: capitauxPropres,
      quotePartCents: capitauxPropres === null ? null : shareOfCents(capitauxPropres, ownershipBp),
      chiffreAffairesCents: sig?.chiffreAffairesCents ?? null,
      resultatCents: sig?.resultatExerciceCents ?? null,
      loansCents: fromHolding
        .filter((o) => o.category !== 'dividend' && o.category !== 'trade' && !o.accountCode.startsWith('16') && o.cents > 0)
        .reduce((sum, o) => sum + o.cents, 0),
      dividendsCents: fromHolding.filter((o) => o.category === 'dividend').reduce((sum, o) => sum + o.cents, 0),
    })
  }

  const totals = rows.reduce(
    (t, r) => ({
      bookValueGrossCents: t.bookValueGrossCents + r.bookValueGrossCents,
      depreciationCents: t.depreciationCents + r.depreciationCents,
      bookValueNetCents: t.bookValueNetCents + r.bookValueNetCents,
      dividendsCents: t.dividendsCents + r.dividendsCents,
    }),
    { bookValueGrossCents: 0, depreciationCents: 0, bookValueNetCents: 0, dividendsCents: 0 },
  )
  return { holding: { id: perimeter.holding.id, name: perimeter.holding.name }, fiscalYear: periodRef(fy), rows, unreachable, unattributed, totals }

}
