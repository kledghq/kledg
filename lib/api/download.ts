/**
 * Responses of the export routes: a generated file served as a download,
 * with a safe Content-Disposition (lib/api/files.ts) and nosniff.
 */

import { NextResponse } from 'next/server'
import { contentDisposition } from '@/lib/api/files'

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const PDF_CONTENT_TYPE = 'application/pdf'

export interface GeneratedFile {
  content: Uint8Array | string
  fileName: string
  contentType: string
}

/** The file as an attachment; `headers` adds to the defaults (Cache-Control...). */
export function downloadResponse(file: GeneratedFile, headers: Record<string, string> = {}): NextResponse {
  const body = typeof file.content === 'string' ? file.content : new Uint8Array(file.content)
  return new NextResponse(body, {
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': contentDisposition(file.fileName, 'attachment'),
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  })
}
