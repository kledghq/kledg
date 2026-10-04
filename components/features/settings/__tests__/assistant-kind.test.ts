/**
 * Which assistant an OAuth client is, as the consent page and the "Connexions
 * IA" page show it. Only a client identified by a metadata document (CIMD)
 * served from an allowlisted origin gets Claude or ChatGPT branding: Better
 * Auth fetched that document from the client id URL and checked that it
 * names this very URL, so only claude.ai or chatgpt.com can publish it. A
 * client registered dynamically (RFC 7591) declares its name, URI and logo
 * itself: it is never branded, whatever it claims.
 */

import { describe, expect, it } from 'vitest'
import { assistantKind, declaredDomain } from '../use-assistant-connections'
import { clientDisplayName } from '../consent-client'

describe('assistantKind', () => {
  it('recognises Claude by its client metadata document on claude.ai', () => {
    expect(assistantKind('https://claude.ai/oauth/mcp-oauth-client-metadata', { client_name: 'Claude', client_uri: 'https://claude.ai' })).toBe('claude')
  })

  it('recognises ChatGPT by its client metadata document on chatgpt.com', () => {
    expect(assistantKind('https://chatgpt.com/oauth/client-metadata.json', { client_name: 'ChatGPT' })).toBe('chatgpt')
  })

  it('never brands a dynamically registered client, whatever name or URI it declares', () => {
    expect(assistantKind('dyn-abc123', { client_name: 'ChatGPT', client_uri: 'https://chatgpt.com' })).toBe('other')
    expect(assistantKind('dyn-abc123', { client_name: 'Claude', client_uri: 'https://claude.ai' })).toBe('other')
    expect(assistantKind('dyn-abc123', { client_uri: 'https://openai.com' })).toBe('other')
    expect(assistantKind('dyn-1', { client_name: 'Claude Code (kledg)' })).toBe('other')
  })

  it('does not brand look-alike or other origins', () => {
    for (const id of [
      'https://claude.ai.evil.example/oauth/metadata',
      'https://evil-claude.ai/oauth/metadata',
      'https://sub.claude.ai/oauth/metadata',
      'http://claude.ai/oauth/metadata',
      'https://chatgpt.com.evil.example/oauth',
      'https://claude.ai:8443/oauth/metadata',
      'https://example.com/client',
      'not a url',
    ]) {
      expect(assistantKind(id, { client_name: 'Claude' }), id).toBe('other')
    }
  })

  it('names an unverified client "Application non vérifiée" with its declared domain', () => {
    expect(clientDisplayName('ChatGPT', 'other')).toBe('Application non vérifiée')
    expect(clientDisplayName(undefined, 'claude')).toBe('Claude')
    expect(declaredDomain({ client_uri: 'https://chatgpt.com/whatever' })).toBe('chatgpt.com')
    expect(declaredDomain({ client_uri: 'javascript:alert(1)' })).toBeNull()
    expect(declaredDomain(null)).toBeNull()
  })
})
