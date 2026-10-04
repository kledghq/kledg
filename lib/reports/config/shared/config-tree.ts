/**
 * Builds the tree of the statement layouts (bilan, compte de résultat) from
 * their flat configuration rows: each row under its parent, siblings by
 * `order` (rows of equal order keep the input order). A row whose parent is
 * not among the rows (inactive or deleted) is shown at the root rather than
 * lost.
 */

export type ConfigTreeNode<T> = T & { children: ConfigTreeNode<T>[] }

interface ConfigRow {
  id: string
  parentId?: string | null
  order: number
}

const byOrder = (a: { order: number }, b: { order: number }) => a.order - b.order

export function buildConfigTree<T extends ConfigRow>(rows: readonly T[]): ConfigTreeNode<T>[] {
  const nodes = new Map<string, ConfigTreeNode<T>>()
  for (const row of rows) nodes.set(row.id, { ...row, children: [] })

  const roots: ConfigTreeNode<T>[] = []
  for (const row of rows) {
    const node = nodes.get(row.id)!
    const parent = row.parentId ? nodes.get(row.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const sort = (siblings: ConfigTreeNode<T>[]) => {
    siblings.sort(byOrder)
    for (const node of siblings) sort(node.children)
  }
  sort(roots)
  return roots
}
