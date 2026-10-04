import { describe, expect, it } from 'vitest'
import { clientDisplayName, safeLogoUri } from '../consent-client'
import { startingAccess } from '@/lib/ai-access/access'

describe('client shown on the consent page', () => {
  it('names verified assistants, CIMD clients by their declared name or domain, others as unverified', () => {
    expect(clientDisplayName('Claude', 'claude')).toBe('Claude')
    expect(clientDisplayName('Not Claude', 'claude')).toBe('Claude')
    expect(clientDisplayName('  ', 'chatgpt')).toBe('ChatGPT')
    expect(clientDisplayName('Mon outil', 'other', 'outil.example')).toBe('Mon outil')
    expect(clientDisplayName(undefined, 'other', 'outil.example')).toBe('outil.example')
    expect(clientDisplayName('ChatGPT', 'other')).toBe('Application non vérifiée')
  })

  it('shows a remote logo only for CIMD clients, over https, never SVG', () => {
    expect(safeLogoUri('https://cdn.example.com/logo.png', 'example.com')).toBe('https://cdn.example.com/logo.png')
    expect(safeLogoUri('https://cdn.example.com/logo.png', null)).toBeNull()
    expect(safeLogoUri('http://cdn.example.com/logo.png', 'example.com')).toBeNull()
    expect(safeLogoUri('https://cdn.example.com/logo.svg', 'example.com')).toBeNull()
    expect(safeLogoUri('data:image/png;base64,AAAA', 'example.com')).toBeNull()
    expect(safeLogoUri('not a url', 'example.com')).toBeNull()
  })
})

describe('company choice the consent page starts from', () => {
  it('starts from every company without a saved list', () => {
    expect(startingAccess(undefined, ['a'])).toEqual({ allCompanies: true, companyIds: [] })
    expect(startingAccess({ allCompanies: true, companyIds: [] }, ['a'])).toEqual({ allCompanies: true, companyIds: [] })
  })

  it('keeps the saved companies the user still has, else every company', () => {
    const saved = { allCompanies: false, companyIds: ['a', 'gone'] }
    expect(startingAccess(saved, ['a', 'b'])).toEqual({ allCompanies: false, companyIds: ['a'] })
    expect(startingAccess(saved, [])).toEqual({ allCompanies: true, companyIds: [] })
    // While the companies load, the saved choice is shown as it is.
    expect(startingAccess(saved, null)).toEqual(saved)
  })
})
