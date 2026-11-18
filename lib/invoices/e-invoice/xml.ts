/**
 * Reading of an e-invoice XML document (CII or UBL) into a plain tree.
 *
 * Invariants:
 * - a document with a DOCTYPE is refused before parsing: EN 16931 syntaxes
 *   never declare one, and refusing it removes entity expansion (billion
 *   laughs) and external entities altogether;
 * - namespace prefixes are dropped (rsm:, ram:, cbc:, cac: vary between
 *   issuers), attributes are kept with an "@" prefix, and every value stays
 *   text: amounts, codes and numbers like "0001" are read exactly.
 */

import { XMLParser } from 'fast-xml-parser'

export type XmlNode = Record<string, unknown>

/** Above any real invoice (the samples of EN 16931 are under 100 kB), below what the parser handles comfortably. */
export const MAX_XML_BYTES = 5 * 1024 * 1024

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
})

/** The root element of the document and its name; null when it is not well formed or declares a DOCTYPE. */
export function parseXml(text: string): { name: string; node: XmlNode } | null {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return null
  let tree: unknown
  try {
    tree = parser.parse(text, true)
  } catch {
    return null
  }
  if (!tree || typeof tree !== 'object') return null
  const roots = Object.entries(tree as XmlNode).filter(([key]) => !key.startsWith('?') && !key.startsWith('#'))
  if (roots.length !== 1) return null
  const [name, node] = roots[0]
  return node && typeof node === 'object' ? { name, node: node as XmlNode } : { name, node: {} }
}

/** The values of a child, as an array (an element present once is not an array in the tree). */
export function all(node: unknown, key: string): unknown[] {
  if (!node || typeof node !== 'object') return []
  const value = (node as XmlNode)[key]
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

/** The first child at the end of a path of element names. */
export function child(node: unknown, ...path: string[]): unknown {
  let current: unknown = node
  for (const key of path) {
    current = all(current, key)[0]
    if (current === undefined) return undefined
  }
  return current
}

/** Text of a node (an element with attributes keeps its text under "#text"). */
export function textOf(node: unknown): string | null {
  if (node === undefined || node === null) return null
  if (typeof node === 'string') return node.trim() || null
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (typeof node === 'object') return textOf((node as XmlNode)['#text'])
  return null
}

/** Text at the end of a path. */
export function text(node: unknown, ...path: string[]): string | null {
  return textOf(child(node, ...path))
}

/** An attribute of a node ("schemeID", "currencyID"). */
export function attr(node: unknown, name: string): string | null {
  if (!node || typeof node !== 'object') return null
  const value = (node as XmlNode)[`@${name}`]
  return typeof value === 'string' ? value.trim() || null : null
}

/** A date "yyyy-mm-dd" from "20260131" (CII format 102) or "2026-01-31" (UBL); null when it is not a real day. */
export function isoDay(value: string | null): string | null {
  const match = value ? /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(value.trim()) : null
  if (!match) return null
  const [, y, m, d] = match
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d) ? `${y}-${m}-${d}` : null
}
