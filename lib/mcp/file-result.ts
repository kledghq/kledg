/**
 * Files returned by MCP tools (exports, Qonto statements, receipts, invoice
 * PDFs): the file travels inside the tool result as an MCP embedded resource
 * (base64 `blob`, `mimeType`), preceded by a JSON text block naming the file.
 *
 * The file is generated or fetched by the same service as the matching
 * download route, after the same checks (company guard, right of the route,
 * company isolation of the object). Kledg never creates a download URL for
 * an assistant: no public link, no token in a URL, nothing that outlives
 * the call. The resource `uri` (kledg://...) only names the file; it cannot
 * be fetched, and the server publishes no MCP resources.
 *
 * A file above MAX_MCP_FILE_BYTES is refused with a French message: base64
 * adds a third, and a larger result would not fit a model's context.
 */

import { ValidationError } from '@/lib/accounting/errors'

/** Largest file sent to an assistant (before base64). */
export const MAX_MCP_FILE_BYTES = 5 * 1024 * 1024

export interface McpFile {
  content: Uint8Array | ArrayBuffer | string
  fileName: string
  contentType: string
}

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ResourceBlock {
  type: 'resource'
  resource: { uri: string; mimeType: string; blob: string; _meta: { fileName: string; size: number } }
}

/** A tool result carrying a file: its description, then the file. */
export type FileToolResult = { content: [TextBlock, ResourceBlock]; isError?: boolean }

const megabytes = (bytes: number) => (bytes / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })

export function fileTooLargeMessage(size: number, max = MAX_MCP_FILE_BYTES): string {
  return `Fichier trop volumineux pour être transmis à l'assistant (${megabytes(size)} Mo, ${megabytes(max)} Mo au plus) : téléchargez-le depuis Kledg.`
}

function bytesOf(content: McpFile['content']): Buffer {
  if (typeof content === 'string') return Buffer.from(content, 'utf8')
  return content instanceof ArrayBuffer ? Buffer.from(new Uint8Array(content)) : Buffer.from(content.buffer, content.byteOffset, content.byteLength)
}

/**
 * The budget of a file read from a provider for an assistant (Qonto,
 * lib/integrations/providers/qonto/files.ts): cut at MAX_MCP_FILE_BYTES, with
 * the message of fileResult, instead of downloading up to the provider limit.
 */
export const MCP_FILE_BUDGET = {
  maxBytes: MAX_MCP_FILE_BYTES,
  tooLarge: (size: number) => new ValidationError(fileTooLargeMessage(size)),
}

/** A file name safe to show and to put in the resource uri (no path, no control character). */
function cleanName(fileName: string): string {
  return fileName.replace(/[\\/\r\n\t\0]+/g, '_').trim().slice(0, 200) || 'fichier'
}

/**
 * The tool result of a file: a JSON text block (file name, MIME type, size
 * and `details`), then the embedded resource. `uriPath` names the file in
 * the kledg:// uri (company and kind, e.g. "companies/<id>/exports").
 * Throws a French ValidationError above `maxBytes`, and for an empty file.
 */
export function fileResult(file: McpFile, uriPath: string, details: Record<string, unknown> = {}, maxBytes = MAX_MCP_FILE_BYTES): FileToolResult {
  const bytes = bytesOf(file.content)
  if (bytes.length === 0) throw new ValidationError('Le fichier est vide.')
  if (bytes.length > maxBytes) throw new ValidationError(fileTooLargeMessage(bytes.length, maxBytes))
  const fileName = cleanName(file.fileName)
  const mimeType = file.contentType || 'application/octet-stream'
  const description = {
    ...details,
    fileName,
    mimeType,
    size: bytes.length,
    message: 'Le fichier est joint à ce résultat (ressource intégrée, en base64). Aucun lien de téléchargement n\'est créé.',
  }
  return {
    content: [
      { type: 'text', text: JSON.stringify(description, null, 2) },
      {
        type: 'resource',
        resource: {
          uri: `kledg://${uriPath.replace(/^\/+|\/+$/g, '')}/${encodeURIComponent(fileName)}`,
          mimeType,
          blob: bytes.toString('base64'),
          _meta: { fileName, size: bytes.length },
        },
      },
    ],
  }
}
