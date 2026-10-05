/**
 * The default statement layouts against the official models, millésime 2026:
 * forms 2050-SD to 2053-SD (régime réel normal) and 2033-A-SD, 2033-B-SD
 * (régime simplifié), as published on impots.gouv.fr with their notices
 * 2032-NOT-SD and 2033-NOT-SD 2026, after règlement ANC n° 2022-06 (PCG art.
 * 821-1 balance sheet model, 821-3 income statement model).
 *
 * 1. Every account of Kledg's seeded chart lands in one box of each model,
 *    with the side rules of the models (soldes débiteurs à l'actif,
 *    créditeurs au passif: 512 in credit is a bank overdraft in DU, 401 in
 *    debit an "autres créances"...), depreciation in the Amortissements
 *    column of its asset: the table of fixtures/pcg-account-boxes.ts, which
 *    lists every account (none unmapped, none on two lines).
 * 2. Every box used exists on the 2026 form.
 * 3. A worked example, checked box by box: totals balance, the result box
 *    (DI, 136) is the result of the income statement (HN, 310), and the N-1
 *    year read with the same layout gives its own figures.
 */

import { describe, expect, it } from 'vitest'
import { PCG_ACCOUNTS } from '@/lib/accounting/pcg-data'
import type { BalanceSheetLine } from '../../balance-sheet/types'
import type { IncomeStatementLine } from '../../income-statement/types'
import type { AccountTotals } from '../allocation'
import { buildBalanceSheet } from '../balance-sheet'
import { buildIncomeStatement } from '../income-statement'
import { defaultBalanceSheetRules, defaultIncomeStatementRules } from '../default-rules'
import {
  FORM_2033A_AMORT,
  FORM_2033A_BRUT,
  FORM_2033A_PASSIF,
  FORM_2033B,
  FORM_2050_AMORT,
  FORM_2050_BRUT,
  FORM_2051,
  FORM_2052_2053,
  SIMPLIFIED_LINES_WITHOUT_2033B_BOX,
} from '../official-boxes'
import { boxesOf } from './statement-boxes'
import { PCG_ACCOUNT_BOXES } from './fixtures/pcg-account-boxes'

/** Accounts that can carry a balance on the statements: classes 1 to 7, class headers excluded. */
const CHART = [...new Set(PCG_ACCOUNTS.map((a) => a.code).filter((code) => code.length >= 2 && /^[1-7]/.test(code)))]

