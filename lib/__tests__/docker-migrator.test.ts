/**
 * The Docker image runs the Prisma CLI with the migration role
 * (DATABASE_MIGRATION_URL, docker-migrate.sh). It is installed in the
 * migrator stage of the Dockerfile from a committed lockfile
 * (docker/migrator/package-lock.json, `npm ci`), never resolved at build
 * time, and pinned to the versions of pnpm-lock.yaml: the same packages, with
 * the same integrity hashes, as the CLI the application is built with.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

const manifest = JSON.parse(read('docker/migrator/package.json')) as { dependencies: Record<string, string> }
const lock = JSON.parse(read('docker/migrator/package-lock.json')) as {
  packages: Record<string, { version?: string; resolved?: string; integrity?: string; dev?: boolean }>
}
const pnpmLock = read('pnpm-lock.yaml')

/** The integrity pnpm-lock.yaml records for name@version, if it has that package. */
function pnpmIntegrity(name: string, version: string): string | undefined {
  const escaped = `${name}@${version}`.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const match = new RegExp(`^  '?${escaped}'?:\\n    resolution: \\{integrity: ([^}]+)\\}`, 'm').exec(pnpmLock)
  return match?.[1]
}

describe('Docker migrator dependencies', () => {
  it('installs from the committed lockfile', () => {
    const dockerfile = read('Dockerfile')
    expect(dockerfile).toMatch(/COPY docker\/migrator\/package\.json docker\/migrator\/package-lock\.json \.\//)
    expect(dockerfile).toMatch(/RUN npm ci\b/)
    expect(dockerfile).not.toMatch(/\bnpm (install|i) /)
  })

  it('pins prisma and dotenv to the versions of pnpm-lock.yaml', () => {
    for (const name of ['prisma', 'dotenv']) {
      const version = manifest.dependencies[name]
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/)
      const importer = new RegExp(`^      ${name}:\\n        specifier: [^\\n]+\\n        version: ${version.replace(/\./g, '\\.')}\\b`, 'm')
      expect(pnpmLock, `${name}@${version} in pnpm-lock.yaml`).toMatch(importer)
      expect(lock.packages[`node_modules/${name}`]?.version, name).toBe(version)
    }
  })

  it('locks every package from the npm registry with an integrity hash matching pnpm-lock.yaml', () => {
    const entries = Object.entries(lock.packages).filter(([key]) => key !== '')
    expect(entries.length).toBeGreaterThan(10)
    let compared = 0
    for (const [key, entry] of entries) {
      expect(entry.resolved, key).toMatch(/^https:\/\/registry\.npmjs\.org\//)
      expect(entry.integrity, key).toMatch(/^sha512-/)
      const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)
      const expected = pnpmIntegrity(name, entry.version!)
      if (expected) {
        expect(entry.integrity, key).toBe(expected)
        compared++
      }
    }
    expect(compared).toBeGreaterThan(10)
  })
})
