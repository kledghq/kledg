/**
 * OFX and QFX statements: OFX 1.x (SGML, leaf elements are not closed) and
 * OFX 2.x (XML). Both are read by the same tolerant tokenizer: an element
 * followed by text is a leaf, whether or not its closing tag follows.
 *
 * Spec: Open Financial Exchange 2.2, section 11.4 (STMTRS, BANKTRANLIST,
 * STMTTRN) and 3.2.8 (dates). https://www.financialdataexchange.org/ (OFX
 * specifications). Pending transactions (OFX 2.x BANKTRANLISTP) are not
 * booked and are skipped.
 */

import { ValidationError } from '@/lib/accounting/errors'
import { parseAmountCents } from './amount'
import { parseCalendarDate } from './date'
import type { ParsedTransaction, RowError, StatementAccount } from './types'
import { plural, pluralWord } from '@/lib/utils/plural'

interface OfxNode {
  name: string
  text?: string
  children: OfxNode[]
}

/** A numeric character reference, or the literal text when it is out of the Unicode range. */
function fromCodePointSafe(literal: string, code: number): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return literal
  try {
    return String.fromCodePoint(code)
  } catch {
    return literal
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (literal, h) => fromCodePointSafe(literal, parseInt(h, 16)))
    .replace(/&#(\d+);/g, (literal, d) => fromCodePointSafe(literal, Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/**
 * Bounds of the tokenizer (KLEDG-SEC-002). A real statement nests about ten
 * levels deep (OFX > BANKMSGSRSV1 > STMTTRNRS > STMTRS > BANKTRANLIST >
 * STMTTRN > PAYEE...), has short tags and leaf values of a few hundred
 * characters at most. The caps leave a wide margin while keeping the tree
 * walk (recursive all/first) far from the stack limit and every token small.
 */
export const OFX_MAX_DEPTH = 64
export const OFX_MAX_TAG_LENGTH = 1024
export const OFX_MAX_TEXT_LENGTH = 64 * 1024

const OFX_TOO_DEEP = `Fichier OFX invalide : imbrication de plus de ${OFX_MAX_DEPTH} niveaux.`
const OFX_TAG_TOO_LONG = 'Fichier OFX invalide : une balise dépasse la taille maximale.'
const OFX_TEXT_TOO_LONG = 'Fichier OFX invalide : une valeur dépasse la taille maximale.'

/**
 * Builds the element tree of an OFX body (SGML or XML).
 *
 * A hand-written scanner rather than a regex: each character is read a
 * bounded number of times (indexOf from the current position only), so the
 * time is linear in the size of the file whatever its content. The former
 * /<([^>]*)>([^<]*)/g rescanned to the end of the input from every "<" of a
 * run without ">" (quadratic).
 */
function parseOfxTree(text: string): OfxNode {
  const start = text.search(/<OFX>/i)
  if (start < 0) throw new ValidationError('Fichier OFX invalide : balise <OFX> introuvable.')
  const body = text.slice(start)
  const root: OfxNode = { name: '#root', children: [] }
  const stack: OfxNode[] = [root]
  let open = body.indexOf('<')
  while (open >= 0) {
    const close = body.indexOf('>', open + 1)
    // No ">" after this "<": the rest is text outside any tag
    if (close < 0) break
    if (close - open - 1 > OFX_MAX_TAG_LENGTH) throw new ValidationError(OFX_TAG_TOO_LONG)
    const next = body.indexOf('<', close + 1)
    const textEnd = next < 0 ? body.length : next
    // Like the former [^>]*, a tag may contain "<": it ends at the first ">"
    const raw = body.slice(open + 1, close).trim()
    open = next
    if (!raw || raw.startsWith('?') || raw.startsWith('!')) continue
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim().toUpperCase()
      // Close up to the matching element (tolerates unclosed SGML leaves)
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) {
          stack.length = i
          break
        }
      }
      continue
    }
    const selfClosing = raw.endsWith('/')
    const name = raw.replace(/\/$/, '').split(/\s/)[0].toUpperCase()
    const node: OfxNode = { name, children: [] }
    stack[stack.length - 1].children.push(node)
    if (selfClosing) continue
    if (textEnd - close - 1 > OFX_MAX_TEXT_LENGTH) {
      // Whitespace between tags may be long in a pretty-printed file; only a long value is refused
      if (body.slice(close + 1, textEnd).trim().length > OFX_MAX_TEXT_LENGTH) throw new ValidationError(OFX_TEXT_TOO_LONG)
    }
    const value = body.slice(close + 1, textEnd).trim()
    if (value) {
      node.text = decodeEntities(value)
      // An XML leaf is closed right after its text; the closing tag is then ignored above.
    } else {
      // The root is not counted: stack.length - 1 is the depth of the new element
      if (stack.length > OFX_MAX_DEPTH) throw new ValidationError(OFX_TOO_DEEP)
      stack.push(node)
    }
  }
  return root
}

