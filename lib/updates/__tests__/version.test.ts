import { describe, expect, it } from 'vitest'
import pkg from '@/package.json'
import { compareVersions, getDeployedVersion, isPrerelease, parseVersion } from '../version'
import { detectPlatform, GITHUB_DEPLOY_NOTES, MANUAL_UPDATE_COMMANDS, PLATFORM_LABELS, PLATFORMS } from '../hosting'

describe('parseVersion', () => {
  it('parses releases, v prefixes, pre-releases and build metadata', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
    expect(parseVersion('v0.1.0')).toEqual({ major: 0, minor: 1, patch: 0, prerelease: [] })
    expect(parseVersion('1.0.0-rc.1+build.5')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: ['rc', '1'] })
  })

  it('rejects non semver values', () => {
    for (const value of ['', '1.2', '01.2.3', 'latest', '1.2.3.4', null, undefined]) {
      expect(parseVersion(value)).toBeNull()
    }
  })
})

describe('compareVersions (semver.org precedence)', () => {
  it('orders major, minor and patch numerically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.2.3', '1.10.0')).toBe(-1)
  })

  it('puts a pre-release before its release', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1)
  })

  it('follows the semver example chain', () => {
    const chain = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0']
    for (let i = 0; i < chain.length - 1; i++) {
      expect(compareVersions(chain[i], chain[i + 1])).toBe(-1)
    }
  })

  it('ignores build metadata and sorts invalid versions first', () => {
    expect(compareVersions('1.0.0+a', '1.0.0+b')).toBe(0)
    expect(compareVersions('nope', '0.0.1')).toBe(-1)
    expect(compareVersions('0.0.1', 'nope')).toBe(1)
  })

  it('detects pre-releases', () => {
    expect(isPrerelease('1.0.0-beta.1')).toBe(true)
    expect(isPrerelease('1.0.0')).toBe(false)
  })
})