describe('every account of the seeded chart on the official models', () => {
  it('lists every account of the chart, and only those', () => {
    expect(Object.keys(PCG_ACCOUNT_BOXES).sort()).toEqual([...CHART].sort())
  })

  it('puts every account in the box of the reviewed table, in each model and on each side', () => {
    const differences = CHART.filter((code) => JSON.stringify(boxesOf(code)) !== JSON.stringify(PCG_ACCOUNT_BOXES[code])).map(
      (code) => `${code}: ${JSON.stringify(boxesOf(code))} instead of ${JSON.stringify(PCG_ACCOUNT_BOXES[code])}`,
    )
    expect(differences).toEqual([])
  })

  it('uses only boxes printed on the 2026 forms', () => {
    const box = (value: string) => value.replace(' (-)', '')
    const complete = new Set<string>([...FORM_2050_BRUT, ...FORM_2050_AMORT, ...FORM_2051])
    const simplified = new Set<string>([...FORM_2033A_BRUT, ...FORM_2033A_AMORT, ...FORM_2033A_PASSIF])
    const income = new Set<string>(FORM_2052_2053)
    const incomeSimplified = new Set<string>([...FORM_2033B, ...SIMPLIFIED_LINES_WITHOUT_2033B_BOX])
    const problems: string[] = []
    for (const [code, boxes] of Object.entries(PCG_ACCOUNT_BOXES)) {
      if (/^[1-5]/.test(code)) {
        boxes.slice(0, 2).forEach((b) => complete.has(box(b)) || problems.push(`${code} 2050/2051: ${b}`))
        boxes.slice(2).forEach((b) => simplified.has(box(b)) || problems.push(`${code} 2033-A: ${b}`))
      } else {
        if (!income.has(boxes[0])) problems.push(`${code} 2052/2053: ${boxes[0]}`)
        if (!incomeSimplified.has(boxes[1])) problems.push(`${code} 2033-B: ${boxes[1]}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('applies the side rules and columns of the models', () => {
    // [2050/2051 D, 2050/2051 C, 2033-A D, 2033-A C]
    expect(PCG_ACCOUNT_BOXES['512']).toEqual(['CF', 'DU', '084', '156']) // overdraft: concours bancaires (2051 renvoi EH)
    expect(PCG_ACCOUNT_BOXES['401']).toEqual(['BZ', 'DX', '072', '166'])
    expect(PCG_ACCOUNT_BOXES['411']).toEqual(['BX', 'EA', '068', '175'])
    expect(PCG_ACCOUNT_BOXES['4091']).toEqual(['BV', 'DX', '064', '166'])
    expect(PCG_ACCOUNT_BOXES['4191']).toEqual(['BX', 'DW', '068', '164'])
    expect(PCG_ACCOUNT_BOXES['455']).toEqual(['BZ', 'DV', '072', '173']) // 2033-A line 173 comptes courants d'associés
    expect(PCG_ACCOUNT_BOXES['44567']).toEqual(['BZ', 'DY', '072', '172'])
    expect(PCG_ACCOUNT_BOXES['44571']).toEqual(['BZ', 'DY', '072', '172'])
    expect(PCG_ACCOUNT_BOXES['444']).toEqual(['BZ', 'DY', '072', '172'])
    expect(PCG_ACCOUNT_BOXES['206']).toEqual(['AH', 'AH (-)', '010', '010 (-)']) // droit au bail with the fonds commercial
    expect(PCG_ACCOUNT_BOXES['2961']).toEqual(['CT (-)', 'CT', '042 (-)', '042'])
    expect(PCG_ACCOUNT_BOXES['2974']).toEqual(['BG (-)', 'BG', '042 (-)', '042']) // dépréciation des prêts
    expect(PCG_ACCOUNT_BOXES['2975']).toEqual(['BI (-)', 'BI', '042 (-)', '042'])
    expect(PCG_ACCOUNT_BOXES['16711']).toEqual(['DM (-)', 'DM', '156 (-)', '156'])
    expect(PCG_ACCOUNT_BOXES['107']).toEqual(['EK (-)', 'EK', '124 (-)', '124']) // dont écart d'équivalence, inside DC
    expect(PCG_ACCOUNT_BOXES['1521']).toEqual(['DQ (-)', 'DQ', '154 (-)', '154'])
    // [2052/2053, 2033-B]
    expect(PCG_ACCOUNT_BOXES['657']).toEqual(['G1', '262'])
    expect(PCG_ACCOUNT_BOXES['757']).toEqual(['F1', '230'])
    expect(PCG_ACCOUNT_BOXES['747']).toEqual(['FO', '226'])
    expect(PCG_ACCOUNT_BOXES['705']).toEqual(['FG', '218']) // études: services (notice FI and 218)
    expect(PCG_ACCOUNT_BOXES['68725']).toEqual(['HH', '300']) // dérogatoire: exceptional (notice 2033-B, 254)
    expect(PCG_ACCOUNT_BOXES['6817']).toEqual(['GC', '256'])
    expect(Object.keys(PCG_ACCOUNT_BOXES).some((code) => code.startsWith('79'))).toBe(false)
  })
})

// ── Worked example ───────────────────────────────────────────────────────────

const euros = (value: number) => Math.round(value * 100)
/** Balances in euros: positive debit, negative credit. */
const LEDGER: Record<string, number> = {
  '101000': -10_000, '104100': -2_000, '106100': -1_000, '110000': -500, '164000': -20_000, '455000': -3_000,
  '206000': 5_000, '207000': 8_000, '218300': 6_000, '281830': -2_000, '261000': 4_000, '296100': -1_000,
  '274300': 500, '275100': 700, '297500': -100, '370000': 3_000, '397000': -300, '411000': 12_000, '491000': -1_200,
  '401000': -7_000, '409100': 600, '419100': -900, '421000': -2_500, '431000': -1_500, '445660': 800, '445710': -2_400,
  '512000': 30_400, '512100': -1_200, '486000': 400, '487000': -300,
  '707000': -50_000, '706000': -20_000, '705000': -3_000, '709700': 1_000, '607000': 25_000, '603700': 1_500,
  '626000': 1_000, '613200': 6_000, '641100': 15_000, '645100': 6_000, '681120': 2_000, '681730': 300, '681740': 1_200,
  '657000': 3_000, '757000': -5_000, '747000': -400, '661600': 900, '761100': -600, '678000': 200, '778000': -100,
  '695000': 1_500,
}
const ACCOUNTS: AccountTotals[] = Object.entries(LEDGER).map(([code, balance]) => ({
  code,
  debitCents: balance > 0 ? euros(balance) : 0,
  creditCents: balance < 0 ? euros(-balance) : 0,
}))
const RESULT = 14_500

type Variant = 'complete' | 'simplified'
function statements(variant: Variant, accounts = ACCOUNTS) {
  const bs = buildBalanceSheet({ companyId: 'c', fiscalYearId: 'fy', reportVariant: variant, rules: defaultBalanceSheetRules(variant), accounts })
  const is = buildIncomeStatement({ companyId: 'c', fiscalYearId: 'fy', reportVariant: variant, rules: defaultIncomeStatementRules(variant), accounts })
  const bsLines = [...bs.actif.lines, ...bs.passif.lines].flatMap(function all(l: BalanceSheetLine): BalanceSheetLine[] {
    return [l, ...(l.children ?? []).flatMap(all)]
  })
  const isLines = [...is.produits.lines, ...is.charges.lines].flatMap(function all(l: IncomeStatementLine): IncomeStatementLine[] {
    return [l, ...(l.children ?? []).flatMap(all)]
  })
  const line = (code: string) => {
    const found = bsLines.filter((l) => l.formCode === code)
    expect(found, code).toHaveLength(1)
    return found[0]
  }
  return {
    bs,
    is,
    /** Brut (or net when the line has no columns) and amortissements of a balance sheet box. */
    brut: (code: string) => line(code).brut ?? line(code).net,
    amort: (code: string) => line(code).amortissements ?? 0,
    net: (code: string) => line(code).net,
    /** Value of an income statement box (the line or its intermediate result). */
    value: (code: string) => {
      const found = isLines.filter((l) => l.formCode === code)
      expect(found.length, code).toBeGreaterThan(0)
      return found[0].value
    },
  }
}

describe('worked example on 2050 to 2053 (régime réel normal)', () => {
  const { bs, is, brut, amort, net, value } = statements('complete')

  it('fills the actif box by box, brut, amortissements and net', () => {
    expect([brut('AH'), amort('AH')]).toEqual([13_000, 0]) // 206 + 207
    expect([brut('AT'), amort('AT'), net('AT')]).toEqual([6_000, 2_000, 4_000])
    expect([brut('CS'), amort('CS')]).toEqual([4_000, 1_000]) // 261, 2961
    expect([brut('BF'), amort('BF')]).toEqual([500, 0])
    expect([brut('BH'), amort('BH')]).toEqual([700, 100]) // 275, 2975
    expect([brut('BT'), amort('BT')]).toEqual([3_000, 300])
    expect(net('BV')).toBe(600) // 4091
    expect([brut('BX'), amort('BX')]).toEqual([12_000, 1_200])
    expect(net('BZ')).toBe(800) // 44566
    expect(net('CF')).toBe(30_400) // 512000 only: 512100 is in credit
    expect(net('CH')).toBe(400)
    expect(bs.actifTotal).toBe(66_800)
    expect(bs.actif.brutTotal).toBe(66_800 + 4_600)
    expect(bs.actif.amortissementsTotal).toBe(4_600)
  })

  it('fills the passif box by box; the result box is the result of the income statement', () => {
    expect([net('DA'), net('DB'), net('DD'), net('DH'), net('DI')]).toEqual([10_000, 2_000, 1_000, 500, RESULT])
    expect(net('DL')).toBe(28_000)
    expect(net('DU')).toBe(21_200) // 164 + overdraft of 512100
    expect(net('DV')).toBe(3_000) // 455
    expect([net('DW'), net('DX'), net('DY'), net('EB')]).toEqual([900, 7_000, 6_400, 300])
    expect(bs.passifTotal).toBe(66_800)
    expect(bs.imbalance).toBeUndefined()
    expect(bs.netResult).toBe(RESULT)
  })

  it('fills the 2052 and 2053 box by box', () => {
    expect([value('FA'), value('FD'), value('FG')]).toEqual([49_000, 0, 23_000]) // 707 - 7097; 705 + 706
    expect([value('FO'), value('F1'), value('FR')]).toEqual([400, 5_000, 77_400])
    expect([value('FS'), value('FT'), value('FW'), value('FY'), value('FZ')]).toEqual([25_000, 1_500, 7_000, 15_000, 6_000])
    expect([value('GA'), value('GC'), value('G1'), value('GF'), value('GG')]).toEqual([2_000, 1_500, 3_000, 61_000, 16_400])
    expect([value('GJ'), value('GP'), value('GR'), value('GU'), value('GV'), value('GW')]).toEqual([600, 600, 900, 900, -300, 16_100])
    expect([value('HD'), value('HH'), value('HI'), value('HK'), value('HN')]).toEqual([100, 200, -100, 1_500, RESULT])
    expect(is.netResult).toBe(RESULT)
  })
})

describe('worked example on 2033-A and 2033-B (régime simplifié)', () => {
  const { bs, is, brut, amort, net, value } = statements('simplified')

  it('fills the 2033-A box by box', () => {
    expect([brut('010'), brut('028'), amort('028')]).toEqual([13_000, 6_000, 2_000])
    expect([brut('040'), amort('040')]).toEqual([5_200, 1_100]) // 261 + 274 + 275; 2961 + 2975
    expect([brut('060'), amort('060'), net('064')]).toEqual([3_000, 300, 600])
    expect([brut('068'), amort('068'), net('072'), net('084'), net('092')]).toEqual([12_000, 1_200, 800, 30_400, 400])
    expect(net('120')).toBe(12_000) // capital and prime d'émission: no line for primes on the 2033-A
    expect([net('126'), net('134'), net('136'), net('142')]).toEqual([1_000, 500, RESULT, 28_000])
    expect([net('156'), net('164'), net('166'), net('172'), net('173'), net('174'), net('176')]).toEqual([21_200, 900, 7_000, 6_400, 3_000, 300, 38_800])
    expect([bs.actifTotal, bs.passifTotal]).toEqual([66_800, 66_800])
  })

  it('fills the 2033-B box by box', () => {
    expect([value('210'), value('214'), value('218'), value('226'), value('230'), value('232')]).toEqual([49_000, 0, 23_000, 400, 5_000, 77_400])
    expect([value('234'), value('236'), value('242'), value('250'), value('252')]).toEqual([25_000, 1_500, 7_000, 15_000, 6_000])
    expect([value('254'), value('256'), value('262'), value('264'), value('270')]).toEqual([2_000, 1_500, 3_000, 61_000, 16_400])
    expect([value('280'), value('294'), value('290'), value('300'), value('306'), value('310')]).toEqual([600, 900, 100, 200, 1_500, RESULT])
    expect(is.netResult).toBe(RESULT)
  })
})

describe('N-1 with the same layout', () => {
  it('gives each year its own figures and keeps both balanced', () => {
    // Year N-1: the capital paid in, a sale, and the result left in 12 before its allocation.
    const previous: AccountTotals[] = [
      { code: '101000', debitCents: 0, creditCents: euros(10_000) },
      { code: '512000', debitCents: euros(10_800), creditCents: 0 },
      { code: '706000', debitCents: 0, creditCents: euros(800) },
    ]
    for (const variant of ['complete', 'simplified'] as const) {
      const n1 = statements(variant, previous)
      const n = statements(variant)
      const resultBox = variant === 'complete' ? 'DI' : '136'
      expect([n1.net(resultBox), n.net(resultBox)]).toEqual([800, RESULT])
      expect([n1.bs.actifTotal, n1.bs.passifTotal]).toEqual([10_800, 10_800])
    }
  })

  it('shows a result not yet allocated (account 12) with the year result in the result box', () => {
    const withPrevious: AccountTotals[] = [...ACCOUNTS, { code: '120000', debitCents: 0, creditCents: euros(800) }, { code: '512000', debitCents: euros(800), creditCents: 0 }]
    expect(statements('complete', withPrevious).net('DI')).toBe(RESULT + 800)
    expect(statements('simplified', withPrevious).net('136')).toBe(RESULT + 800)
  })
})
