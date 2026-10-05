import { describe, expect, it } from 'vitest'
import * as vocabulary from '../vocabulary'
import {
  chaseLabel,
  dateInWords,
  dayInWords,
  expensesToCheckLabel,
  greeting,
  jargonIn,
  lateLabel,
  missingReceiptsLabel,
  monthChangeLabel,
  overdueLabel,
  profitTitle,
  CORPORATE_TAX_TITLE,
  corporateTaxHint,
  situationSentence,
  vatTitle,
  vatReturnHint,
} from '../vocabulary'

describe('plain-language labels of the simple mode', () => {
  it('says the dates in words', () => {
    expect(dayInWords('2026-10-24')).toBe('24 octobre')
    expect(dayInWords('2026-08-01')).toBe('1er août')
    expect(dateInWords('2026-10-04')).toBe('4 octobre 2026')
    expect(situationSentence('Atelier Lumen', '2026-10-04')).toBe('Voici où en est Atelier Lumen au 4 octobre 2026.')
  })

  it('greets by the first name', () => {
    expect(greeting('Claire Martin')).toBe('Bonjour Claire')
    expect(greeting('  ')).toBe('Bonjour')
    expect(greeting(null)).toBe('Bonjour')
  })

  it('words the four figures as in the mockup', () => {
    expect(monthChangeLabel(321_000, '+3 210,00 €')).toBe('+3 210,00 € ce mois-ci')
    expect(monthChangeLabel(0, '0,00 €')).toBe('Aucun mouvement ce mois-ci')
    expect(overdueLabel(240_000, '2 400,00 €')).toBe('dont 2 400,00 € en retard')
    expect(overdueLabel(0, '0,00 €')).toBe('Rien en retard')
    expect(vatTitle(218_600, '2026-10-24')).toBe('TVA à payer le 24 octobre')
    expect(vatTitle(218_600, null)).toBe('TVA à payer')
    expect(vatTitle(-5_000, '2026-10-24')).toBe('TVA en votre faveur')
    // The amount of the prepared return (lib/vat-returns), when its checks pass
    expect(vatReturnHint('septembre 2026')).toBe("D'après votre déclaration de septembre 2026")
    expect(vatReturnHint('3e trimestre 2026')).toBe("D'après votre déclaration du 3e trimestre 2026")
    expect(vatReturnHint('année 2025')).toBe("D'après votre déclaration de l'année 2025")
    expect(vocabulary.jargonIn(vatReturnHint('année 2025'))).toEqual([])
    expect(profitTitle(1_534_710, '2026-01-01')).toBe('Bénéfice depuis janvier')
    expect(profitTitle(-100, '2026-07-01')).toBe('Perte depuis juillet')
    // The IS estimated by the worksheet (lib/corporate-tax), worded as an estimate
    expect(CORPORATE_TAX_TITLE).toBe('Impôt sur les sociétés estimé')
    expect(corporateTaxHint('2026-01-01')).toBe('Estimation sur le bénéfice depuis janvier, à confirmer à la clôture')
    expect(vocabulary.jargonIn(corporateTaxHint('2026-07-01'))).toEqual([])
  })

  it('counts the things to do with the right plural', () => {
    expect(expensesToCheckLabel(1)).toBe('1 dépense à vérifier')
    expect(expensesToCheckLabel(5)).toBe('5 dépenses à vérifier')
    expect(missingReceiptsLabel(1)).toBe('1 justificatif manquant')
    expect(missingReceiptsLabel(3)).toBe('3 justificatifs manquants')
    expect(chaseLabel('Studio Nord', '2 400,00 €')).toBe('Relancer Studio Nord pour 2 400,00 €')
    expect(lateLabel('2026-09-02', 32)).toBe('À payer depuis le 2 septembre, 32 jours de retard')
    expect(lateLabel('2026-10-03', 1)).toBe('À payer depuis le 3 octobre, 1 jour de retard')
    expect(lateLabel(null, null)).toBe('En retard')
  })

  it('finds accounting jargon and account numbers, accents included', () => {
    expect(jargonIn('Vos écritures du journal')).toEqual(['écritures', 'journal'])
    expect(jargonIn('Solde du compte 512000')).toEqual(['compte 512000'])
    expect(jargonIn('Argent sur vos comptes 12 345,67 €')).toEqual([])
    expect(jargonIn('TVA en votre faveur, crédit de TVA')).toEqual([])
    expect(jargonIn('Un crédit fournisseur')).toEqual(['crédit'])
  })

  it('never uses jargon, an em or en dash, or a colon without a no-break space in its own wording', () => {
    const texts = Object.values(vocabulary).flatMap((value) => {
      if (typeof value === 'string') return [value]
      if (value && typeof value === 'object' && !Array.isArray(value)) return Object.values(value).filter((v): v is string => typeof v === 'string')
      return []
    })
    expect(texts.length).toBeGreaterThan(5)
    for (const text of texts) {
      expect(jargonIn(text), text).toEqual([])
      expect(text, text).not.toMatch(/[–—]/)
      expect(text, text).not.toMatch(/ [:?]/)
    }
  })
})