describe('getDeployedVersion', () => {
  it('reads the Vercel deployment', () => {
    const v = getDeployedVersion({
      VERCEL: '1',
      VERCEL_GIT_PROVIDER: 'github',
      VERCEL_GIT_COMMIT_SHA: 'ABCDEF1234567890ABCDEF1234567890ABCDEF12',
      VERCEL_GIT_COMMIT_REF: 'main',
      VERCEL_GIT_REPO_OWNER: 'acme',
      VERCEL_GIT_REPO_SLUG: 'compta',
      KLEDG_BUILD_DATE: '2026-10-03T10:00:00.000Z',
    })
    expect(v).toEqual({
      version: pkg.version,
      commit: 'abcdef1234567890abcdef1234567890abcdef12',
      branch: 'main',
      repository: { owner: 'acme', repo: 'compta' },
      buildDate: '2026-10-03T10:00:00.000Z',
      platform: 'vercel',
      deploysFromGitHub: true,
    })
  })

  it('reads the Docker build arguments', () => {
    const v = getDeployedVersion({ KLEDG_RUNTIME: 'docker', KLEDG_COMMIT: 'abc1234', KLEDG_VERSION: 'v0.2.0' })
    expect(v.platform).toBe('docker')
    expect(v.commit).toBe('abc1234')
    expect(v.version).toBe('0.2.0')
    expect(v.repository).toBeNull()
  })

  it('ignores malformed values', () => {
    const v = getDeployedVersion({
      VERCEL: '1',
      VERCEL_GIT_COMMIT_SHA: 'not a sha',
      VERCEL_GIT_REPO_OWNER: 'evil/../x',
      VERCEL_GIT_REPO_SLUG: 'repo',
      KLEDG_VERSION: 'latest',
    })
    expect(v.commit).toBeNull()
    expect(v.repository).toBeNull()
    expect(v.version).toBe(pkg.version)
  })

  it('has no repository for GitLab or Bitbucket deployments', () => {
    const v = getDeployedVersion({ VERCEL: '1', VERCEL_GIT_PROVIDER: 'gitlab', VERCEL_GIT_REPO_OWNER: 'a', VERCEL_GIT_REPO_SLUG: 'b' })
    expect(v.repository).toBeNull()
  })

  it('falls back to a plain Node install', () => {
    expect(getDeployedVersion({}).platform).toBe('node')
    expect(getDeployedVersion({}).deploysFromGitHub).toBe(false)
  })

  const SHA = '0123456789abcdef0123456789abcdef01234567'

  it('reads a Railway deployment from GitHub', () => {
    const v = getDeployedVersion({
      KLEDG_RUNTIME: 'docker',
      RAILWAY_ENVIRONMENT_ID: 'env-id',
      RAILWAY_PROJECT_ID: 'project-id',
      RAILWAY_GIT_COMMIT_SHA: SHA,
      RAILWAY_GIT_BRANCH: 'main',
      RAILWAY_GIT_REPO_OWNER: 'acme',
      RAILWAY_GIT_REPO_NAME: 'compta',
    })
    expect(v).toMatchObject({ platform: 'railway', commit: SHA, branch: 'main', repository: { owner: 'acme', repo: 'compta' }, deploysFromGitHub: true })
  })

  it('offers no one-click update for a Railway deployment without a commit (CLI or image)', () => {
    const v = getDeployedVersion({ KLEDG_RUNTIME: 'docker', RAILWAY_PROJECT_ID: 'project-id' })
    expect(v).toMatchObject({ platform: 'railway', commit: null, repository: null, deploysFromGitHub: false })
  })

  it('reads a Render deployment', () => {
    const v = getDeployedVersion({
      KLEDG_RUNTIME: 'docker',
      RENDER: 'true',
      RENDER_GIT_COMMIT: SHA,
      RENDER_GIT_BRANCH: 'main',
      RENDER_GIT_REPO_SLUG: 'acme/compta',
    })
    expect(v).toMatchObject({ platform: 'render', commit: SHA, branch: 'main', repository: { owner: 'acme', repo: 'compta' }, deploysFromGitHub: true })
  })

  it('refuses a malformed Render repository slug', () => {
    expect(getDeployedVersion({ RENDER: 'true', RENDER_GIT_REPO_SLUG: 'acme/compta/extra' }).repository).toBeNull()
    expect(getDeployedVersion({ RENDER: 'true', RENDER_GIT_REPO_SLUG: '../compta' }).repository).toBeNull()
  })

  it('reads Fly.io, whose commit is the image build argument', () => {
    const v = getDeployedVersion({ KLEDG_RUNTIME: 'docker', FLY_APP_NAME: 'kledg-acme', KLEDG_COMMIT: SHA })
    expect(v).toMatchObject({ platform: 'fly', commit: SHA, repository: null, deploysFromGitHub: false })
  })

  it('reads Clever Cloud', () => {
    const v = getDeployedVersion({
      KLEDG_RUNTIME: 'docker',
      APP_ID: 'app_649a93d1-6677-44bc-aca7-6f46107d6e02',
      CC_COMMIT_ID: SHA,
    })
    expect(v).toMatchObject({ platform: 'clevercloud', commit: SHA, deploysFromGitHub: false })
    expect(getDeployedVersion({ CC_DEPLOYMENT_ID: 'f7efaf04-1a63-45a1-8503-0de7c750ee48' }).platform).toBe('clevercloud')
    // Another APP_ID (set by some other tool) is not Clever Cloud.
    expect(getDeployedVersion({ KLEDG_RUNTIME: 'docker', APP_ID: 'kledg' }).platform).toBe('docker')
  })

  it('reads Coolify', () => {
    const v = getDeployedVersion({ KLEDG_RUNTIME: 'docker', COOLIFY_RESOURCE_UUID: 'abc', SOURCE_COMMIT: SHA, COOLIFY_BRANCH: 'main' })
    expect(v).toMatchObject({ platform: 'coolify', commit: SHA, branch: 'main', deploysFromGitHub: false })
  })

  it('lets the operator turn the one-click update on or off', () => {
    expect(getDeployedVersion({ FLY_APP_NAME: 'kledg', KLEDG_DEPLOYS_FROM_GITHUB: 'true' }).deploysFromGitHub).toBe(true)
    expect(getDeployedVersion({ KLEDG_RUNTIME: 'docker', KLEDG_DEPLOYS_FROM_GITHUB: 'TRUE' }).deploysFromGitHub).toBe(true)
    expect(getDeployedVersion({ VERCEL: '1', KLEDG_DEPLOYS_FROM_GITHUB: 'false' }).deploysFromGitHub).toBe(false)
  })

  it('prefers the commit the host deployed over the one baked into the image', () => {
    expect(getDeployedVersion({ RENDER: 'true', RENDER_GIT_COMMIT: SHA, KLEDG_COMMIT: 'abc1234' }).commit).toBe(SHA)
    expect(getDeployedVersion({ RENDER: 'true', RENDER_GIT_COMMIT: 'nope', KLEDG_COMMIT: 'abc1234' }).commit).toBe('abc1234')
  })
})

describe('detectPlatform', () => {
  it('checks the host variables before the Docker marker of the image', () => {
    const docker = { KLEDG_RUNTIME: 'docker' }
    expect(detectPlatform({ ...docker })).toBe('docker')
    expect(detectPlatform({ ...docker, RAILWAY_ENVIRONMENT_ID: 'x' })).toBe('railway')
    expect(detectPlatform({ ...docker, RENDER: 'true' })).toBe('render')
    expect(detectPlatform({ ...docker, RENDER: 'false' })).toBe('docker')
    expect(detectPlatform({ ...docker, FLY_APP_NAME: 'x' })).toBe('fly')
    expect(detectPlatform({ ...docker, COOLIFY_CONTAINER_NAME: 'x' })).toBe('coolify')
    expect(detectPlatform({ VERCEL: '1', RENDER: 'true' })).toBe('vercel')
  })

  it('has a label, a merge note and manual commands for every platform, without dashes', () => {
    for (const platform of PLATFORMS) {
      for (const text of [PLATFORM_LABELS[platform], GITHUB_DEPLOY_NOTES[platform], MANUAL_UPDATE_COMMANDS[platform]]) {
        expect(text).toBeTruthy()
        expect(text).not.toMatch(/[–—]/)
      }
    }
  })
})
