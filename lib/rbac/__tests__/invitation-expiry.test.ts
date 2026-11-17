import { afterAll, describe, expect, it } from 'vitest'
import { invitationExpiresOn } from '../invitation-expiry'

const ORIGINAL_TZ = process.env.TZ

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

describe.each(['UTC', 'Europe/Paris', 'America/Los_Angeles', 'Pacific/Kiritimati'])('invitationExpiresOn (TZ=%s)', (zone) => {
  it('gives the day in France, whatever the server timezone', () => {
    process.env.TZ = zone
    // 23:30 UTC on 20/11 is 0:30 on 21/11 in Paris (UTC+1 in winter)
    expect(invitationExpiresOn(new Date('2026-11-20T23:30:00Z'))).toBe('21/11/2026')
    // 21:30 UTC on 20/07 is 23:30 on 20/07 in Paris (UTC+2 in summer)
    expect(invitationExpiresOn(new Date('2026-07-20T21:30:00Z'))).toBe('20/07/2026')
    // 22:30 UTC on 20/07 is 0:30 on 21/07 in Paris
    expect(invitationExpiresOn(new Date('2026-07-20T22:30:00Z'))).toBe('21/07/2026')
  })
})
