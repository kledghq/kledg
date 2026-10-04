/**
 * The accounts the year-end entries post to (lib/provisions/rules.ts,
 * lib/investment-grants/schedule.ts) land on the right lines of the default
 * balance sheet and income statement, in both layouts: allowances (29, 39,
 * 49, 59) in the depreciation column of their asset, provisions (151, 152)
 * and grants (131, 139) on the passif, dotations (681, 686, 687) and
 * reprises (781, 786, 787) on the operating, financial and exceptional
 * lines, the grant transfer (747) in operating income.
 *
 * Sources: PCG art. 821-1 and 821-3 (models of the balance sheet and of the
 * income statement); notices of forms 2050 to 2053 (lines DJ, DP, DQ, FO,
 * FP, GA to GD, GM, GQ, HD, HH) and 2033-A, 2033-B (lines 137, 230, 254,
 * 256).
 */

import { describe, expect, it } from 'vitest'
import { allocateAccounts } from '../allocation'
import { defaultBalanceSheetRules, defaultIncomeStatementRules } from '../default-rules'
import { ALLOWANCE_ACCOUNTS, allowedNatures, movementAccounts, PROVISION_CATEGORIES } from '@/lib/provisions/rules'
import { GRANT_ACCOUNTS } from '@/lib/investment-grants/schedule'

const totals = (code: string, debitCents: number, creditCents: number) => [{ accountId: `id-${code}`, code, label: code, debitCents, creditCents }]

function balanceSheetPlace(variant: 'complete' | 'simplified', code: string, side: 'debit' | 'credit') {
  const rules = defaultBalanceSheetRules(variant)
  const result = allocateAccounts(rules, totals(code, side === 'debit' ? 100 : 0, side === 'credit' ? 100 : 0), 'balance-sheet')
  expect(result.allocations, code).toHaveLength(1)
  const allocation = result.allocations[0]
  const rule = rules.find((r) => r.id === allocation.lineId)!
  return { formCode: rule.formCode, label: rule.lineLabel, slot: allocation.slot, lineId: allocation.lineId }
}

function incomeLine(variant: 'complete' | 'simplified', code: string) {
  const rules = defaultIncomeStatementRules(variant)
  const result = allocateAccounts(rules, totals(code, 100, 0), 'income-statement')
  expect(result.allocations, code).toHaveLength(1)
  return rules.find((r) => r.id === result.allocations[0].lineId)!
}

/** Every dotation and reprise account a year-end entry may use. */
const MOVEMENT_ACCOUNTS = PROVISION_CATEGORIES.flatMap((category) =>
  ALLOWANCE_ACCOUNTS[category].flatMap((account) =>
    allowedNatures(category, account.code).map((nature) => ({ nature, ...movementAccounts(category, account.code, nature) })),
  ),
)

describe.each(['complete', 'simplified'] as const)('year-end accounts in the statements (%s)', (variant) => {
  it('puts every impairment in the depreciation column of its asset line', () => {
    for (const [allowance, asset] of [
      ['2907', '207'],
      ['2915', '2154'],
      ['2961', '261'],
      ['397', '37'],
      ['491', '411'],
      ['5903', '503'],
    ]) {
      const place = balanceSheetPlace(variant, allowance, 'credit')
      expect(place.slot, allowance).toBe('amortissement')
      expect(place.lineId, allowance).toBe(balanceSheetPlace(variant, asset, 'debit').lineId)
    }
    for (const category of ['FIXED_ASSET', 'INVENTORY', 'RECEIVABLE', 'SECURITY'] as const) {
      for (const account of ALLOWANCE_ACCOUNTS[category]) expect(balanceSheetPlace(variant, account.code, 'credit').slot, account.code).toBe('amortissement')
    }
  })

  it('puts provisions for risks and for charges on their passif lines', () => {
    for (const account of ALLOWANCE_ACCOUNTS.RISK_CHARGE) {
      const place = balanceSheetPlace(variant, account.code, 'credit')
      expect(place.label, account.code).toBe(account.code.startsWith('151') ? 'Provisions pour risques' : 'Provisions pour charges')
    }
  })

  it("nets the grant (131) and its transfers (139) on the line Subventions d'investissement", () => {
    const grant = balanceSheetPlace(variant, GRANT_ACCOUNTS.grant.code, 'credit')
    const transfers = balanceSheetPlace(variant, GRANT_ACCOUNTS.transfer.code, 'debit')
    expect(grant.label).toBe("Subventions d'investissement")
    expect(transfers.lineId).toBe(grant.lineId)
    expect(grant.formCode).toBe(variant === 'complete' ? 'DJ' : '137')
  })

  it('books dotations and reprises on the operating, financial and exceptional lines', () => {
    for (const m of MOVEMENT_ACCOUNTS) {
      const dotation = incomeLine(variant, m.dotation.code)
      const reprise = incomeLine(variant, m.reprise.code)
      if (m.nature === 'OPERATING') {
        expect(dotation.lineLabel, m.dotation.code).toMatch(/[Dd]otations/)
        expect(reprise.lineLabel, m.reprise.code).toMatch(variant === 'complete' ? /^Reprises sur amortissements et provisions/ : /^Autres produits/)
      } else if (m.nature === 'FINANCIAL') {
        expect(dotation.lineLabel, m.dotation.code).toMatch(/^Dotations (financières )?aux amortissements/)
        expect(reprise.lineLabel, m.reprise.code).toMatch(/^Reprises sur dépréciations et provisions/)
      } else {
        expect(dotation.lineLabel, m.dotation.code).toMatch(/^Charges exceptionnelles/)
        expect(reprise.lineLabel, m.reprise.code).toMatch(/^Produits exceptionnels/)
      }
    }
    if (variant === 'complete') {
      expect(incomeLine(variant, '6815').formCode).toBe('GD')
      expect(incomeLine(variant, '68162').formCode).toBe('GB')
      expect(incomeLine(variant, '68174').formCode).toBe('GC')
      expect(incomeLine(variant, '6866').formCode).toBe('GQ')
      expect(incomeLine(variant, '7866').formCode).toBe('GM')
    } else {
      expect(incomeLine(variant, '6815').formCode).toBe('256')
      expect(incomeLine(variant, '68174').formCode).toBe('254')
    }
  })

  it('brings the transfer of a grant (747) into operating income', () => {
    expect(incomeLine(variant, GRANT_ACCOUNTS.income.code).formCode).toBe(variant === 'complete' ? 'FO' : '230')
  })
})
