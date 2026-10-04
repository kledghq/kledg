/**
 * XML / SGML statement parsers: camt.053 and OFX.
 *
 * XXE, external entities, billion laughs, deep nesting and huge attributes
 * must be refused quickly and with bounded memory, never fetched, never
 * expanded, and never crash the process with a raw RangeError/stack overflow.
 *
 * camt.053 (fast-xml-parser) is already hardened: any <!ENTITY declaration is
 * refused, and the parser does not resolve external entities. Those are
 * regression tests. The OFX custom tokenizer is linear and bounds nesting
 * depth and token sizes (KLEDG-SEC-002, fixed), and its RangeError-on-bad-entity
 * crash is fixed too.
 */

import { describe, expect, it } from 'vitest'
import { parseCamt053 } from '@/lib/banking/import/camt053'
import { OFX_MAX_DEPTH, OFX_MAX_TAG_LENGTH, OFX_MAX_TEXT_LENGTH, parseOfx } from '@/lib/banking/import/ofx'
import { NEW_FINDINGS } from './findings'

/** Runs `fn` and returns how long it took; fails if it throws something other than a ValidationError. */
function timeBounded(fn: () => void): number {
  const start = performance.now()
  try {
    fn()
  } catch (error) {
    // A ValidationError (refusal) is the desired outcome; anything else
    // (RangeError, stack overflow, TypeError) is a crash we must not have.
    expect((error as Error).name, (error as Error).message).toBe('ValidationError')
  }
  return performance.now() - start
}

