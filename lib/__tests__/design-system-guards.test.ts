import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { findNavEntry, findSubPageTitle, navGroups } from '@/components/layout/nav-config'
import { frenchSpacingEdits } from './helpers/french-spacing'

/**
 * Guards for rules ESLint cannot express well (docs/design-system.md).
 * Files listed in a KNOWN_* set are phase 2 debt: remove them once fixed,
 * never add new ones.
 */

const ROOT = path.resolve(__dirname, '../..')
// En dash (U+2013) and em dash (U+2014), written as escapes so this file stays clean.
const DASHES = new RegExp('[\\u2013\\u2014]')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

const FILES = ['app', 'components', 'lib'].flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
const rel = (file: string) => path.relative(ROOT, file)

/** House style: no em or en dashes in any text (UI copy, comments, messages). */
const KNOWN_DASHES = new Set<string>([])

/**
 * French text still written with a plain space before ":", ";", "?" or "!":
 * reference data whose labels are compared with stored layouts and charts.
 */
const KNOWN_PLAIN_SPACES = new Set([
  'lib/accounting/pcg-data.ts',
  'lib/reports/income-statement/config/default-pcg-config-complete-2026.ts',
  'lib/reports/income-statement/config/default-pcg-config-simplified-2026.ts',
])

describe('design system guards', () => {
  it('scans the source tree', () => {
    expect(FILES.length).toBeGreaterThan(100)
  })

  it('uses no em or en dashes outside the known phase 2 files', () => {
    const offenders = FILES.filter((file) => DASHES.test(readFileSync(file, 'utf8')))
      .map(rel)
      .filter((file) => !KNOWN_DASHES.has(file))
    expect(offenders).toEqual([])
  })

  it('keeps the known dash list honest', () => {
    for (const file of KNOWN_DASHES) {
      const content = readFileSync(path.join(ROOT, file), 'utf8')
      expect(DASHES.test(content), `${file} is clean: remove it from KNOWN_DASHES`).toBe(true)
    }
  })

  it('puts a no-break space before ":", ";", "?" and "!" in French text (KLEDG-R3-QUAL-29)', () => {
    const offenders = FILES.filter((file) => !KNOWN_PLAIN_SPACES.has(rel(file)))
      .flatMap((file) => frenchSpacingEdits(readFileSync(file, 'utf8'), file).map((edit) => `${rel(file)}:${edit.line}: ${edit.excerpt}`))
    expect(offenders).toEqual([])
  })

  it('keeps the known plain space list honest', () => {
    for (const file of KNOWN_PLAIN_SPACES) {
      const edits = frenchSpacingEdits(readFileSync(path.join(ROOT, file), 'utf8'), file)
      expect(edits.length, `${file} is clean: remove it from KNOWN_PLAIN_SPACES`).toBeGreaterThan(0)
    }
  })

  it('picks files with FileInput, never the native control (English "Choose File" in most browsers)', () => {
    // The hidden inputs behind a French button: FileInput itself, the photo picker of a person and the
    // receipt drop zone (camera and several files behind "Prendre une photo" and "Choisir des fichiers")
    const allowed = new Set(['components/ui/file-input.tsx', 'components/features/companies/create-person-form.tsx', 'components/features/receipts/receipt-drop-zone.tsx'])
    const offenders = FILES.filter((file) => file.endsWith('.tsx'))
      .filter((file) => /type=["'{]+file["'}]/.test(readFileSync(file, 'utf8')))
      .map(rel)
      .filter((file) => !allowed.has(file))
    expect(offenders).toEqual([])
  })

  it('puts a no-break space before colons in JSX copy (French typography)', () => {
    // "Format accepté :" with a regular space, or "Format accepté:" without one, in JSX text or a
    // JSX attribute (placeholder, title, aria-label): write "Format accepté&nbsp;:" instead.
    const SKIP_ATTRS = new Set(['className', 'href', 'src', 'id', 'htmlFor', 'key', 'type', 'accept', 'name', 'role', 'value'])
    const BAD = /[\p{L}\p{N})»%€] ?:(?=\s|$)/u
    const offenders: string[] = []
    for (const file of FILES.filter((f) => f.endsWith('.tsx') && !rel(f).startsWith('app/api/'))) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const visit = (node: ts.Node) => {
        const attr = ts.isStringLiteral(node) && ts.isJsxAttribute(node.parent) && !SKIP_ATTRS.has(node.parent.name.getText())
        if ((node.kind === ts.SyntaxKind.JsxText || attr) && BAD.test(node.getText(source))) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
          offenders.push(`${rel(file)}:${line + 1}`)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    // The consent page is being reworked by the security workstream: fix it after that merge, then remove it here
    const known = new Set<string>([])
    expect(offenders.filter((o) => !known.has(o.split(':')[0]))).toEqual([])
  })

  it('names company roles only through ROLE_LABELS (lib/permissions.ts)', () => {
    const offenders = FILES.filter((file) => rel(file) !== 'lib/permissions.ts')
      .filter((file) => /(companyAdmin|accountant|viewer)\s*:\s*['"`]/.test(readFileSync(file, 'utf8')))
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('never renders native confirm() or alert() dialogs in components', () => {
    const offenders = FILES.filter((file) => file.endsWith('.tsx'))
      .filter((file) => /(^|[^.\w])(window\.)?(confirm|alert)\(\s*['"`]/m.test(readFileSync(file, 'utf8')))
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('uses no tabs: page sections are pages or stacked, choosers and filters a SegmentedControl or a select', () => {
    // Files allowed to render tabs (docs/design-system.md, "No tabs"): none. Never add one.
    const ALLOWED_TABS = new Set<string>([])
    const offenders = FILES.filter((file) => rel(file) !== 'components/ui/tabs.tsx')
      .filter((file) => /\bTabsList\b|@\/components\/ui\/tabs['"]/.test(readFileSync(file, 'utf8')))
      .map(rel)
      .filter((file) => !ALLOWED_TABS.has(file))
    expect(offenders).toEqual([])
  })
})

describe('navigation', () => {
  const items = navGroups.flatMap((group) => group.items)

  it('has unique URLs and titles', () => {
    expect(new Set(items.map((item) => item.url)).size).toBe(items.length)
    expect(new Set(items.map((item) => item.title)).size).toBe(items.length)
  })

  it('gives every item its own icon', () => {
    expect(new Set(items.map((item) => item.icon)).size).toBe(items.length)
  })

  it('matches the longest prefix so detail pages keep their section active', () => {
    expect(findNavEntry('/')?.title).toBe('Tableau de bord')
    expect(findNavEntry('/accounts')?.title).toBe('Comptes')
    expect(findNavEntry('/accounts/plan')?.title).toBe('Plan de comptes')
    expect(findNavEntry('/accounts/abc/entries')?.title).toBe('Comptes')
    expect(findNavEntry('/banking/statements')?.title).toBe('Relevés')
    expect(findNavEntry('/provisions')?.title).toBe('Risques et charges')
    expect(findNavEntry('/provisions/impairments')?.title).toBe('Dépréciations')
    expect(findNavEntry('/entries/123/edit')?.title).toBe('Écritures')
    expect(findNavEntry('/rules/library')?.title).toBe('Bibliothèque de règles')
    expect(findNavEntry('/rules/abc')?.title).toBe("Règles d'affectation")
    expect(findNavEntry('/nowhere')).toBeNull()
  })

  it('names pages reached from another page instead of borrowing their section title', () => {
    expect(findSubPageTitle('/banking/connect')?.title).toBe('Connecter une banque')
    expect(findSubPageTitle('/banking/connect/revolut')?.title).toBe('Connecter Revolut Business')
    expect(findSubPageTitle('/reports/balance-sheet/config')?.title).toBe('Configuration du bilan')
    expect(findSubPageTitle('/reports/income-statement/config')?.title).toBe('Configuration du compte de résultat')
    expect(findSubPageTitle('/reports')?.title).toBe('États')
    expect(findSubPageTitle('/entries/new')?.title).toBe('Nouvelle écriture')
    expect(findSubPageTitle('/entries/abc/edit')?.title).toBe("Modifier l'écriture")
    expect(findSubPageTitle('/entries/abc')?.title).toBe('Écriture')
    expect(findSubPageTitle('/banking')).toBeNull()
    expect(findSubPageTitle('/accounts/abc/entries')).toBeNull()
  })

  it('uses the agreed wording', () => {
    const titles = items.map((item) => item.title)
    expect(titles).toContain("Règles d'affectation")
    expect(titles.join(' ')).not.toMatch(/entreprise/i)
  })
})
