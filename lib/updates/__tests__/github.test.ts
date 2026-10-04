import { afterEach, describe, expect, it } from 'vitest'
import {
  comparePath,
  contentsPath,
  errorFromResponse,
  githubRequest,
  GitHubError,
  isValidOwner,
  isValidRepo,
  repoPath,
  tokenExpiryFromHeaders,
} from '../github'
import { fakeGitHub, resetGitHub, TOKEN } from './fake-github'

afterEach(() => resetGitHub())

describe('repository names', () => {
  it('accepts GitHub owner and repository names', () => {
    expect(isValidOwner('kledghq')).toBe(true)
    expect(isValidOwner('my-org-2')).toBe(true)
    expect(isValidRepo('kledg')).toBe(true)
    expect(isValidRepo('my.repo_name-1')).toBe(true)
  })

  it('rejects anything that could change the path or host', () => {
    for (const owner of ['', '-x', 'x-', 'a--b', 'a/b', '..', 'a b', 'evil.com', 'a'.repeat(40)]) {
      expect(isValidOwner(owner), owner).toBe(false)
    }
    for (const repo of ['', '.', '..', 'a/b', 'a?b', 'a#b', 'x.git', 'a b', 'a'.repeat(101)]) {
      expect(isValidRepo(repo), repo).toBe(false)
    }
    expect(() => repoPath({ owner: '..', repo: 'x' })).toThrow(GitHubError)
  })

  it('builds encoded fixed paths', () => {
    expect(repoPath({ owner: 'acme', repo: 'kledg' }, 'pulls', 12, 'merge')).toBe('/repos/acme/kledg/pulls/12/merge')
    expect(contentsPath({ owner: 'acme', repo: 'kledg' }, '.github/workflows/x.yml', 'main')).toBe(
      '/repos/acme/kledg/contents/.github/workflows/x.yml?ref=main',
    )
    expect(comparePath({ owner: 'kledghq', repo: 'kledg' }, 'v0.1.0', 'v0.2.0')).toBe('/repos/kledghq/kledg/compare/v0.1.0...v0.2.0')
    expect(() => contentsPath({ owner: 'a', repo: 'b' }, '../secrets')).toThrow(GitHubError)
    expect(() => contentsPath({ owner: 'a', repo: 'b' }, 'x', '../../x')).toThrow(GitHubError)
    expect(() => comparePath({ owner: 'a', repo: 'b' }, 'main', 'x?y=1')).toThrow(GitHubError)
  })
})

describe('githubRequest', () => {
  it('only calls api.github.com', async () => {
    await expect(githubRequest('//evil.example/x')).rejects.toThrow(GitHubError)
    await expect(githubRequest('https://evil.example/x')).rejects.toThrow(GitHubError)
  })

  it('sends the token in the Authorization header only', async () => {
    const fake = fakeGitHub({ 'GET /repos/acme/kledg': { body: { ok: true } } })
    await githubRequest('/repos/acme/kledg', { token: TOKEN })
    expect(fake.calls[0].authorization).toBe(`Bearer ${TOKEN}`)
    expect(fake.calls[0].path).not.toContain(TOKEN)
  })

  it('never puts the token in error messages', async () => {
    fakeGitHub({ 'GET /repos/acme/kledg': { status: 401, body: { message: `Bad credentials ${TOKEN}` } } })
    const error = await githubRequest('/repos/acme/kledg', { token: TOKEN }).catch((e) => e)
    expect(error).toBeInstanceOf(GitHubError)
    expect(error.message).not.toContain(TOKEN)
    expect(error.message).toContain('Jeton GitHub refusé')
    // A GitHub 401 is not a 401 of Kledg (the admin session is fine).
    expect(error.statusCode).toBe(400)
  })
})

describe('errorFromResponse', () => {
  it('maps statuses to French messages', () => {
    expect(errorFromResponse(404, new Headers()).message).toContain('introuvable')
    expect(errorFromResponse(409, new Headers()).statusCode).toBe(409)
    expect(errorFromResponse(500, new Headers()).statusCode).toBe(502)
    expect(errorFromResponse(403, new Headers({ 'x-ratelimit-remaining': '0' })).githubCode).toBe('rate_limited')
  })

  it('names the missing permission', () => {
    const error = errorFromResponse(403, new Headers({ 'x-accepted-github-permissions': 'pull_requests=write' }))
    expect(error.message).toContain('Pull requests (lecture et écriture)')
  })
})

describe('tokenExpiryFromHeaders', () => {
  it('reads the fine-grained token expiry header', () => {
    expect(tokenExpiryFromHeaders(new Headers({ 'github-authentication-token-expiration': '2026-12-31 23:00:00 UTC' }))?.toISOString()).toBe(
      '2026-12-31T23:00:00.000Z',
    )
    expect(tokenExpiryFromHeaders(new Headers({ 'github-authentication-token-expiration': '2026-12-31 23:00:00 +0100' }))?.toISOString()).toBe(
      '2026-12-31T22:00:00.000Z',
    )
    expect(tokenExpiryFromHeaders(new Headers())).toBeNull()
  })
})
