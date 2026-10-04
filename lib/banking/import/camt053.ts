/**
 * ISO 20022 camt.053 (BankToCustomerStatement), versions 02 to 13.
 *
 * Structure (ISO 20022 message definition camt.053, and the French CFONB
 * implementation guide "Relevé de compte camt.053"):
 *   Document/BkToCstmrStmt/Stmt*            one statement per account and period
 *     Acct/Id/IBAN, Acct/Ccy
 *     Ntry*                                 booked entries
 *       Amt@Ccy, CdtDbtInd (CRDT|DBIT), Sts (BOOK|PDNG|INFO; <Sts><Cd> from v08)
 *       BookgDt/Dt|DtTm, ValDt/Dt|DtTm, AcctSvcrRef, NtryRef, AddtlNtryInf
 *       NtryDtls/TxDtls*                    one or several transactions (batch)
 *         Amt, Refs/EndToEndId, RmtInf/Ustrd*, RltdPties/Dbtr|Cdtr(/Pty)/Nm
 *
 * A batch entry whose transaction details carry amounts summing exactly to
 * the entry amount is split into one transaction per detail (so each
 * customer payment can be reconciled); otherwise the entry stays whole.
 * Entries that are not booked (PDNG, INFO) are skipped.
 */

import { XMLParser } from 'fast-xml-parser'
import { ValidationError } from '@/lib/accounting/errors'
import { parseAmountCents } from './amount'
import { parseCalendarDate } from './date'
import type { ParsedTransaction, RowError, StatementAccount } from './types'
import { plural, pluralWord } from '@/lib/utils/plural'

type Node = Record<string, unknown>

const ARRAYS = new Set(['Stmt', 'Ntry', 'NtryDtls', 'TxDtls', 'Ustrd', 'AddtlNtryInf', 'AddtlTxInf'])

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  // Keep every value as text: references like "0001" and amounts stay exact
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  isArray: (name) => ARRAYS.has(name),
})

function obj(value: unknown): Node | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Node) : undefined
}

function arr(value: unknown): Node[] {
  if (Array.isArray(value)) return value.map(obj).filter((v): v is Node => !!v)
  const o = obj(value)
  return o ? [o] : []
}

/** Text of a leaf, whether the parser gave a string or an object with attributes. */
function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'number') return String(value)
  const o = obj(value)
  if (o && typeof o['#text'] === 'string') return (o['#text'] as string).trim() || undefined
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(' ') || undefined
  return undefined
}

function path(node: unknown, ...keys: string[]): unknown {
  let current: unknown = node
  for (const key of keys) {
    const o = obj(Array.isArray(current) ? current[0] : current)
    if (!o) return undefined
    current = o[key]
  }
  return current
}

function dateOf(node: unknown): string | null {
  const raw = text(path(node, 'Dt')) ?? text(path(node, 'DtTm'))
  return raw ? parseCalendarDate(raw, 'yyyy-mm-dd') : null
}

function statusOf(entry: Node): string {
  const sts = entry.Sts
  return (text(path(sts, 'Cd')) ?? text(sts) ?? 'BOOK').toUpperCase()
}

/** Party name: v02-v07 Dbtr/Nm, v08+ Dbtr/Pty/Nm. */
function partyName(details: Node | undefined, role: 'Dbtr' | 'Cdtr'): string | undefined {
  const party = path(details, 'RltdPties', role)
  return text(path(party, 'Nm')) ?? text(path(party, 'Pty', 'Nm'))
}

function signed(amount: unknown, indicator: unknown): number | null {
  const raw = text(amount)
  if (!raw) return null
  const cents = parseAmountCents(raw, '.')
  if (cents === null || cents < 0) return null
  const ind = text(indicator)
  if (ind === 'DBIT') return -cents
  if (ind === 'CRDT') return cents
  return null
}

export interface CamtParse {
  transactions: ParsedTransaction[]
  errors: RowError[]
  warnings: string[]
  accounts: StatementAccount[]
}

