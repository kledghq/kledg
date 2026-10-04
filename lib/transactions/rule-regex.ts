/**
 * Regular expressions of assignment rule conditions (operator "regex"),
 * matched in time linear in the length of the transaction text.
 *
 * Invariant: a pattern written by a user never runs on the backtracking
 * engine of JavaScript (`new RegExp`), where "(a+)+$" or ".*.*.*x" against a
 * crafted label blocks the event loop (ReDoS, KLEDG-SEC-001). Patterns are
 * parsed here into a subset of the JavaScript syntax and run on a Thompson
 * NFA (Pike VM): every position of the text is read once against a set of
 * at most `MAX_PROGRAM_SIZE` states, so a test costs at most
 * text length x program size steps, whatever the pattern.
 *
 * Supported, with the semantics of `new RegExp(pattern, 'i').test(text)`:
 * literals, `.`, classes `[a-z]`, `[^...]`, `\d \D \w \W \s \S`, anchors
 * `^ $ \b \B`, groups `(...)`, `(?:...)`, `(?<name>...)`, alternation `|`,
 * quantifiers `* + ? {n} {n,} {n,m}` (lazy forms accepted), escapes
 * `\t \n \r \f \v \0 \xHH \uHHHH` and escaped punctuation. Refused with a
 * French message: backreferences, lookahead and lookbehind, unicode
 * property escapes, unknown letter escapes, patterns longer than
 * `RULE_PATTERN_MAX_LENGTH` or compiling to more than `MAX_PROGRAM_SIZE`
 * states (large counted repetitions).
 *
 * Pure module without imports: the rules dialog may validate a pattern on
 * the client with the same code as the server.
 */

/** Longest pattern accepted for a regex condition. */
export const RULE_PATTERN_MAX_LENGTH = 300
/** Largest compiled program (NFA states); bounds the cost of one step. */
export const MAX_PROGRAM_SIZE = 2000
/** Deepest group nesting accepted. */
const MAX_GROUP_DEPTH = 32
/** Largest bound of a counted repetition {n,m}. */
const MAX_REPEAT = 1000

/** Default steps one call of the rule matcher may spend on all its regex conditions. */
export const DEFAULT_REGEX_STEP_BUDGET = 500_000

export type RulePatternResult = { ok: true; pattern: CompiledRulePattern } | { ok: false; message: string }

/** Remaining steps shared by the regex tests of one run. */
export interface RegexBudget {
  remaining: number
}

type CharTest = (code: number) => boolean
type AssertKind = '^' | '$' | 'b' | 'B'

type Node =
  | { type: 'char'; test: CharTest; negate?: boolean }
  | { type: 'assert'; kind: AssertKind }
  | { type: 'concat'; items: Node[] }
  | { type: 'alt'; options: Node[] }
  | { type: 'repeat'; node: Node; min: number; max: number }

type Instruction =
  | { op: 'char'; test: CharTest }
  | { op: 'split'; x: number; y: number }
  | { op: 'jmp'; x: number }
  | { op: 'assert'; kind: AssertKind }
  | { op: 'match' }

class PatternError extends Error {}

class BudgetExceeded extends Error {}

// Character sets, with the ASCII meaning of the non-unicode flag set

const isDigit: CharTest = (c) => c >= 48 && c <= 57
const isWord: CharTest = (c) => isDigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
const isSpace: CharTest = (c) =>
  (c >= 9 && c <= 13) ||
  c === 32 ||
  c === 0xa0 ||
  c === 0x1680 ||
  (c >= 0x2000 && c <= 0x200a) ||
  c === 0x2028 ||
  c === 0x2029 ||
  c === 0x202f ||
  c === 0x205f ||
  c === 0x3000 ||
  c === 0xfeff
const isLineTerminator: CharTest = (c) => c === 10 || c === 13 || c === 0x2028 || c === 0x2029
const not =
  (test: CharTest): CharTest =>
  (c) =>
    !test(c)

function lowerCode(c: number): number {
  const lower = String.fromCharCode(c).toLowerCase()
  return lower.length === 1 ? lower.charCodeAt(0) : c
}

function upperCode(c: number): number {
  const upper = String.fromCharCode(c).toUpperCase()
  return upper.length === 1 ? upper.charCodeAt(0) : c
}

/** Case-insensitive version of a set, like the "i" flag. */
const ignoreCase =
  (test: CharTest): CharTest =>
  (c) =>
    test(c) || test(lowerCode(c)) || test(upperCode(c))

const CLASS_ESCAPES: Record<string, CharTest> = {
  d: isDigit,
  D: not(isDigit),
  w: isWord,
  W: not(isWord),
  s: isSpace,
  S: not(isSpace),
}

