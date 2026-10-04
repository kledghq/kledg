import { describe, expect, it } from 'vitest'

import { isPlural, plural, pluralWord } from '../plural'

describe('French plurals', () => {
  it('uses the singular for 0 and 1 and the plural from 2', () => {
    expect(plural(0, 'problème')).toBe('0 problème')
    expect(plural(1, 'problème')).toBe('1 problème')
    expect(plural(2, 'problème')).toBe('2 problèmes')
    expect(plural(558, 'erreur')).toBe('558 erreurs')
    expect(isPlural(-3)).toBe(true)
    expect(isPlural(1)).toBe(false)
  })

  it('takes an irregular plural and agrees a single word', () => {
    expect(plural(2, 'nouveau compte', 'nouveaux comptes')).toBe('2 nouveaux comptes')
    expect(plural(1, 'nouveau compte', 'nouveaux comptes')).toBe('1 nouveau compte')
    expect(pluralWord(4, 'créée')).toBe('créées')
    expect(pluralWord(1, 'créée')).toBe('créée')
  })
})