export function parseCamt053(xml: string): CamtParse {
  if (/<!ENTITY/i.test(xml)) throw new ValidationError('Fichier XML refusé : les entités DOCTYPE ne sont pas acceptées.')
  let doc: Node
  try {
    doc = parser.parse(xml, true) as Node
  } catch {
    throw new ValidationError('Fichier camt.053 invalide : XML mal formé ou tronqué.')
  }
  const root = obj(path(doc, 'Document', 'BkToCstmrStmt'))
  if (!root) throw new ValidationError('Fichier XML non reconnu : un relevé camt.053 (BkToCstmrStmt) est attendu.')

  const transactions: ParsedTransaction[] = []
  const errors: RowError[] = []
  const warnings: string[] = []
  const accounts: StatementAccount[] = []
  let index = 0
  let skipped = 0

  for (const stmt of arr(root.Stmt)) {
    const iban = text(path(stmt, 'Acct', 'Id', 'IBAN'))?.replace(/\s/g, '').toUpperCase()
    const otherId = text(path(stmt, 'Acct', 'Id', 'Othr', 'Id'))
    const currency = text(path(stmt, 'Acct', 'Ccy'))
    accounts.push({ iban, accountId: otherId, currency })

    for (const entry of arr(stmt.Ntry)) {
      index++
      if (statusOf(entry) !== 'BOOK') {
        skipped++
        continue
      }
      const amountCents = signed(entry.Amt, entry.CdtDbtInd)
      const bookingDate = dateOf(entry.BookgDt) ?? dateOf(entry.ValDt)
      if (amountCents === null) {
        errors.push({ line: index, message: `Écriture ${index} : montant ou sens (CdtDbtInd) illisible.` })
        continue
      }
      if (!bookingDate) {
        errors.push({ line: index, message: `Écriture ${index} : date de comptabilisation (BookgDt) illisible.` })
        continue
      }
      const valueDate = dateOf(entry.ValDt) ?? undefined
      const entryCurrency = obj(entry.Amt)?.['@Ccy'] as string | undefined
      const entryRef = text(entry.AcctSvcrRef) ?? text(entry.NtryRef)
      const entryInfo = text(entry.AddtlNtryInf)
      const details = arr(entry.NtryDtls).flatMap((d) => arr(d.TxDtls))

      const describe = (tx: Node | undefined, cents: number) => {
        const counterparty = cents < 0 ? partyName(tx, 'Cdtr') : partyName(tx, 'Dbtr')
        const remittance = text(path(tx, 'RmtInf', 'Ustrd')) ?? text(path(tx, 'RmtInf', 'Strd', 'CdtrRefInf', 'Ref'))
        const endToEnd = text(path(tx, 'Refs', 'EndToEndId'))
        return {
          counterparty,
          remittance,
          reference: endToEnd && endToEnd !== 'NOTPROVIDED' ? endToEnd : undefined,
          txRef: text(path(tx, 'Refs', 'AcctSvcrRef')) ?? text(path(tx, 'Refs', 'TxId')),
          info: text(tx?.AddtlTxInf),
        }
      }

      // Batch: split when every detail has an amount and they add up to the entry
      const detailAmounts = details.map((tx) => signed(path(tx, 'Amt') ?? path(tx, 'AmtDtls', 'TxAmt', 'Amt'), tx.CdtDbtInd ?? entry.CdtDbtInd))
      const splittable =
        details.length > 1 && detailAmounts.every((a) => a !== null) && detailAmounts.reduce((s: number, a) => s + a!, 0) === amountCents

      if (splittable) {
        details.forEach((tx, i) => {
          const cents = detailAmounts[i]!
          const d = describe(tx, cents)
          transactions.push({
            bookingDate,
            valueDate,
            amountCents: cents,
            currency: entryCurrency ?? currency,
            label: [d.counterparty, d.remittance ?? d.info].filter(Boolean).join(' ') || entryInfo || '(sans libellé)',
            reference: d.reference,
            bankReference: d.txRef ?? (entryRef ? `${entryRef}/${i + 1}` : undefined),
            counterparty: d.counterparty,
            account: iban ?? otherId,
            line: index,
          })
        })
        continue
      }

      const d = describe(details.length === 1 ? details[0] : undefined, amountCents)
      const batch = details.length > 1 ? `(lot de ${details.length} opérations)` : undefined
      transactions.push({
        bookingDate,
        valueDate,
        amountCents,
        currency: entryCurrency ?? currency,
        label: [entryInfo ?? d.counterparty, d.remittance && d.remittance !== entryInfo ? d.remittance : undefined, batch].filter(Boolean).join(' ') || '(sans libellé)',
        reference: d.reference,
        bankReference: entryRef ?? d.txRef,
        counterparty: d.counterparty,
        account: iban ?? otherId,
        line: index,
      })
    }
  }

  if (index === 0 && accounts.length === 0) throw new ValidationError('Relevé camt.053 vide : aucun relevé (Stmt) trouvé.')
  if (skipped > 0) warnings.push(`${plural(skipped, 'écriture non comptabilisée', 'écritures non comptabilisées')} (statut autre que BOOK) ${pluralWord(skipped, 'ignorée', 'ignorées')}.`)
  return { transactions, errors, warnings, accounts }
}