const CONTROL_ESCAPES: Record<string, number> = { t: 9, n: 10, v: 11, f: 12, r: 13 }

// Parser: pattern text to syntax tree

class Parser {
  private pos = 0
  private depth = 0

  constructor(private readonly source: string) {}

  parse(): Node {
    const node = this.alternation()
    if (this.pos < this.source.length) {
      // Only an unbalanced ")" stops the top-level alternation early
      throw new PatternError('parenthèse fermante sans parenthèse ouvrante')
    }
    return node
  }

  private peek(offset = 0): string | undefined {
    return this.source[this.pos + offset]
  }

  private alternation(): Node {
    const options = [this.sequence()]
    while (this.peek() === '|') {
      this.pos++
      options.push(this.sequence())
    }
    return options.length === 1 ? options[0] : { type: 'alt', options }
  }

  private sequence(): Node {
    const items: Node[] = []
    while (this.pos < this.source.length && this.peek() !== '|' && this.peek() !== ')') {
      const atom = this.atom()
      items.push(this.quantified(atom))
    }
    return { type: 'concat', items }
  }

  private atom(): Node {
    const ch = this.source[this.pos]
    switch (ch) {
      case '(':
        return this.group()
      case '[':
        return this.characterClass()
      case '.':
        this.pos++
        return { type: 'char', test: not(isLineTerminator) }
      case '^':
        this.pos++
        return { type: 'assert', kind: '^' }
      case '$':
        this.pos++
        return { type: 'assert', kind: '$' }
      case '\\':
        return this.escape()
      case '*':
      case '+':
      case '?':
        throw new PatternError(`« ${ch} » ne suit rien à répéter`)
      case '{':
        if (this.readBraces() !== null) throw new PatternError('« { » ne suit rien à répéter')
        this.pos++
        return literal('{'.charCodeAt(0))
      default:
        this.pos++
        return literal(ch.charCodeAt(0))
    }
  }

  private group(): Node {
    this.pos++ // (
    if (this.peek() === '?') {
      const kind = this.peek(1)
      if (kind === ':') {
        this.pos += 2
      } else if (kind === '=' || kind === '!' || (kind === '<' && (this.peek(2) === '=' || this.peek(2) === '!'))) {
        throw new PatternError('les assertions (?=, ?!, ?<=, ?<!) ne sont pas prises en charge')
      } else if (kind === '<') {
        const close = this.source.indexOf('>', this.pos + 2)
        const name = close < 0 ? '' : this.source.slice(this.pos + 2, close)
        if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new PatternError('nom de groupe invalide')
        this.pos = close + 1
      } else {
        throw new PatternError('groupe « (? » non pris en charge')
      }
    }
    if (++this.depth > MAX_GROUP_DEPTH) throw new PatternError('trop de groupes imbriqués')
    const inner = this.alternation()
    this.depth--
    if (this.peek() !== ')') throw new PatternError('parenthèse non fermée')
    this.pos++
    return inner
  }

  /** Reads "{n}", "{n,}" or "{n,m}" at the current position without consuming it, or null. */
  private readBraces(): { min: number; max: number; length: number } | null {
    const match = /^\{(\d+)(,(\d*))?\}/.exec(this.source.slice(this.pos, this.pos + 16))
    if (!match) return null
    const min = Number(match[1])
    const max = match[2] === undefined ? min : match[3] === '' ? Infinity : Number(match[3])
    return { min, max, length: match[0].length }
  }

  private quantified(node: Node): Node {
    let min: number
    let max: number
    const ch = this.peek()
    if (ch === '*') [min, max] = [0, Infinity]
    else if (ch === '+') [min, max] = [1, Infinity]
    else if (ch === '?') [min, max] = [0, 1]
    else if (ch === '{') {
      const braces = this.readBraces()
      if (!braces) return node // a literal "{" follows, as in JavaScript
      ;({ min, max } = braces)
      this.pos += braces.length - 1
      if (max < min) throw new PatternError('bornes de répétition dans le désordre')
      if (min > MAX_REPEAT || (max !== Infinity && max > MAX_REPEAT)) {
        throw new PatternError(`répétition au-delà de ${MAX_REPEAT}`)
      }
    } else {
      return node
    }
    this.pos++
    if (this.peek() === '?') this.pos++ // lazy: same result for a test
    if (node.type === 'assert') throw new PatternError('une ancre ne peut pas être répétée')
    return { type: 'repeat', node, min, max }
  }

