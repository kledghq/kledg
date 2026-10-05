/** Files sent by assistants through MCP: base64 in the JSON call, size capped. */

import { ValidationError } from '@/lib/accounting/errors'
import { assertFileSize } from '@/lib/api/files'

/** The bytes of a base64 file (5 MB at most by default), or a French 400. */
export function decodeBase64File(contentBase64: string, maxBytes = 5 * 1024 * 1024): Uint8Array {
  const text = contentBase64.replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(text)) throw new ValidationError('Contenu du fichier invalide : encodez-le en base64.')
  const bytes = new Uint8Array(Buffer.from(text, 'base64'))
  if (bytes.length === 0) throw new ValidationError('Fichier vide.')
  assertFileSize({ size: bytes.length }, maxBytes)
  return bytes
}

/** MIME type of a receipt from its name (JPEG, PNG or PDF), or a French 400. */
export function receiptTypeOf(fileName: string): string {
  const extension = fileName.toLowerCase().split('.').pop()
  const type = extension === 'pdf' ? 'application/pdf' : extension === 'png' ? 'image/png' : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : null
  if (!type) throw new ValidationError('Type de fichier non autorisé. Seuls JPEG, PNG et PDF sont acceptés.')
  return type
}
