/**
 * Form 2033-E-SD 2026, "Détermination des effectifs et de la valeur
 * ajoutée" (lib/liasse/value-added.ts). Sources: form n° 2033-E-SD 2026 and
 * notice 2033-NOT-SD (accounts of each line: 701 to 709, 751, 752 to 758
 * except 755, 74, 603 and 713, 601 to 609 except 603, 651 to 658 except 655;
 * the form is due above 152 500 € of chiffre d'affaires ramené à douze mois);
 * BOI-CVAE-BASE-20.
 */

import { describe, expect, it } from 'vitest'
import { cellByBox, centsOf } from '../cells'
import { buildValueAddedForm, VALUE_ADDED_CODES_2033E, type ValueAddedInput } from '../value-added'

const acc = (code: string, debitCents: number, creditCents: number) => ({ code, debitCents, creditCents })

const ACCOUNTS = [
  acc('706000', 0, 30_000_000),
  acc('709000', 500_000, 0),
  acc('751000', 0, 200_000),
  acc('758000', 0, 100_000),
  acc('755000', 0, 900_000),
  acc('740000', 0, 300_000),
  acc('603700', 400_000, 0),
  acc('713000', 0, 100_000),
  acc('607000', 6_000_000, 0),
  acc('603100', 0, 0),
  acc('613200', 1_200_000, 0),
  acc('622600', 800_000, 0),
  acc('626000', 100_000, 0),
  acc('635110', 150_000, 0),
  acc('651000', 50_000, 0),
  acc('655000', 70_000, 0),
  acc('641000', 9_000_000, 0),
]

const input = (overrides: Partial<ValueAddedInput> = {}): ValueAddedInput => ({
  form: { id: '2033-E', number: '2033-E-SD' },
  codes: VALUE_ADDED_CODES_2033E,
  fiscalYear: { startDate: '2026-01-01', endDate: '2026-12-31' },
  duration: { months: 12, days: 365 },
  accounts: ACCOUNTS,
  employees: { value: 3, from: 'approval' },
  ...overrides,
})

describe('form 2033-E-SD, valeur ajoutée', () => {
  const form = buildValueAddedForm(input())
  const v = (box: string) => centsOf(cellByBox(form, box))

  it('reads each line from the accounts the notice names', () => {
    expect(v('108')).toBe(29_500_000) // 706 less the rabais of 709
    expect(v('118')).toBe(200_000)
    expect(v('115')).toBe(100_000) // 758, not 755 (quotes-parts de résultat sur opérations faites en commun)
    expect(v('113')).toBe(300_000)
    expect(v('121')).toBe(6_000_000)
    expect(v('125')).toBe(900_000) // 622 and 626; the rent of 613 has its own line
    expect(v('148')).toBe(50_000) // 651, not 655
  })

  it('nets 603 and 713 into one variation of stocks', () => {
    expect(v('111')).toBe(0)
    expect(v('145')).toBe(300_000)
  })

  it('leaves what the accounts do not say to fill by hand, with a hint from the books', () => {
    expect(cellByBox(form, '119')).toMatchObject({ source: 'manual', value: null })
    expect(cellByBox(form, '310')).toMatchObject({ source: 'manual', hint: { kind: 'amount', cents: 1_200_000 } })
    expect(cellByBox(form, '133')).toMatchObject({ source: 'manual', hint: { kind: 'amount', cents: 150_000 } })
  })

  it('computes the totals and the value added, saying which boxes are still to add', () => {
    expect(v('106')).toBe(29_700_000)
    expect(cellByBox(form, '106')?.pending).toEqual(['119'])
    expect(v('144')).toBe(400_000)
    expect(v('152')).toBe(7_250_000) // 607, variation of stocks, 622 and 626, 651
    expect(v('137')).toBe(29_700_000 + 400_000 - 7_250_000)
    expect(cellByBox(form, '137')?.pending).toEqual(['119', '143', '153', '310', '133', '128', '135', '150'])
    expect(cellByBox(form, '022')).toMatchObject({ value: { kind: 'amount', cents: 29_700_000 } })
  })

  it('takes the headcount answered on the approval, and asks for it otherwise', () => {
    expect(cellByBox(form, '376')).toMatchObject({ source: 'answer', value: { kind: 'count', value: 3 } })
    expect(cellByBox(buildValueAddedForm(input({ employees: null })), '376')).toMatchObject({ source: 'manual' })
    expect(cellByBox(form, '657')).toMatchObject({ source: 'manual' })
  })

  it('is due above 152 500 € of chiffre d\'affaires ramené à douze mois', () => {
    expect(form.required.value).toBe(true)
    const small = buildValueAddedForm(input({ accounts: [acc('706000', 0, 7_000_000)], duration: { months: 6, days: 181 } }))
    // 70 000 € over six months is 140 000 € for twelve: not due
    expect(small.required).toMatchObject({ value: false })
    expect(small.required.reason).toContain('140')
    expect(cellByBox(small, '022')).toMatchObject({ value: { kind: 'amount', cents: 14_000_000 } })
  })
})
