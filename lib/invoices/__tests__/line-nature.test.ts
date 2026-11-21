/**
 * Nature of an imported invoice line (lib/invoices/line-nature.ts, #132):
 * goods or services decide when the VAT of a sale is due (CGI art. 269, 2,
 * a and c) and when the VAT of a purchase is deductible (art. 271, I-2).
 */

import { describe, expect, it } from 'vitest'
import { defaultLineNature } from '../line-nature'

describe('defaultLineNature', () => {
  it('follows the account of the tiers', () => {
    expect(defaultLineNature({ tiersAccountCode: '707000' })).toBe('GOODS')
    expect(defaultLineNature({ tiersAccountCode: '701' })).toBe('GOODS')
    expect(defaultLineNature({ tiersAccountCode: '706100' })).toBe('SERVICES')
    expect(defaultLineNature({ tiersAccountCode: '607000' })).toBe('GOODS')
    expect(defaultLineNature({ tiersAccountCode: '6064' })).toBe('GOODS')
    expect(defaultLineNature({ tiersAccountCode: '604000' })).toBe('SERVICES')
    expect(defaultLineNature({ tiersAccountCode: '622600' })).toBe('SERVICES')
  })

  it('falls back on the activity of the company: trade and manufacturing sell goods', () => {
    expect(defaultLineNature({ activityCode: '47.11F' })).toBe('GOODS')
    expect(defaultLineNature({ activityCode: '2511Z' })).toBe('GOODS')
    expect(defaultLineNature({ activityCode: '62.01Z' })).toBe('SERVICES')
    // The account of the tiers wins over the activity
    expect(defaultLineNature({ tiersAccountCode: '706000', activityCode: '47.11F' })).toBe('SERVICES')
    expect(defaultLineNature({})).toBe('SERVICES')
  })
})