  /** An escape outside a class. */
  private escape(): Node {
    const ch = this.peek(1)
    if (ch === 'b' || ch === 'B') {
      this.pos += 2
      return { type: 'assert', kind: ch }
    }
    const set = this.escapeSet(false)
    return { type: 'char', test: set }
  }

  /**
   * Reads an escape at the current position ("\" included) and returns its
   * set. Inside a class, "\b" is a backspace.
   */
  private escapeSet(inClass: boolean): CharTest {
    const ch = this.peek(1)
    if (ch === undefined) throw new PatternError('« \\ » en fin de motif')
    this.pos += 2
    if (CLASS_ESCAPES[ch]) return CLASS_ESCAPES[ch]
    if (CONTROL_ESCAPES[ch] !== undefined) return codeSet(CONTROL_ESCAPES[ch])
    if (inClass && ch === 'b') return codeSet(8)
    if (ch === '0' && !isDigit(this.source.charCodeAt(this.pos))) return codeSet(0)
    if (ch >= '1' && ch <= '9') throw new PatternError('les références arrière (\\1...) ne sont pas prises en charge')
    if (ch === 'x' || ch === 'u') {
      const length = ch === 'x' ? 2 : 4
      const hex = this.source.slice(this.pos, this.pos + length)
      if (!new RegExp(`^[0-9A-Fa-f]{${length}}$`).test(hex)) throw new PatternError(`séquence « \\${ch} » invalide`)
      this.pos += length
      return codeSet(parseInt(hex, 16))
    }
    if (/[A-Za-z0-9]/.test(ch)) throw new PatternError(`séquence « \\${ch} » non prise en charge`)
    return codeSet(ch.charCodeAt(0))
  }

  private characterClass(): Node {
    this.pos++ // [
    let negate = false
    if (this.peek() === '^') {
      negate = true
      this.pos++
    }
    const members: CharTest[] = []
    for (;;) {
      const ch = this.peek()
      if (ch === undefined) throw new PatternError('crochet non fermé')
      if (ch === ']') {
        this.pos++
        break
      }
      const low = this.classAtom()
      if (this.peek() === '-' && this.peek(1) !== undefined && this.peek(1) !== ']') {
        const save = this.pos
        this.pos++
        const high = this.classAtom()
        if (low.code === null || high.code === null) {
          // [\d-z]: as in JavaScript without the u flag, "-" is a literal
          members.push(low.test, codeSet(45), high.test)
          continue
        }
        if (high.code < low.code) {
          this.pos = save
          throw new PatternError('intervalle de caractères dans le désordre')
        }
        const [from, to] = [low.code, high.code]
        members.push((c) => c >= from && c <= to)
        continue
      }
      members.push(low.test)
    }
    const union: CharTest = (c) => members.some((test) => test(c))
    // Negated after case folding: with "i", [^a] matches neither "a" nor "A"
    return { type: 'char', test: union, negate }
  }

  /** One member of a class: a single code (ranges need one) or a set. */
  private classAtom(): { code: number | null; test: CharTest } {
    const ch = this.source[this.pos]
    if (ch === '\\') {
      const escaped = this.peek(1)
      const test = this.escapeSet(true)
      const isSet = escaped !== undefined && CLASS_ESCAPES[escaped] !== undefined
      return { code: isSet ? null : singleCode(test), test }
    }
    this.pos++
    const code = ch.charCodeAt(0)
    return { code, test: codeSet(code) }
  }
}

const SINGLE_CODE = Symbol('code')
type CodeSet = CharTest & { [SINGLE_CODE]?: number }

function codeSet(code: number): CharTest {
  const test: CodeSet = (c) => c === code
  test[SINGLE_CODE] = code
  return test
}

function singleCode(test: CharTest): number | null {
  return (test as CodeSet)[SINGLE_CODE] ?? null
}

function literal(code: number): Node {
  return { type: 'char', test: codeSet(code) }
}

// Compiler: syntax tree to Pike VM program

