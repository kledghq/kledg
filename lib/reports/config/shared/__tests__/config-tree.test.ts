import { describe, expect, it } from 'vitest'
import { buildConfigTree } from '../config-tree'

const row = (id: string, parentId: string | null, order: number) => ({ id, parentId, order, label: id })

describe('buildConfigTree', () => {
  it('nests rows under their parent and sorts every level by order', () => {
    const tree = buildConfigTree([row('c2', 'a', 2), row('b', null, 2), row('a', null, 1), row('c1', 'a', 1), row('d', 'c1', 1)])
    expect(tree.map((n) => n.id)).toEqual(['a', 'b'])
    expect(tree[0].children.map((n) => n.id)).toEqual(['c1', 'c2'])
    expect(tree[0].children[0].children.map((n) => n.id)).toEqual(['d'])
    expect(tree[1].children).toEqual([])
    expect(tree[0]).toMatchObject({ label: 'a' })
  })

  it('keeps the input order between rows of equal order', () => {
    const tree = buildConfigTree([row('second', null, 1), row('first', null, 1)])
    expect(tree.map((n) => n.id)).toEqual(['second', 'first'])
  })

  it('puts a row whose parent is missing at the root instead of losing it', () => {
    const tree = buildConfigTree([row('orphan', 'inactive-parent', 3), row('root', null, 1)])
    expect(tree.map((n) => n.id)).toEqual(['root', 'orphan'])
  })

  it('does not change the rows it was given', () => {
    const rows = [row('a', null, 1), row('b', 'a', 1)]
    buildConfigTree(rows)
    expect(rows[0]).not.toHaveProperty('children')
  })
})
