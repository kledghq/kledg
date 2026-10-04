/**
 * QontoStatements.getAllStatements reads every page of statements and
 * always stops: on next_page null, on a missing next_page (a response
 * shape Qonto might change), on an empty page, on a next_page that does
 * not move forward, and at a hard page cap.
 */

import { describe, expect, it, vi } from 'vitest'
import { QontoStatements } from '../statements'
import type { QontoStatement, QontoStatementsResponse } from '../types'

const statement = (id: string) => ({ id }) as unknown as QontoStatement
const page = (ids: string[], nextPage: unknown) =>
  ({ statements: ids.map(statement), meta: { next_page: nextPage } }) as unknown as QontoStatementsResponse

function clientWith(pages: (pageNumber: number) => QontoStatementsResponse) {
  const client = new QontoStatements('login', 'secret')
  const getStatements = vi.spyOn(client, 'getStatements').mockImplementation(async (options) => pages(options?.page ?? 1))
  return { client, getStatements }
}

describe('QontoStatements.getAllStatements', () => {
  it('follows next_page until Qonto says there is none', async () => {
    const { client, getStatements } = clientWith((n) => (n === 1 ? page(['s1', 's2'], 2) : page(['s3'], null)))
    expect((await client.getAllStatements()).map((s) => s.id)).toEqual(['s1', 's2', 's3'])
    expect(getStatements.mock.calls.map(([options]) => options?.page)).toEqual([1, 2])
    expect(getStatements.mock.calls[0]?.[0]).toMatchObject({ perPage: 100 })
  })

  it('stops when next_page is missing instead of looping forever', async () => {
    const { client, getStatements } = clientWith(() => page(['s1'], undefined))
    expect(await client.getAllStatements()).toHaveLength(1)
    expect(getStatements).toHaveBeenCalledTimes(1)
  })

  it('stops on an empty page and on a next_page that does not move forward', async () => {
    const empty = clientWith((n) => (n === 1 ? page(['s1'], 2) : page([], 3)))
    expect(await empty.client.getAllStatements()).toHaveLength(1)
    expect(empty.getStatements).toHaveBeenCalledTimes(2)

    const stuck = clientWith(() => page(['s1'], 1))
    expect(await stuck.client.getAllStatements()).toHaveLength(1)
    expect(stuck.getStatements).toHaveBeenCalledTimes(1)
  })

  it('reads at most 200 pages', async () => {
    const { client, getStatements } = clientWith((n) => page([`s${n}`], n + 1))
    expect(await client.getAllStatements()).toHaveLength(200)
    expect(getStatements).toHaveBeenCalledTimes(200)
  })
})
