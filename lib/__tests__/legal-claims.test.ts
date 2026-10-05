/**
 * What Kledg says about itself must be true (pratique commerciale trompeuse,
 * Code de la consommation art. L121-2, and the e-invoicing reform: only a
 * plateforme agréée by the DGFiP may receive or issue electronic invoices,
 * CGI art. 289 bis and décret n° 2022-1299 as amended). Kledg records
 * invoices; it is not a plateforme agréée, has no Factur-X, UBL or CII
 * import, and its FEC checks are its own, not the DGFiP's Test Compta
 * Demat. The guard scans the user interface, the documentation and the
 * README for claims that would say otherwise; docs/conformite.md states what
 * Kledg guarantees and what it does not.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')

function files(dir: string, extensions: string[]): string[] {
  const found: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) found.push(...files(path, extensions))
    else if (extensions.some((ext) => name.endsWith(ext))) found.push(path)
  }
  return found
}

const SOURCES = [
  ...files(join(ROOT, 'app'), ['.tsx', '.ts']),
  ...files(join(ROOT, 'components'), ['.tsx', '.ts']),
  ...files(join(ROOT, 'docs'), ['.md']),
  join(ROOT, 'README.md'),
]

/** Claims Kledg cannot make, with the reason. */
const FORBIDDEN: { pattern: RegExp; reason: string }[] = [
  { pattern: /prêts? pour un import Factur-X/i, reason: 'Kledg has no Factur-X, UBL or CII import' },
  { pattern: /\bPDP\b/, reason: 'the reform now says plateforme agréée (PA); Kledg is not one' },
  { pattern: /Kledg (est|devient) (une )?plateforme (agréée|de dématérialisation)/i, reason: 'Kledg is not a plateforme agréée' },
  { pattern: /conforme au PCG 2026/i, reason: 'the PCG is règlement ANC n° 2014-03 as amended, there is no "PCG 2026"' },
  { pattern: /Fichier conforme/, reason: 'Kledg checks the FEC itself; only the DGFiP decides compliance (Test Compta Demat)' },
  { pattern: /Export FEC conforme/, reason: 'same: say what is checked, not that the file is compliant' },
]

describe('claims about legal compliance', () => {
  it('documents what Kledg guarantees and what it does not (docs/conformite.md)', () => {
    const doc = readFileSync(join(ROOT, 'docs', 'conformite.md'), 'utf8')
    expect(doc).toContain("Kledg n'est pas une plateforme agréée")
    expect(doc).toContain('Kledg ne stocke aucun fichier')
    expect(doc).toContain('hors du périmètre')
    expect(readFileSync(join(ROOT, 'docs', 'README.md'), 'utf8')).toContain('(conformite.md)')
  })

  it('scans the interface, the docs and the README', () => {
    expect(SOURCES.length).toBeGreaterThan(100)
  })

  for (const { pattern, reason } of FORBIDDEN) {
    it(`never claims ${pattern} (${reason})`, () => {
      const offenders = SOURCES.filter((path) => pattern.test(readFileSync(path, 'utf8'))).map((path) => relative(ROOT, path))
      expect(offenders).toEqual([])
    })
  }
})
