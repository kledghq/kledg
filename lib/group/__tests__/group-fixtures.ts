/**
 * A group as the reports of the group space describe it, for the tests of
 * the pure builders and of the views: Lumen Holding (h), Atelier Lumen (a,
 * 80 %) and Studio Lumen (s, 100 %), with management fees, a dividend, a
 * current account advance and an unpaid invoice between them, bank
 * balances, deadlines and alerts. Amounts in cents.
 */

import { ZERO_FIGURES, type KeyFigures } from '../combine'
import type { GroupAlerts } from '../get-group-alerts.service'
import type { GroupDeadline, GroupDeadlinesReport } from '../get-group-deadlines.service'
import type { GroupTreasuryReport } from '../get-group-treasury.service'
import type { GroupView } from '../get-group-view.service'
import type { GroupCompanyLink } from '../members'

export const FY = { id: 'fy-h', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' }

export const LINKS: GroupCompanyLink[] = [
  { id: 'h', name: 'Lumen Holding', slug: 'lumen-holding', role: 'holding', ownershipBp: null },
  { id: 'a', name: 'Atelier Lumen', slug: 'atelier-lumen', role: 'subsidiary', ownershipBp: 8000 },
  { id: 's', name: 'Studio Lumen', slug: 'studio-lumen', role: 'subsidiary', ownershipBp: 10000 },
]

const figures = (f: Partial<KeyFigures>): KeyFigures => ({ ...ZERO_FIGURES, ...f })

export const FIGURES: Record<string, KeyFigures> = {
  h: figures({ chiffreAffairesCents: 1_800_000, resultatCents: 2_300_000, tresorerieCents: 4_000_000 }),
  a: figures({ chiffreAffairesCents: 40_000_000, resultatCents: 6_000_000, tresorerieCents: 9_000_000 }),
  s: figures({ chiffreAffairesCents: 10_000_000, resultatCents: -1_000_000, tresorerieCents: 500_000 }),
}

export function groupView(): GroupView {
  const combined = {
    ...ZERO_FIGURES,
    chiffreAffairesCents: 51_800_000,
    resultatCents: 7_300_000,
    tresorerieCents: 13_500_000,
  }
  const effect = { ...ZERO_FIGURES, chiffreAffairesCents: -1_800_000, resultatCents: -1_000_000 }
  return {
    holding: { id: 'h', name: 'Lumen Holding' },
    fiscalYear: FY,
    members: LINKS.map((l) => ({ id: l.id, name: l.name, slug: l.slug, siren: null, role: l.role, ownershipBp: l.ownershipBp, fiscalYear: FY, samePeriod: true, figures: FIGURES[l.id] })),
    unreachable: [{ name: null, reason: 'out_of_reach' }],
    truncated: 0,
    combined,
    eliminations: {
      operations: [{ sellerId: 'h', buyerId: 'a', categories: ['management_fee'], revenueCents: 1_800_000, chargeCents: 1_800_000, gapCents: 0 }],
      dividends: [{ receiverId: 'h', payerId: 'a', cents: 1_000_000 }],
      balances: [
        { creditorId: 'h', debtorId: 's', categories: ['current_account'], receivableCents: 2_500_000, payableCents: 2_500_000, eliminatedCents: 2_500_000, gapCents: 0 },
        { creditorId: 'a', debtorId: 's', categories: ['trade'], receivableCents: 120_000, payableCents: 100_000, eliminatedCents: 100_000, gapCents: 20_000 },
      ],
      effect,
    },
    afterEliminations: { ...combined, chiffreAffairesCents: 50_000_000, resultatCents: 6_300_000 },
    flows: [],
    treasury: [
      { month: '2026-07', totalCents: 12_000_000, byCompany: {} },
      { month: '2026-08', totalCents: 12_600_000, byCompany: {} },
      { month: '2026-09', totalCents: 12_900_000, byCompany: {} },
      { month: '2026-10', totalCents: 13_500_000, byCompany: {} },
    ],
    titresParticipationCents: 0,
    warnings: ['Une filiale n’est pas lue, faute d’accès : ses chiffres et ses flux avec le groupe ne sont pas dans la vue combinée.'],
  }
}

export function groupTreasury(): GroupTreasuryReport {
  const bank = { h: 3_950_000, a: 9_120_000, s: 480_000 } as Record<string, number>
  return {
    holding: { id: 'h', name: 'Lumen Holding' },
    fiscalYear: FY,
    companies: LINKS.map((l) => ({ company: l, accounts: [], bankEurCents: bank[l.id], ledgerCents: FIGURES[l.id].tresorerieCents })),
    totalsByCurrency: [{ currency: 'EUR', balanceCents: 13_550_000 }],
    ledgerTotalCents: 13_500_000,
    months: groupView().treasury,
    currentAccounts: [],
    currentAccountLines: [],
    unreachable: [{ name: null, reason: 'out_of_reach' }],
    truncated: 0,
    warnings: [],
  }
}

const deadline = (companyId: string, id: string, date: string, status: GroupDeadline['status'], amountCents: number | null = null, settled = false): GroupDeadline => ({
  companyId,
  id,
  label: `Échéance ${id}`,
  form: '3310-CA3-SD',
  category: 'tva',
  column: 'tva',
  date,
  lateAfter: date,
  estimated: false,
  status,
  statusLabel: status,
  settled,
  amountCents,
})

export function groupDeadlines(): GroupDeadlinesReport {
  return {
    holding: { id: 'h', name: 'Lumen Holding' },
    fiscalYear: FY,
    today: '2026-10-05',
    companies: [],
    deadlines: [
      deadline('a', 'tva-ca3:2026-09', '2026-09-24', 'overdue', 450_000),
      deadline('h', 'cfe:2026', '2026-12-15', 'todo', 175_000),
      deadline('s', 'tva-ca3:2026-10', '2026-10-24', 'todo', 120_000),
      deadline('s', 'is-solde:2025', '2026-05-15', 'paid', 300_000, true),
    ],
    totals: { overdue: 1, pending: 2, settled: 1 },
    unreachable: [],
    truncated: 0,
    warnings: [],
  }
}

export function groupAlerts(): GroupAlerts {
  return {
    companies: [
      { company: LINKS[0], overdue: 0, unreconciled: 0, drafts: 1 },
      { company: LINKS[1], overdue: 1, unreconciled: 4, drafts: 0 },
      { company: LINKS[2], overdue: 0, unreconciled: 1, drafts: 2 },
    ],
    overdue: [],
    totals: { overdue: 1, unreconciled: 5, drafts: 3 },
    unreachable: [],
    truncated: 0,
    warnings: [],
  }
}
