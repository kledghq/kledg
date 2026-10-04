import { describe, expect, it } from 'vitest'

import { STATEMENT_FILE_ACCEPT, accountingImportAccept } from '../file-accept'

const parts = (accept: string) => accept.split(',')

describe('import file pickers', () => {
  it('lists the statement extensions and the media types phones filter on', () => {
    const accept = parts(STATEMENT_FILE_ACCEPT)
    for (const ext of ['.csv', '.txt', '.tsv', '.xlsx', '.ofx', '.qfx', '.xml']) expect(accept).toContain(ext)
    for (const type of ['text/csv', 'text/plain', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/x-ofx', 'application/xml']) {
      expect(accept).toContain(type)
    }
    expect(new Set(accept).size).toBe(accept.length)
  })

  it('narrows the accounting import to the chosen file type', () => {
    expect(parts(accountingImportAccept('fec'))).toEqual(['.fec', '.txt', 'text/plain'])
    expect(parts(accountingImportAccept('csv'))).toContain('text/csv')
    expect(parts(accountingImportAccept('csv'))).not.toContain('.xlsx')
    expect(parts(accountingImportAccept('excel'))).toEqual(
      expect.arrayContaining(['.xlsx', '.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
    )
  })
})
