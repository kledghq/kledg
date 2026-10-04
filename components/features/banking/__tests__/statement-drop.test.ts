import { describe, expect, it, vi } from 'vitest'
import {
  droppedFile,
  EXTERNAL_FILE_DRAG_TYPE,
  externalFile,
  isImportableDrag,
  registerExternalFile,
  unregisterExternalFile,
} from '../statement-drop'

/** Minimal DataTransfer: jsdom has none. */
function transfer(data: Record<string, string>, files: File[] = []): DataTransfer {
  const types = [...Object.keys(data), ...(files.length > 0 ? ['Files'] : [])]
  return {
    types,
    files: files as unknown as FileList,
    getData: (type: string) => data[type] ?? '',
  } as unknown as DataTransfer
}

describe('external file sources', () => {
  it('hands a registered file over by its token, with its bank account', async () => {
    const file = new File(['date;montant'], 'releve.csv', { type: 'text/csv' })
    const load = vi.fn(async () => file)
    const token = registerExternalFile({ fileName: 'releve.csv', bankAccountId: 'acc-1', load })
    expect(externalFile(token)?.fileName).toBe('releve.csv')
    const dropped = await droppedFile(transfer({ [EXTERNAL_FILE_DRAG_TYPE]: token }))
    expect(dropped).toEqual({ file, bankAccountId: 'acc-1' })
    expect(load).toHaveBeenCalledOnce()
    unregisterExternalFile(token)
    expect(externalFile(token)).toBeNull()
  })

  it('ignores tokens this page did not register (drag from another site, crafted link)', async () => {
    expect(externalFile('not-a-token')).toBeNull()
    expect(externalFile(null)).toBeNull()
    expect(await droppedFile(transfer({ [EXTERNAL_FILE_DRAG_TYPE]: '/api/companies' }))).toBeNull()
  })

  it('gives each registration its own token', () => {
    const load = async () => new File([''], 'a.csv')
    const a = registerExternalFile({ fileName: 'a.csv', load })
    const b = registerExternalFile({ fileName: 'a.csv', load })
    expect(a).not.toBe(b)
  })
})

describe('desktop files', () => {
  it('accepts a dropped file and recognises importable drags', async () => {
    const file = new File(['x'], 'releve.ofx')
    expect(await droppedFile(transfer({}, [file]))).toEqual({ file })
    expect(isImportableDrag(transfer({}, [file]))).toBe(true)
    expect(isImportableDrag(transfer({ [EXTERNAL_FILE_DRAG_TYPE]: 't' }))).toBe(true)
    expect(isImportableDrag(transfer({ 'text/plain': 'hello' }))).toBe(false)
    expect(isImportableDrag(null)).toBe(false)
  })
})
