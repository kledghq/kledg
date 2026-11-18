/**
 * The invoice XML embedded in a Factur-X (or ZUGFeRD) PDF.
 *
 * A Factur-X invoice is a PDF/A-3 carrying its CII XML as an embedded file
 * (ISO 19005-3; Factur-X 1.0 specification, section 6): a stream object
 * whose dictionary says /Type /EmbeddedFile, compressed with FlateDecode
 * or stored as is. Embedded file streams are never inside object streams
 * (ISO 32000-1, 7.5.7: a stream cannot be), so they are found by scanning
 * the file for stream dictionaries, without a full PDF parser and without
 * a dependency.
 *
 * Invariants: an encrypted PDF is refused (its streams cannot be read);
 * at most MAX_CANDIDATES embedded streams are decoded, each inflated with a
 * byte budget (MAX_XML_BYTES), so a crafted PDF cannot exhaust memory.
 */

import { inflateSync } from 'node:zlib'
import { MAX_XML_BYTES } from './xml'

const MAX_CANDIDATES = 20
/** How far before "stream" the dictionary of the object is looked for. */
const MAX_DICTIONARY_BYTES = 4096

export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 5 && Buffer.from(bytes.subarray(0, 1024)).toString('latin1').includes('%PDF-')
}

export type EmbeddedXml = { kind: 'ok'; texts: string[] } | { kind: 'encrypted' }

/** The texts of the XML files embedded in the PDF, in file order. */
export function embeddedXmlFiles(bytes: Uint8Array): EmbeddedXml {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const source = buffer.toString('latin1')
  if (/\/Encrypt\s/.test(source.slice(-65536)) || /trailer[\s\S]{0,2000}\/Encrypt\b/.test(source)) return { kind: 'encrypted' }
  const texts: string[] = []
  const keyword = /stream(\r\n|\n|\r)/g
  let match: RegExpExecArray | null
  let candidates = 0
  while ((match = keyword.exec(source)) && candidates < MAX_CANDIDATES) {
    if (source.slice(match.index - 3, match.index) === 'end') continue
    const objectStart = source.lastIndexOf(' obj', match.index)
    if (objectStart < 0 || match.index - objectStart > MAX_DICTIONARY_BYTES) continue
    const dictionary = source.slice(objectStart, match.index)
    if (!/\/Type\s*\/EmbeddedFile\b/.test(dictionary)) continue
    candidates += 1
    const dataStart = match.index + match[0].length
    const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dictionary)
    let dataEnd = length ? dataStart + Number(length[1]) : -1
    if (dataEnd < 0 || dataEnd > source.length || !/^\s*endstream/.test(source.slice(dataEnd, dataEnd + 20))) {
      dataEnd = source.indexOf('endstream', dataStart)
      if (dataEnd < 0) continue
    }
    const data = buffer.subarray(dataStart, dataEnd)
    const filter = /\/Filter\s*(?:\[\s*)?\/(\w+)/.exec(dictionary)?.[1]
    let decoded: Buffer
    try {
      if (filter === 'FlateDecode') decoded = inflateSync(data, { maxOutputLength: MAX_XML_BYTES })
      else if (!filter) decoded = data.subarray(0, MAX_XML_BYTES)
      else continue
    } catch {
      continue
    }
    const text = decoded.toString('utf8').replace(/^\uFEFF/, '').trim()
    if (text.startsWith('<')) texts.push(text)
  }
  return { kind: 'ok', texts }
}