const CAMT_SKELETON = (inner: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">${inner}</Document>`

describe('camt.053: XXE and entity attacks are refused', () => {
  it('refuses an external entity pointing at a local file (XXE)', () => {
    const xxe =
      '<?xml version="1.0"?>\n<!DOCTYPE Document [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>\n' +
      '<Document><BkToCstmrStmt><Stmt><Acct><Id><IBAN>&xxe;</IBAN></Id></Acct></Stmt></BkToCstmrStmt></Document>'
    expect(() => parseCamt053(xxe)).toThrowError(/entit/i)
  })

  it('refuses an external entity pointing at an internal URL (SSRF via XXE)', () => {
    const xxe =
      '<!DOCTYPE Document [ <!ENTITY x SYSTEM "http://169.254.169.254/latest/meta-data/"> ]>\n' +
      '<Document>&x;</Document>'
    expect(() => parseCamt053(xxe)).toThrowError(/entit/i)
  })

  it('refuses a billion-laughs entity-expansion bomb quickly', () => {
    const bomb =
      '<!DOCTYPE lolz [\n' +
      '<!ENTITY lol "lol">\n' +
      '<!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">\n' +
      '<!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">\n' +
      '<!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">\n' +
      ']>\n<Document><BkToCstmrStmt>&lol4;</BkToCstmrStmt></Document>'
    const ms = timeBounded(() => parseCamt053(bomb))
    expect(ms).toBeLessThan(2000)
  })

  it('does not hang or crash on pathologically deep nesting (bounded time)', () => {
    const depth = 20_000
    const deep = CAMT_SKELETON('<a>'.repeat(depth) + '<b/>' + '</a>'.repeat(depth))
    const ms = timeBounded(() => parseCamt053(deep))
    expect(ms).toBeLessThan(3000)
  })

  it('does not hang or crash on a single huge attribute (bounded time)', () => {
    const huge = CAMT_SKELETON(`<BkToCstmrStmt x="${'A'.repeat(5_000_000)}"/>`)
    const ms = timeBounded(() => parseCamt053(huge))
    expect(ms).toBeLessThan(3000)
  })

  it('parses a minimal valid statement without any entity', () => {
    const ok = CAMT_SKELETON(
      '<BkToCstmrStmt><Stmt><Acct><Id><IBAN>FR7630006000011234567890189</IBAN></Id></Acct>' +
        '<Ntry><Amt Ccy="EUR">10.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>' +
        '<BookgDt><Dt>2026-03-01</Dt></BookgDt></Ntry></Stmt></BkToCstmrStmt>',
    )
    expect(() => parseCamt053(ok)).not.toThrow()
  })
})

describe('OFX: numeric character references never crash the parser', () => {
  // KLEDG-SEC-002 (partial): decodeEntities used String.fromCodePoint without a
  // range check, so an out-of-range reference threw an unhandled RangeError.
  it.each(['&#x110000;', '&#99999999999;', '&#xFFFFFFFF;'])(
    'leaves an out-of-range reference (%s) as text instead of throwing',
    (ref) => {
      const ofx =
        'OFXHEADER:100\nDATA:OFXSGML\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>' +
        `<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260301</DTPOSTED><TRNAMT>-10.00</TRNAMT>` +
        `<NAME>${ref}</NAME></STMTTRN>` +
        '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>'
      expect(() => parseOfx(ofx)).not.toThrow()
    },
  )
})

describe('OFX: tokenizer ReDoS and unbounded nesting (KLEDG-SEC-002, fixed)', () => {
  const HEADER = 'OFXHEADER:100\nDATA:OFXSGML\n\n'
  const BUDGET_MS = 1000

  /** Runs parseOfx, accepting a ValidationError refusal only, and returns the elapsed time. */
  const timed = (input: string) => timeBounded(() => parseOfx(input))

  it(`[KLEDG-SEC-002] fixed: ${NEW_FINDINGS['KLEDG-SEC-002'].title}`, () => {
    // A long run of "<" with no ">" (quadratic under the former /<([^>]*)>([^<]*)/g)
    // and a very deep SGML nesting both resolve within a small time budget,
    // without blocking the event loop or overflowing the stack.
    const unclosed = HEADER + '<OFX>' + '<'.repeat(5_000_000)
    const deep = HEADER + '<OFX>' + '<A>'.repeat(200_000)
    for (const input of [unclosed, deep]) expect(timed(input)).toBeLessThan(BUDGET_MS)
  })

  it('refuses nesting deeper than the cap with a French ValidationError', () => {
    const deep = HEADER + '<OFX>' + '<A>'.repeat(OFX_MAX_DEPTH + 1)
    expect(() => parseOfx(deep)).toThrowError(/imbrication/)
  })

  it('refuses an oversized tag and an oversized value', () => {
    expect(() => parseOfx(HEADER + '<OFX><' + 'A'.repeat(OFX_MAX_TAG_LENGTH + 1) + '>x')).toThrowError(/balise/)
    expect(() => parseOfx(HEADER + '<OFX><NAME>' + 'x'.repeat(OFX_MAX_TEXT_LENGTH + 1) + '</NAME>')).toThrowError(/valeur/)
  })

  it('accepts long whitespace between tags (pretty-printed XML)', () => {
    const ofx =
      HEADER + '<OFX>' + ' '.repeat(OFX_MAX_TEXT_LENGTH * 2) +
      '<BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT</TRNTYPE>' +
      '<DTPOSTED>20260301</DTPOSTED><TRNAMT>-10.00</TRNAMT><NAME>X</NAME></STMTTRN>' +
      '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>'
    expect(parseOfx(ofx).transactions).toHaveLength(1)
  })

  it('stays within the time budget on a seeded pathological corpus (fuzz)', () => {
    // Deterministic generator of adversarial token shapes: runs of "<", ">"
    // and "&", unterminated entities, tags with spaces, deep and wide trees,
    // each scaled to about 2 MB so a quadratic path would blow the budget.
    let seed = 0x5ec002
    const random = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
      return seed / 2 ** 32
    }
    const SHAPES = ['<', '>', '<A>', '</A>', '<A/>', '&#x', '&amp;', '&#99999999;', ' ', 'x', '<!--', '<?', '<A B="', '\n']
    const SIZE = 2 * 1024 * 1024
    for (let i = 0; i < 12; i++) {
      const unit = Array.from({ length: 1 + Math.floor(random() * 6) }, () => SHAPES[Math.floor(random() * SHAPES.length)]).join('')
      const input = HEADER + '<OFX>' + unit.repeat(Math.ceil(SIZE / unit.length))
      expect(timed(input), JSON.stringify(unit)).toBeLessThan(BUDGET_MS)
    }
  })
})
