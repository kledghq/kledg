/**
 * Pure helpers of the FEC import dialog: column detection from the file
 * header (the 18 columns of the FEC, LPF art. A47 A-1, and their usual French
 * spellings), account code simplification and parent in the PCG chart
 * (PCG art. 932-1), and the matching of the file's accounts with the
 * company's accounts.
 */

import { describe, expect, it } from 'vitest'
import { detectColumnMapping, normalizeText, textSimilarity } from '../column-detector'
import { enhanceAccountMapping, getParentAccountCode, simplifyAccountCode } from '../account-mapping-utils'
import { analyzeFECAccounts, createAccountMaps, findMatchingAccount, type ExistingAccount } from '../account-analyzer'

const FEC_HEADER = [
  'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef',
  'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise',
]

describe('column detection', () => {
  it('maps the 18 standard FEC columns to themselves (LPF art. A47 A-1)', () => {
    const mapping = detectColumnMapping(FEC_HEADER)
    expect(mapping).toEqual(Object.fromEntries(FEC_HEADER.map((h) => [h, h])))
  })

  it('recognises French headers whatever their case and spacing', () => {
    expect(detectColumnMapping(['Code journal', ' Libellé journal ', 'N° écriture', 'Date', 'Compte', 'Libellé compte', 'Débit', 'Crédit', 'Lettrage'])).toEqual({
      JournalCode: 'Code journal',
      JournalLib: ' Libellé journal ',
      EcritureNum: 'N° écriture',
      EcritureDate: 'Date',
      CompteNum: 'Compte',
      CompteLib: 'Libellé compte',
      Debit: 'Débit',
      Credit: 'Crédit',
      EcritureLet: 'Lettrage',
    })
  })

  it('leaves unknown columns unmapped', () => {
    expect(detectColumnMapping(['Foo', 'Bar'])).toEqual({})
  })

  it('normalises texts and scores their similarity', () => {
    expect(normalizeText('  Libellé   Écriture ')).toBe('libelle ecriture')
    expect(textSimilarity('Banque', 'BANQUE')).toBe(1)
    expect(textSimilarity('Banque', 'Banque principale')).toBe(0.8)
    expect(textSimilarity('Frais bancaires divers', 'Frais postaux divers')).toBeCloseTo(2 / 3)
    expect(textSimilarity('Clients', 'Fournisseurs')).toBe(0)
  })
})

describe('account codes', () => {
  it('drops trailing zeros, keeping a code made of zeros', () => {
    expect(simplifyAccountCode('65110000')).toBe('6511')
    expect(simplifyAccountCode('41100000')).toBe('411')
    expect(simplifyAccountCode('512001')).toBe('512001')
    expect(simplifyAccountCode('000')).toBe('000')
    expect(simplifyAccountCode('')).toBe('')
  })

  it('finds the parent in the PCG chart, else the nearest PCG prefix, else the two digit class', () => {
    expect(getParentAccountCode('41100000')).toBe('41')
    expect(getParentAccountCode('4111')).toBe('411')
    expect(getParentAccountCode('512001')).toBe('512')
    expect(getParentAccountCode('99999')).toBe('99')
    expect(getParentAccountCode('41')).toBeNull()
    expect(getParentAccountCode('')).toBeNull()
  })

  it('adds the simplified code of every mapped account as an alternative key', () => {
    expect(enhanceAccountMapping({ '65110000': 'acc-6511', '41100000': null, '512001': 'acc-bank', '6511': 'acc-other' })).toEqual({
      '65110000': 'acc-6511',
      '41100000': null,
      '512001': 'acc-bank',
      // Already present: kept
      '6511': 'acc-other',
    })
    expect(enhanceAccountMapping({ '40100000': 'acc-401' })).toEqual({ '40100000': 'acc-401', '401': 'acc-401' })
  })
})

describe('matching the file accounts with the company accounts', () => {
  const existing: ExistingAccount[] = [
    { id: 'a-411', code: '411000', label: 'Clients' },
    { id: 'a-512a', code: '512100', label: 'Banque Populaire' },
    { id: 'a-512b', code: '5121', label: 'Crédit Agricole' },
    { id: 'a-6061', code: '606100', label: 'Fournitures non stockables' },
    { id: 'a-6061b', code: '6061', label: 'Eau et énergie' },
  ]
  const { codeToAccountMap, simplifiedCodeToAccountsMap } = createAccountMaps(existing)
  const match = (code: string, label = '') => findMatchingAccount(code, label, codeToAccountMap, simplifiedCodeToAccountsMap, existing)?.id ?? null

  it('indexes accounts by exact and simplified code', () => {
    expect(codeToAccountMap.get('411000')?.id).toBe('a-411')
    expect(simplifiedCodeToAccountsMap.get('6061')?.map((a) => a.id)).toEqual(['a-6061', 'a-6061b'])
  })

  it('prefers the exact code, then the same code without trailing zeros', () => {
    expect(match('411000')).toBe('a-411')
    expect(match('41100000')).toBe('a-411')
    expect(match('411')).toBe('a-411')
  })

  it('breaks a tie between accounts with the same simplified code on the label', () => {
    expect(match('60610000', 'Eau et énergie')).toBe('a-6061b')
    // No label close enough: the first account
    expect(match('60610000', 'Divers')).toBe('a-6061')
  })

  it('never maps a different code by label: 512001 "Banque" stays a new account', () => {
    expect(match('512001', 'Banque Populaire')).toBeNull()
  })

  it('previews every file account, sorted, with its PCG parent and the matched account', () => {
    const preview = analyzeFECAccounts(
      new Map([
        ['512001', { label: 'Banque' }],
        ['41100000', { label: 'Clients' }],
        ['99999', { label: '' }],
      ]),
      existing,
    )
    expect(preview).toEqual([
      { code: '41100000', label: 'Clients', parentCode: '41', parentLabel: 'Clients et comptes rattachés', exists: true, mappedToAccountId: 'a-411' },
      { code: '512001', label: 'Banque', parentCode: '512', parentLabel: 'Banques', exists: false, mappedToAccountId: null },
      { code: '99999', label: '99999', parentCode: '99', parentLabel: '99', exists: false, mappedToAccountId: null },
    ])
  })
})
