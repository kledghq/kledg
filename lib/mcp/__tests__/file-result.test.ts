/**
 * Files returned to assistants (lib/mcp/file-result.ts): an embedded
 * resource with the base64 bytes, the MIME type and the file name, after a
 * JSON text block; a French refusal above the size cap and for an empty
 * file; a uri that names the file and is never a download URL. And the query
 * export_report builds for the route schemas (lib/mcp/export-tools.ts).
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())

import { MAX_MCP_FILE_BYTES, fileResult, fileTooLargeMessage } from '@/lib/mcp/file-result'
import { exportQuery } from '@/lib/mcp/export-tools'

describe('fileResult', () => {
  it('returns a JSON description, then the file as an embedded resource', () => {
    const result = fileResult({ content: new Uint8Array([0x25, 0x50, 0x44, 0x46]), fileName: 'Bilan 2025.pdf', contentType: 'application/pdf' }, 'companies/c1/exports/balance_sheet_pdf', { report: 'balance_sheet_pdf' })
    const [text, resource] = result.content
    expect(JSON.parse(text.text)).toMatchObject({ report: 'balance_sheet_pdf', fileName: 'Bilan 2025.pdf', mimeType: 'application/pdf', size: 4 })
    expect(resource).toEqual({
      type: 'resource',
      resource: { uri: 'kledg://companies/c1/exports/balance_sheet_pdf/Bilan%202025.pdf', mimeType: 'application/pdf', blob: 'JVBERg==', _meta: { fileName: 'Bilan 2025.pdf', size: 4 } },
    })
    expect(result.isError).toBeUndefined()
  })

  it('encodes text files in UTF-8 and ArrayBuffers as they are, and cleans the file name', () => {
    const csv = fileResult({ content: 'Compte;Libellé\n', fileName: '../../etc/passwd\r\n.csv', contentType: 'text/csv; charset=utf-8' }, 'companies/c1/exports/x')
    expect(Buffer.from(csv.content[1].resource.blob, 'base64').toString('utf8')).toBe('Compte;Libellé\n')
    expect(csv.content[1].resource._meta.fileName).toBe('.._.._etc_passwd_.csv')
    const buffer = new Uint8Array([1, 2, 3]).buffer
    expect(fileResult({ content: buffer, fileName: 'a.bin', contentType: '' }, 'x').content[1].resource).toMatchObject({ blob: 'AQID', mimeType: 'application/octet-stream' })
  })

  it('refuses a file above the cap and an empty file, in French', () => {
    const big = new Uint8Array(MAX_MCP_FILE_BYTES + 1)
    expect(() => fileResult({ content: big, fileName: 'gros.pdf', contentType: 'application/pdf' }, 'x')).toThrow(fileTooLargeMessage(big.length))
    expect(fileTooLargeMessage(6 * 1024 * 1024)).toBe("Fichier trop volumineux pour être transmis à l'assistant (6 Mo, 5 Mo au plus) : téléchargez-le depuis Kledg.")
    expect(() => fileResult({ content: new Uint8Array(MAX_MCP_FILE_BYTES), fileName: 'limite.pdf', contentType: 'application/pdf' }, 'x')).not.toThrow()
    expect(() => fileResult({ content: '', fileName: 'vide.csv', contentType: 'text/csv' }, 'x')).toThrow('Le fichier est vide.')
  })
})

describe('exportQuery', () => {
  it('builds the query string of the route: strings, the group report and its filters, never the company', () => {
    expect(exportQuery({ companyId: 'c1', report: 'local_taxes', year: 2025, format: 'csv' })).toEqual({ year: '2025', format: 'csv' })
    expect(
      exportQuery({ companyId: 'c1', report: 'group', groupReport: 'ledger', fiscalYearId: 'fy1', groupFilters: { prefix: '6', companyId: 'c2', fiscalYearId: 'other' } }),
    ).toEqual({ report: 'ledger', fiscalYearId: 'fy1', prefix: '6' })
  })
})