function compile(root: Node): Instruction[] {
  const program: Instruction[] = []
  const emit = (instruction: Instruction): number => {
    if (program.length >= MAX_PROGRAM_SIZE) throw new PatternError('motif trop complexe')
    program.push(instruction)
    return program.length - 1
  }
  const visit = (node: Node): void => {
    switch (node.type) {
      case 'char':
        emit({ op: 'char', test: node.negate ? not(ignoreCase(node.test)) : ignoreCase(node.test) })
        return
      case 'assert':
        emit({ op: 'assert', kind: node.kind })
        return
      case 'concat':
        node.items.forEach(visit)
        return
      case 'alt': {
        const jumps: number[] = []
        node.options.forEach((option, index) => {
          if (index === node.options.length - 1) {
            visit(option)
            return
          }
          const split = emit({ op: 'split', x: 0, y: 0 })
          ;(program[split] as { x: number }).x = program.length
          visit(option)
          jumps.push(emit({ op: 'jmp', x: 0 }))
          ;(program[split] as { y: number }).y = program.length
        })
        for (const jump of jumps) (program[jump] as { x: number }).x = program.length
        return
      }
      case 'repeat': {
        for (let i = 0; i < node.min; i++) visit(node.node)
        if (node.max === Infinity) {
          const split = emit({ op: 'split', x: 0, y: 0 })
          ;(program[split] as { x: number }).x = program.length
          visit(node.node)
          emit({ op: 'jmp', x: split })
          ;(program[split] as { y: number }).y = program.length
          return
        }
        const splits: number[] = []
        for (let i = node.min; i < node.max; i++) {
          const split = emit({ op: 'split', x: 0, y: 0 })
          ;(program[split] as { x: number }).x = program.length
          splits.push(split)
          visit(node.node)
        }
        for (const split of splits) (program[split] as { y: number }).y = program.length
        return
      }
    }
  }
  visit(root)
  emit({ op: 'match' })
  return program
}

// Matcher

/** A pattern compiled for linear-time matching. */
export class CompiledRulePattern {
  private readonly marks: Int32Array
  private generation = 0

  constructor(private readonly program: Instruction[]) {
    this.marks = new Int32Array(program.length)
  }

  /**
   * Whether the pattern matches somewhere in `text` (case-insensitive), or
   * null when `budget` ran out first. Each state visit costs one step.
   */
  test(text: string, budget: RegexBudget = { remaining: DEFAULT_REGEX_STEP_BUDGET }): boolean | null {
    try {
      return this.run(text, budget)
    } catch (error) {
      if (error instanceof BudgetExceeded) return null
      throw error
    }
  }

  private run(text: string, budget: RegexBudget): boolean {
    const { program, marks } = this
    const length = text.length
    let matched = false
    const stack: number[] = []

    const holds = (kind: AssertKind, pos: number): boolean => {
      switch (kind) {
        case '^':
          return pos === 0
        case '$':
          return pos === length
        default: {
          const before = pos > 0 && isWord(text.charCodeAt(pos - 1))
          const after = pos < length && isWord(text.charCodeAt(pos))
          return kind === 'b' ? before !== after : before === after
        }
      }
    }

    /** Adds the threads reachable from `start` without reading a character. */
    const add = (list: number[], start: number, pos: number) => {
      stack.push(start)
      while (stack.length > 0) {
        const pc = stack.pop()!
        if (marks[pc] === this.generation) continue
        marks[pc] = this.generation
        if (--budget.remaining < 0) throw new BudgetExceeded()
        const instruction = program[pc]
        switch (instruction.op) {
          case 'jmp':
            stack.push(instruction.x)
            break
          case 'split':
            stack.push(instruction.y, instruction.x)
            break
          case 'assert':
            if (holds(instruction.kind, pos)) stack.push(pc + 1)
            break
          case 'match':
            matched = true
            break
          case 'char':
            list.push(pc)
            break
        }
      }
    }

    this.nextGeneration()
    let current: number[] = []
    add(current, 0, 0)
    for (let pos = 0; !matched && pos < length; pos++) {
      const code = text.charCodeAt(pos)
      this.nextGeneration()
      const next: number[] = []
      for (const pc of current) {
        if (--budget.remaining < 0) throw new BudgetExceeded()
        if ((program[pc] as { test: CharTest }).test(code)) add(next, pc + 1, pos + 1)
        if (matched) return true
      }
      // Unanchored search: a match may also start at the next position
      add(next, 0, pos + 1)
      current = next
    }
    return matched
  }

  private nextGeneration() {
    this.generation++
    if (this.generation === 0x7fffffff) {
      this.marks.fill(0)
      this.generation = 1
    }
  }
}

/** Compiles a rule pattern, or explains in French why it is refused. */
export function compileRulePattern(pattern: string): RulePatternResult {
  if (pattern.length > RULE_PATTERN_MAX_LENGTH) {
    return { ok: false, message: `Expression régulière trop longue (${RULE_PATTERN_MAX_LENGTH} caractères au plus).` }
  }
  try {
    return { ok: true, pattern: new CompiledRulePattern(compile(new Parser(pattern).parse())) }
  } catch (error) {
    if (error instanceof PatternError) return { ok: false, message: `Expression régulière refusée : ${error.message}.` }
    throw error
  }
}
