import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  browserLabel,
  contextLines,
  feedbackIssueUrl,
  feedbackSearchUrl,
  FEEDBACK_TEMPLATES,
  isFeedbackRepo,
  pagePattern,
  type FeedbackContext,
} from '../issue-url'
import { feedbackRepo, getFeedbackTarget } from '../target'

const CONTEXT: FeedbackContext = {
  version: '0.6.0',
  commit: 'abcdef1234567890',
  host: 'Vercel',
  page: '/[companyId]/entries',
  displayMode: 'Expert',
  browser: 'Firefox 140, Linux',
  language: 'fr-FR',
}

function query(url: string): URLSearchParams {
  return new URL(url).searchParams
}

/** Field ids of an issue form (".github/ISSUE_TEMPLATE/<file>"). */
function templateIds(file: string): string[] {
  const yaml = readFileSync(path.join(process.cwd(), '.github/ISSUE_TEMPLATE', file), 'utf8')
  return [...yaml.matchAll(/^\s+id:\s*(\S+)\s*$/gm)].map((match) => match[1])
}

describe('issue forms', () => {
  it('uses only field ids that exist in the repository templates', () => {
    for (const { file, ...fields } of Object.values(FEEDBACK_TEMPLATES)) {
      const ids = templateIds(file)
      for (const id of Object.values(fields)) expect(ids, `${file}: ${id}`).toContain(id)
    }
  })
})

describe('feedbackIssueUrl', () => {
  it('prefills the bug form: title, description with the context, steps and version', () => {
    const url = feedbackIssueUrl('kledghq/kledg', { kind: 'bug', title: 'Export FEC vide', description: 'Le fichier est vide.', details: '1. Exporter' }, CONTEXT)
    expect(url.startsWith('https://github.com/kledghq/kledg/issues/new?')).toBe(true)
    const q = query(url)
    expect(q.get('template')).toBe('bug_report.yml')
    expect(q.get('title')).toBe('Export FEC vide')
    expect(q.get('what')).toContain('Le fichier est vide.')
    expect(q.get('what')).toContain('- Version\u00a0: 0.6.0 (abcdef1)')
    expect(q.get('what')).toContain('- Page\u00a0: /[companyId]/entries')
    expect(q.get('steps')).toBe('1. Exporter')
    expect(q.get('version')).toBe('0.6.0 (abcdef1)')
  })

  it('prefills the idea form: need with the context, and the proposal', () => {
    const q = query(feedbackIssueUrl('acme/kledg-instance', { kind: 'idea', title: 'Export Excel', description: 'Besoin X', details: 'Proposition Y' }, CONTEXT))
    expect(q.get('template')).toBe('feature_request.yml')
    expect(q.get('need')).toMatch(/^Besoin X\n\n\*\*Contexte technique\*\*/)
    expect(q.get('proposal')).toBe('Proposition Y')
    expect(q.has('version')).toBe(false)
  })

  it('shortens long texts so the link stays usable', () => {
    const long = 'é'.repeat(4000)
    const url = feedbackIssueUrl('kledghq/kledg', { kind: 'bug', title: 't'.repeat(300), description: long, details: long }, CONTEXT)
    expect(url.length).toBeLessThanOrEqual(7500)
    expect(query(url).get('title')).toHaveLength(120)
    expect(query(url).get('what')).toContain('…')
  })

  it('refuses a repository that is not owner/name', () => {
    expect(() => feedbackIssueUrl('kledghq/kledg/issues', { kind: 'bug', title: 'a', description: 'b' }, CONTEXT)).toThrow()
    expect(isFeedbackRepo('kledghq/kledg')).toBe(true)
    expect(isFeedbackRepo('https://github.com/kledghq/kledg')).toBe(false)
    expect(isFeedbackRepo('owner/..')).toBe(false)
  })
})

describe('feedbackSearchUrl', () => {
  it('searches the issues of the repository with the title', () => {
    expect(query(feedbackSearchUrl('kledghq/kledg', 'Export "FEC" vide')).get('q')).toBe('is:issue Export  FEC  vide')
  })
})

describe('contextLines', () => {
  it('lists only what is known, with the error reference', () => {
    expect(contextLines({ version: '0.6.0', commit: null, host: 'Docker', errorReference: '12345' })).toEqual([
      'Version\u00a0: 0.6.0',
      'Hébergement\u00a0: Docker',
      "Référence de l'erreur\u00a0: 12345",
    ])
  })
})

describe('pagePattern', () => {
  it('replaces route parameters, such as the company slug, by their names', () => {
    expect(pagePattern('/atelier-lumen/entries/cm9x2k3l40000abcdxyz12345', { companyId: 'atelier-lumen', entryId: 'cm9x2k3l40000abcdxyz12345' })).toBe(
      '/[companyId]/entries/[entryId]',
    )
  })

  it('matches encoded segments and drops the query string and hash', () => {
    expect(pagePattern('/caf%C3%A9-du-port/reports?year=2025#top', { companyId: 'café-du-port' })).toBe('/[companyId]/reports')
  })

  it('hides ids that are not route parameters', () => {
    expect(pagePattern('/settings/members/123/cm9x2k3l40000abcdxyz12345', {})).toBe('/settings/members/[id]/[id]')
  })
})

describe('browserLabel', () => {
  it('names the browser, its major version and the system, nothing more', () => {
    expect(browserLabel('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0')).toBe('Firefox 140, Linux')
    expect(browserLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0')).toBe('Edge 141, Windows')
    expect(browserLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')).toBe('Safari 18, iOS')
    expect(browserLabel('curl/8.0')).toBeNull()
  })
})

describe('feedback target', () => {
  it('sends to kledghq/kledg unless the instance names its own repository', () => {
    expect(feedbackRepo({})).toBe('kledghq/kledg')
    expect(feedbackRepo({ KLEDG_FEEDBACK_REPO: ' acme/kledg-instance ' })).toBe('acme/kledg-instance')
    expect(feedbackRepo({ KLEDG_FEEDBACK_REPO: 'not a repo' })).toBe('kledghq/kledg')
  })

  it('gives the version, the commit and the host name', () => {
    expect(getFeedbackTarget({ VERCEL: '1', VERCEL_GIT_COMMIT_SHA: 'abcdef1234567', KLEDG_VERSION: '0.6.0' })).toEqual({
      repo: 'kledghq/kledg',
      version: '0.6.0',
      commit: 'abcdef1234567',
      host: 'Vercel',
    })
  })
})