function all(node: OfxNode, name: string, out: OfxNode[] = []): OfxNode[] {
  for (const child of node.children) {
    if (child.name === name) out.push(child)
    else all(child, name, out)
  }
  return out
}

function first(node: OfxNode | undefined, name: string): OfxNode | undefined {
  if (!node) return undefined
  for (const child of node.children) {
    if (child.name === name) return child
    const found = first(child, name)
    if (found) return found
  }
  return undefined
}

const value = (node: OfxNode | undefined, name: string): string | undefined => first(node, name)?.text?.trim() || undefined

export interface OfxParse {
  transactions: ParsedTransaction[]
  errors: RowError[]
  warnings: string[]
  accounts: StatementAccount[]
}

export function parseOfx(text: string): OfxParse {
  const root = parseOfxTree(text)
  const statements = [...all(root, 'STMTRS'), ...all(root, 'CCSTMTRS')]
  if (statements.length === 0) throw new ValidationError('Fichier OFX sans relevé de compte (STMTRS).')

  const transactions: ParsedTransaction[] = []
  const errors: RowError[] = []
  const warnings: string[] = []
  const accounts: StatementAccount[] = []
  let index = 0
  let pending = 0

  for (const statement of statements) {
    const currency = value(statement, 'CURDEF')
    const accountNode = first(statement, 'BANKACCTFROM') ?? first(statement, 'CCACCTFROM')
    const accountId = value(accountNode, 'ACCTID')
    const account: StatementAccount = { accountId, currency }
    accounts.push(account)

    pending += all(statement, 'BANKTRANLISTP').reduce((n, list) => n + all(list, 'STMTTRNP').length, 0)
    const list = first(statement, 'BANKTRANLIST')
    if (!list) continue
    for (const trn of all(list, 'STMTTRN')) {
      index++
      const posted = value(trn, 'DTPOSTED')
      const bookingDate = parseCalendarDate(posted ?? '', 'yyyymmdd')
      const rawAmount = value(trn, 'TRNAMT')
      // Some French banks write OFX amounts with a decimal comma
      const amountCents = rawAmount ? parseAmountCents(rawAmount, rawAmount.includes(',') && !rawAmount.includes('.') ? ',' : '.') : null
      if (!bookingDate) {
        errors.push({ line: index, message: `Opération ${index} : date DTPOSTED « ${posted ?? ''} » illisible.` })
        continue
      }
      if (amountCents === null) {
        errors.push({ line: index, message: `Opération ${index} : montant TRNAMT « ${rawAmount ?? ''} » illisible.` })
        continue
      }
      if (amountCents === 0) continue
      const payee = first(trn, 'PAYEE')
      const name = value(trn, 'NAME') ?? value(payee, 'NAME')
      const memo = value(trn, 'MEMO')
      const label = [name, memo && name && name.includes(memo) ? undefined : memo].filter(Boolean).join(' ').replace(/\s+/g, ' ')
      const valueDate = parseCalendarDate(value(trn, 'DTAVAIL') ?? '', 'yyyymmdd') ?? undefined
      const fitid = value(trn, 'FITID')
      transactions.push({
        bookingDate,
        valueDate,
        amountCents,
        currency: value(trn, 'CURRENCY') ? value(first(trn, 'CURRENCY'), 'CURSYM') : currency,
        label: label || value(trn, 'TRNTYPE') || '(sans libellé)',
        reference: value(trn, 'CHECKNUM') ?? value(trn, 'REFNUM'),
        bankReference: fitid,
        counterparty: name,
        account: accountId,
        line: index,
      })
    }
  }
  if (pending > 0) warnings.push(`${plural(pending, 'opération')} en attente ${pluralWord(pending, 'ignorée', 'ignorées')}.`)
  return { transactions, errors, warnings, accounts }
}
