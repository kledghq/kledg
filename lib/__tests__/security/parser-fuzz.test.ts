/**
 * Seeded parser fuzzing: random and mutated CSV / OFX / camt.053 / xlsx inputs
 * must never hang or crash the process. A parser may return a result or throw
 * (a ValidationError refusal is the norm), but each call must finish within a
 * per-input time budget and leave the process alive.
 *
 * Deterministic (seeded) so a failure reproduces. The corpus is small by
 * default to stay inside the CI budget; set KLEDG_FUZZ=1 for the large corpus.
 * Inputs are capped in size so even a quadratic path stays well under budget.
 */

import { describe, expect, it } from 'vitest'
import { parseStatementFile } from '@/lib/banking/import/parse'
import { parseOfx } from '@/lib/banking/import/ofx'
import { parseCamt053 } from '@/lib/banking/import/camt053'

const FUZZ = process.env.KLEDG_FUZZ === '1' || process.env.KLEDG_FUZZ === 'true'
const ITERATIONS = FUZZ ? 2000 : 120
const MAX_INPUT = 8 * 1024 // keep worst-case quadratic well under the budget
const BUDGET_MS = 1000

/** mulberry32: a tiny deterministic PRNG so failures reproduce from the seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEEDS = [
  'Date;Libelle;Montant\n15/03/2025;VIR DUPONT;1200,00\n',
  'OFXHEADER:100\nDATA:OFXSGML\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST><STMTTRN><TRNAMT>-10.00</TRNAMT><NAME>X</NAME></STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>',
  '<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><Stmt><Acct><Id><IBAN>FR7630006000011234567890189</IBAN></Id></Acct><Ntry><Amt Ccy="EUR">10.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2025-03-01</Dt></BookgDt></Ntry></Stmt></BkToCstmrStmt></Document>',
  'col1,col2,col3\n"a","b","c"\n1,2,3\n',
  '<<<<>>>><>&#x110000;&amp;&lt;\x00\x01;;;,,,\t\t\n\n',
]

const MUTATORS: Array<(s: string, r: () => number) => string> = [
  (s, r) => s.slice(0, Math.floor(r() * s.length)), // truncate
  (s, r) => s + s.slice(0, Math.floor(r() * 2000)), // duplicate a chunk
  (s, r) => {
    const i = Math.floor(r() * s.length)
    return s.slice(0, i) + String.fromCharCode(Math.floor(r() * 256)) + s.slice(i)
  }, // insert a random byte
  (s, r) => s.replace(/[aeiou]/gi, () => '<&;>\t'[Math.floor(r() * 5)]!), // inject metachars
  (s, r) => '<'.repeat(Math.floor(r() * 400)) + s, // run of open tags (OFX/XML stress)
]

function mutate(base: string, r: () => number): string {
  let out = base
  const rounds = 1 + Math.floor(r() * 3)
  for (let i = 0; i < rounds; i++) out = MUTATORS[Math.floor(r() * MUTATORS.length)]!(out, r)
  return out.slice(0, MAX_INPUT)
}

/**
 * Runs `fn` (sync or async) and asserts it finishes (resolve or reject) within
 * the budget. The rejected promise is awaited and swallowed so no unhandled
 * rejection escapes: a thrown/rejected error is acceptable (the process stayed
 * alive); the targeted tests assert the specific refusal type.
 */
async function bounded(label: string, fn: () => unknown): Promise<void> {
  const start = performance.now()
  try {
    await fn()
  } catch {
    /* liveness only */
  }
  const elapsed = performance.now() - start
  expect(elapsed, `${label} exceeded ${BUDGET_MS}ms`).toBeLessThan(BUDGET_MS)
}

describe('parser fuzzing never hangs or crashes', () => {
  it(`survives ${ITERATIONS} mutated inputs across CSV/OFX/camt/xlsx detection`, async () => {
    const r = rng(0xc0ffee)
    for (let i = 0; i < ITERATIONS; i++) {
      const base = SEEDS[Math.floor(r() * SEEDS.length)]!
      const input = mutate(base, r)
      await bounded(`parseStatementFile#${i}`, () => parseStatementFile(new TextEncoder().encode(input)))
    }
  })

  it(`survives ${ITERATIONS} mutated OFX inputs`, async () => {
    const r = rng(0x0f)
    for (let i = 0; i < ITERATIONS; i++) {
      await bounded(`parseOfx#${i}`, () => parseOfx(mutate(SEEDS[1]!, r)))
    }
  })

  it(`survives ${ITERATIONS} mutated camt.053 inputs`, async () => {
    const r = rng(0x53)
    for (let i = 0; i < ITERATIONS; i++) {
      await bounded(`parseCamt053#${i}`, () => parseCamt053(mutate(SEEDS[2]!, r)))
    }
  })
})
