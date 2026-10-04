import { describe, expect, it } from 'vitest'
import { describeUserAgent } from '../user-agent'
import { isEmailChangeToken } from '../verification-token'

describe('describeUserAgent', () => {
  it('names the browser and the system', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome sur macOS')
    expect(
      describeUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari sur iPhone')
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe(
      'Firefox sur Windows',
    )
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
      ),
    ).toBe('Edge sur Windows')
  })

  it('falls back for scripts and missing values', () => {
    expect(describeUserAgent('curl/8.7.1')).toBe('curl')
    expect(describeUserAgent(null)).toBe('Appareil inconnu')
    expect(describeUserAgent('something')).toBe('Navigateur inconnu')
  })
})

describe('isEmailChangeToken', () => {
  const jwt = (payload: object) =>
    `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`

  it('recognises the tokens of an email change', () => {
    expect(isEmailChangeToken(jwt({ email: 'a@x.fr', updateTo: 'b@x.fr', requestType: 'change-email-verification' }))).toBe(true)
  })

  it('treats other tokens and garbage as plain verifications', () => {
    expect(isEmailChangeToken(jwt({ email: 'a@x.fr' }))).toBe(false)
    expect(isEmailChangeToken('not-a-token')).toBe(false)
    expect(isEmailChangeToken('a.%%%.c')).toBe(false)
  })
})
