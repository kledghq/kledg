/**
 * French typography of user strings (docs/conventions.md, "Messages shown to
 * users are French"): a no-break space (U+00A0) before ":", ";", "?" and "!",
 * so the sign never starts a line. Shared by the guard test
 * (lib/__tests__/design-system-guards.test.ts) and the one-off codemod that
 * applied it (KLEDG-R3-QUAL-29).
 *
 * Only text is read, through the TypeScript syntax tree: string literals,
 * template literal text and JSX text. Never code, regular expressions,
 * tagged templates (SQL), RegExp arguments, imports, log calls or test
 * titles. English typography never puts a space before these signs, so any
 * such space in text is French; strings that look like code (SQL, URLs,
 * arrows, CSS rules) are left alone.
 */

import ts from 'typescript'

/**
 * A plain space before the sign, the sign then ending the word (space, end,
 * closing quote or bracket, dot). Not a sign quoted on its own ("« ; »").
 */
const PLAIN_SPACE_BEFORE = /(?<!«) ([:;?!])(?=$|[\s"'’»)\].,]|\\n)/g

/** Text that is code or a pattern even when it holds French words. */
const CODE_LIKE = /(:\/\/|=>|\b(SELECT|UPDATE|INSERT|DELETE|WHERE)\b|^\s*[.#][\w-]+\s*\{)/

const SKIPPED_CALLEES = new Set(['RegExp', 'require'])
/** Test titles: the first argument of describe, it, test and of their .each(table)(title, fn) forms. */
const TITLED_CALLEES = new Set(['describe', 'it', 'test', 'each', 'skip', 'only', 'skipIf', 'runIf', 'todo'])
const SKIPPED_OBJECTS = new Set(['logger', 'console'])

function calleeName(call: ts.CallExpression | ts.NewExpression): { name: string | null; object: string | null } {
  const callee = call.expression
  if (ts.isIdentifier(callee)) return { name: callee.text, object: null }
  if (ts.isPropertyAccessExpression(callee)) {
    const object = ts.isIdentifier(callee.expression)
      ? callee.expression.text
      : ts.isPropertyAccessExpression(callee.expression) && ts.isIdentifier(callee.expression.expression)
        ? callee.expression.expression.text
        : ts.isCallExpression(callee.expression)
          ? calleeName(callee.expression).name
          : null
    return { name: callee.name.text, object }
  }
  if (ts.isCallExpression(callee)) return calleeName(callee)
  return { name: null, object: null }
}

/** Whether the literal is the argument of a call whose text is not user copy (RegExp, logs, test titles). */
function inSkippedCall(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isTaggedTemplateExpression(parent) || ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true
    if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
      const { name, object } = calleeName(parent)
      if (name && SKIPPED_CALLEES.has(name)) return true
      if (object && SKIPPED_OBJECTS.has(object)) return true
      // A test title (not the data of an .each table)
      const isTitle = parent.arguments?.[0] === node && (ts.isCallExpression(parent.expression) || (name !== null && TITLED_CALLEES.has(name) && name !== 'each'))
      return Boolean(isTitle && (name === null || TITLED_CALLEES.has(name) || (object !== null && TITLED_CALLEES.has(object))))
    }
  }
  return false
}

export interface SpacingEdit {
  /** Offsets in the source text of the plain space to replace. */
  start: number
  end: number
  replacement: string
  /** Line (1-based) and the text around, for reports. */
  line: number
  excerpt: string
}

/** Every plain space before ":", ";", "?" or "!" in the French text of a source file. */
export function frenchSpacingEdits(source: string, fileName: string, options: { literal?: boolean } = {}): SpacingEdit[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind)
  const edits: SpacingEdit[] = []
  const nbspInString = options.literal ? ' ' : '\\u00a0'

  const scan = (start: number, raw: string, replacement: string, whole: string) => {
    // English never puts a space before these signs: any such space is French typography (or code, left alone)
    if (CODE_LIKE.test(whole)) return
    for (const match of raw.matchAll(PLAIN_SPACE_BEFORE)) {
      const at = start + match.index
      const { line } = file.getLineAndCharacterOfPosition(at)
      edits.push({ start: at, end: at + 1, replacement, line: line + 1, excerpt: raw.slice(Math.max(0, match.index - 30), match.index + 10) })
    }
  }

  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!inSkippedCall(node)) {
        const inJsxAttribute = ts.isJsxAttribute(node.parent)
        const text = source.slice(node.getStart(file) + 1, node.getEnd() - 1)
        // JSX attribute strings decode no backslash escape: the character itself
        scan(node.getStart(file) + 1, text, inJsxAttribute ? ' ' : nbspInString, text)
      }
    } else if (ts.isTemplateExpression(node)) {
      if (!inSkippedCall(node)) {
        const parts = [node.head, ...node.templateSpans.map((s) => s.literal)]
        const whole = parts.map((p) => p.text).join(' ')
        for (const part of parts) {
          // head: `...${ ; middle: }...${ ; tail: }...`
          const start = part.getStart(file) + 1
          const end = part.getEnd() - (ts.isTemplateTail(part) ? 1 : 2)
          scan(start, source.slice(start, end), nbspInString, whole)
        }
      }
      // Templates nested in the expressions (`${a ? ` : ${b}` : ''}`)
      for (const span of node.templateSpans) visit(span.expression)
      return
    } else if (ts.isJsxText(node)) {
      const text = source.slice(node.getStart(file), node.getEnd())
      scan(node.getStart(file), text, '&nbsp;', text)
    } else if (ts.isRegularExpressionLiteral(node)) {
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return edits
}

/** The source with every edit applied. */
export function applySpacingEdits(source: string, edits: readonly SpacingEdit[]): string {
  let out = source
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end)
  return out
}
