import { describe, expect, it } from 'vitest'

import { groupRefusals } from '../refusal-report'

const reason = "Compte 401000 absent du plan de comptes de l'exercice"

describe('groupRefusals', () => {
  it('groups identical reasons with their count and first line numbers', () => {
    const refused = Array.from({ length: 558 }, (_, i) => ({ entry: `AC n° ${i + 1}`, line: 2 + i * 3, reason }))
    expect(groupRefusals(refused)).toEqual([`${reason} : 558 écritures (lignes 2, 5, 8, 11, 14 et 553 autres)`])
  })

  it('keeps a reason met once with its entry, and orders reasons by first line', () => {
    const refused = [
      { entry: 'OD n° 9', line: 90, reason },
      { entry: 'VT n° 3', line: 12, reason: "L'écriture n'est pas équilibrée" },
      { entry: 'AC n° 1', line: 40, reason },
    ]
    expect(groupRefusals(refused)).toEqual([
      "Écriture VT n° 3 (ligne 12) : L'écriture n'est pas équilibrée",
      `${reason} : 2 écritures (lignes 40, 90)`,
    ])
  })
})
