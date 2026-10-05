/**
 * Mention of exempt sales on invoices (CGI ann. II art. 242 nonies A, I, 12°;
 * BOI-TVA-DECLA-30-20-20-10 §490 and §500): exempt training of CGI art. 261,
 * 4, 4° a, the company's text or the default, never on a taxed line.
 */

import { describe, expect, it } from 'vitest'
import { invoiceExemptionMentions, isVatExemption, mentionOf, VAT_EXEMPTIONS } from '../vat-exemptions'

describe('exemption mention', () => {
  it('is the legal basis of the training exemption by default', () => {
    expect(VAT_EXEMPTIONS.training.defaultMention).toBe('Exonération de TVA, article 261, 4, 4° a du CGI')
    expect(mentionOf('training', null)).toBe('Exonération de TVA, article 261, 4, 4° a du CGI')
    expect(mentionOf('training', '  ')).toBe('Exonération de TVA, article 261, 4, 4° a du CGI')
    expect(mentionOf('training', 'TVA non applicable, article 261-4-4° a du CGI')).toBe('TVA non applicable, article 261-4-4° a du CGI')
  })

  it('appears only when a line is exempt', () => {
    expect(invoiceExemptionMentions([{ position: 1, vatExemption: null }, { position: 2, vatExemption: null }], null)).toEqual([])
    expect(invoiceExemptionMentions([{ position: 1, vatExemption: 'training' }], null)).toEqual([
      { code: 'training', text: 'Exonération de TVA, article 261, 4, 4° a du CGI', positions: [1] },
    ])
  })

  it('names the exempt lines of a mixed invoice, never the taxed ones', () => {
    const mentions = invoiceExemptionMentions(
      [
        { position: 1, vatExemption: 'training' },
        { position: 2, vatExemption: null },
        { position: 3, vatExemption: 'training' },
      ],
      null,
    )
    expect(mentions).toEqual([{ code: 'training', text: 'Exonération de TVA, article 261, 4, 4° a du CGI (lignes 1, 3)', positions: [1, 3] }])
  })

  it('ignores an unknown code', () => {
    expect(isVatExemption('export')).toBe(false)
    expect(invoiceExemptionMentions([{ position: 1, vatExemption: 'export' }], null)).toEqual([])
  })
})
