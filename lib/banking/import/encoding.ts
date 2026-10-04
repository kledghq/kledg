/**
 * Text decoding for statement files. French banks still export CSV and OFX
 * in Windows-1252 (a superset of Latin-1 for printable characters), others
 * in UTF-8 with or without a byte order mark.
 */

export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'

export interface DecodedText {
  text: string
  encoding: TextEncodingName
}

/**
 * Decodes a file: a BOM decides; otherwise strict UTF-8 is tried first (a
 * Windows-1252 accent is never valid UTF-8 on its own), then Windows-1252.
 */
export function decodeText(bytes: Uint8Array): DecodedText {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' }
  }
}

/** Binary files (PDF, images, legacy .xls) contain NUL bytes or many control characters. */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 4096)
  let control = 0
  for (let i = 0; i < n; i++) {
    const b = bytes[i]
    if (b === 0) return true
    if (b < 9 || (b > 13 && b < 32)) control++
  }
  return n > 0 && control / n > 0.05
}
