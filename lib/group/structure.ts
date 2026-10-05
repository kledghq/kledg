/**
 * The structure diagram of a group (organigramme, Structure of the group
 * space, docs/vue-groupe.md): people and companies as nodes, holdings as
 * edges with their percentage and their kind, levels from the holders of
 * the holding down to the deepest subsidiary. Pure, no runtime import other
 * than the pure ownership and period rules: the service builds the input,
 * the page and the MCP tool read the output, the tests feed plain values.
 *
 * Rules:
 * - an edge is a direct holding recorded among the shareholders of the
 *   company held (its Informations page); between two companies, more than
 *   50 % is a filiale (Code de commerce, art. L233-1), 10 % to 50 % a
 *   participation (art. L233-2);
 * - the interest of a holder in a company is direct plus indirect, the
 *   product of the percentages along each chain through the companies of
 *   the group, summed over the chains (ownership.ts, cycles cut there);
 * - a subsidiary the user does not read is a node "Société non accessible"
 *   (named only when the user is a member of it with a role too low): its
 *   key is opaque (the service never passes its id), its holding by the
 *   holding has no percentage (recorded in its own cap table, not read),
 *   and chains through it are missing;
 * - levels: holders outside the group on top, the holding below them, then
 *   each company one level below the deepest company of the group that
 *   holds it (longest chain from the holding, a chain never passing twice
 *   through a company, at most MAX_DEPTH long): a cycle cannot loop.
 */

import { computeInterests, companyKey, MAX_DEPTH, type Interest } from './ownership'
import { participationKindOf, type ParticipationKind } from './periods'

export interface StructureCompanyInput {
  id: string
  name: string
  slug: string
  role: 'holding' | 'subsidiary'
  logo: string | null
  legalType: string | null
  officers: Array<{ name: string; title: string | null }>
}

export interface StructureHolderInput {
  /** Opaque key (never an email nor the id of a company the user does not read). */
  key: string
  kind: 'person' | 'company' | 'other'
  name: string
  photo: string | null
}

export interface StructureHiddenInput {
  /** Opaque key ("hidden-1"), the same when the hidden company also holds shares. */
  key: string
  /** Only when the user is a member of it (role too low to read it). */
  name: string | null
}

export interface StructureHoldingInput {
  /** `company:<id>` for a company read, a holder key or a hidden key. */
  holderKey: string
  /** A company read, or a hidden key (the holding's own stake, percentage unknown). */
  companyKey: string
  /** Basis points; null when not known (the cap table of a hidden company). */
  bp: number | null
}

export interface StructureInput {
  holdingId: string
  /** Companies read, the holding included. */
  companies: StructureCompanyInput[]
  hidden: StructureHiddenInput[]
  holders: StructureHolderInput[]
  holdings: StructureHoldingInput[]
}

export type StructureNodeKind = 'holding' | 'subsidiary' | 'person' | 'company' | 'other' | 'hidden'

export interface StructureHolderShare {
  nodeId: string
  label: string
  directBp: number
  indirectBp: number
  totalBp: number
}

export interface StructureNode {
  id: string
  kind: StructureNodeKind
  label: string
  /** Photo of a natural person (data URL). */
  photo: string | null
  /** Logo of a company read. */
  logo: string | null
  /** Slug of a company read, to open its pages. */
  slug: string | null
  legalType: string | null
  level: number
  /** Position in its level, from the left. */
  order: number
  officers: Array<{ name: string; title: string | null }>
  /** For a company of the group: the holding's interest, direct and through the group. */
  holdingInterest: Interest | null
  /** For a company read: who holds it, directly or through the group, largest first. */
  holders: StructureHolderShare[]
}

export interface StructureEdge {
  id: string
  from: string
  to: string
  bp: number | null
  /** Between two companies: filiale, participation or less than 10 %; null for a person or when unknown. */
  kind: ParticipationKind | null
}

export interface GroupStructure {
  nodes: StructureNode[]
  edges: StructureEdge[]
  levels: number
}

export const HIDDEN_COMPANY_LABEL = 'Société non accessible'

/** Node id of a company read, a holder or a hidden company. */
const nodeIdOf = (key: string) => (key.startsWith('company:') ? key.slice('company:'.length) : key)

/**
 * Levels of the companies of the group: the holding at 1, each company one
 * below the deepest company of the group holding it. `edges` are company to
 * company holdings (node ids). Cycle safe: a chain never revisits a company.
 */
export function companyLevels(holdingId: string, companyIds: readonly string[], edges: ReadonlyArray<{ from: string; to: string }>): Map<string, number> {
  const children = new Map<string, string[]>()
  for (const e of edges) {
    if (e.from === e.to) continue
    children.set(e.from, [...(children.get(e.from) ?? []), e.to])
  }
  const depth = new Map<string, number>([[holdingId, 0]])
  const walk = (id: string, d: number, path: ReadonlySet<string>) => {
    if (d >= MAX_DEPTH) return
    for (const child of children.get(id) ?? []) {
      if (path.has(child) || child === holdingId) continue
      if ((depth.get(child) ?? -1) < d + 1) depth.set(child, d + 1)
      walk(child, d + 1, new Set([...path, child]))
    }
  }
  walk(holdingId, 0, new Set([holdingId]))
  const levels = new Map<string, number>()
  for (const id of companyIds) levels.set(id, 1 + (depth.get(id) ?? 1))
  return levels
}

export function buildGroupStructure(input: StructureInput): GroupStructure {
  const readIds = input.companies.map((c) => c.id)
  const holderNames = new Map<string, string>([
    ...input.companies.map((c) => [companyKey(c.id), c.name] as const),
    ...input.holders.map((h) => [h.key, h.name] as const),
    ...input.hidden.map((h) => [h.key, h.name ?? HIDDEN_COMPANY_LABEL] as const),
  ])

  // Interests through the companies read (hidden ones have no known cap table).
  const known = input.holdings.filter((h): h is StructureHoldingInput & { bp: number } => h.bp !== null && readIds.includes(h.companyKey))
  const interests = computeInterests(
    known.map((h) => ({ holderKey: h.holderKey, companyId: h.companyKey, bp: h.bp })),
    readIds,
  )

  const edges: StructureEdge[] = []
  const seen = new Set<string>()
  for (const h of input.holdings) {
    const from = nodeIdOf(h.holderKey)
    const to = nodeIdOf(h.companyKey)
    const id = `${from}->${to}`
    if (from === to || seen.has(id)) {
      // Several rows of one holder in one company add up.
      const existing = edges.find((e) => e.id === id)
      if (existing && existing.bp !== null && h.bp !== null) {
        existing.bp += h.bp
        existing.kind = existing.kind ? participationKindOf(existing.bp) : null
      }
      continue
    }
    seen.add(id)
    const betweenCompanies = (h.holderKey.startsWith('company:') || h.holderKey.startsWith('hidden-')) && (h.companyKey.startsWith('hidden-') || readIds.includes(h.companyKey))
    const outsideHolder = input.holders.find((x) => x.key === h.holderKey)
    const isCompanyHolder = betweenCompanies || outsideHolder?.kind === 'company'
    edges.push({ id, from, to, bp: h.bp, kind: isCompanyHolder && h.bp !== null ? participationKindOf(h.bp) : null })
  }

  // Levels: companies of the group (read or hidden) by the chains of holdings between them.
  const groupIds = [...readIds, ...input.hidden.map((h) => h.key)]
  const groupSet = new Set(groupIds)
  const levels = companyLevels(
    input.holdingId,
    groupIds,
    edges.filter((e) => groupSet.has(e.from) && groupSet.has(e.to)),
  )

  const holdingInterest = interests.get(companyKey(input.holdingId))
  const holdersOf = (companyId: string): StructureHolderShare[] => {
    const rows: StructureHolderShare[] = []
    for (const [key, byCompany] of interests) {
      const i = byCompany.get(companyId)
      if (!i) continue
      rows.push({ nodeId: nodeIdOf(key), label: holderNames.get(key) ?? HIDDEN_COMPANY_LABEL, ...i })
    }
    return rows.sort((a, b) => b.totalBp - a.totalBp || a.label.localeCompare(b.label, 'fr'))
  }

  const nodes: StructureNode[] = []
  for (const c of input.companies) {
    nodes.push({
      id: c.id,
      kind: c.role === 'holding' ? 'holding' : 'subsidiary',
      label: c.name,
      photo: null,
      logo: c.logo,
      slug: c.slug,
      legalType: c.legalType,
      level: c.role === 'holding' ? 1 : (levels.get(c.id) ?? 2),
      order: 0,
      officers: c.officers,
      holdingInterest: c.role === 'holding' ? null : (holdingInterest?.get(c.id) ?? { directBp: 0, indirectBp: 0, totalBp: 0 }),
      holders: holdersOf(c.id),
    })
  }
  for (const h of input.hidden) {
    const stake = input.holdings.find((x) => x.holderKey === companyKey(input.holdingId) && x.companyKey === h.key)
    nodes.push({
      id: h.key,
      kind: 'hidden',
      label: h.name ?? HIDDEN_COMPANY_LABEL,
      photo: null,
      logo: null,
      slug: null,
      legalType: null,
      level: levels.get(h.key) ?? 2,
      order: 0,
      officers: [],
      holdingInterest: stake?.bp != null ? { directBp: stake.bp, indirectBp: 0, totalBp: stake.bp } : null,
      holders: [],
    })
  }
  for (const h of input.holders) {
    nodes.push({
      id: h.key,
      kind: h.kind,
      label: h.name,
      photo: h.kind === 'person' ? h.photo : null,
      logo: null,
      slug: null,
      legalType: null,
      level: 0,
      order: 0,
      officers: [],
      holdingInterest: null,
      holders: [],
    })
  }

  // Order inside a level: the holding first, then by the holding's interest or the stake in the holding, then by name.
  const stakeInHolding = (nodeId: string) =>
    edges.filter((e) => e.from === nodeId && e.to === input.holdingId).reduce((s, e) => s + (e.bp ?? 0), 0)
  const weight = (n: StructureNode) =>
    n.kind === 'holding' ? Number.MAX_SAFE_INTEGER : n.level === 0 ? stakeInHolding(n.id) : (n.holdingInterest?.totalBp ?? -1)
  const byLevel = new Map<number, StructureNode[]>()
  for (const n of nodes) byLevel.set(n.level, [...(byLevel.get(n.level) ?? []), n])
  for (const list of byLevel.values()) {
    list.sort((a, b) => weight(b) - weight(a) || Number(a.kind === 'hidden') - Number(b.kind === 'hidden') || a.label.localeCompare(b.label, 'fr'))
    list.forEach((n, i) => (n.order = i))
  }
  nodes.sort((a, b) => a.level - b.level || a.order - b.order)
  const levelCount = nodes.reduce((max, n) => Math.max(max, n.level + 1), 0)
  return { nodes, edges, levels: levelCount }
}

/** Short label of an edge: "80 %", "Non lue". */
export function edgeLabel(edge: Pick<StructureEdge, 'bp'>): string {
  if (edge.bp === null) return 'Non lue'
  const value = edge.bp / 100
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0$/, '').replace('.', ',')} %`
}

export interface LayoutBox {
  x: number
  y: number
  width: number
  height: number
}

export interface StructureLayout {
  width: number
  height: number
  boxes: Map<string, LayoutBox>
}

/**
 * Positions of the nodes for the diagram: one row per level, the rows
 * centred on the widest one. Pure, so the page draws what the test checks.
 */
export function layoutStructure(nodes: ReadonlyArray<Pick<StructureNode, 'id' | 'level' | 'order'>>, size = { width: 208, height: 84, gapX: 28, gapY: 72, margin: 16 }): StructureLayout {
  const rows = new Map<number, Array<Pick<StructureNode, 'id' | 'level' | 'order'>>>()
  for (const n of nodes) rows.set(n.level, [...(rows.get(n.level) ?? []), n])
  const levels = [...rows.keys()].sort((a, b) => a - b)
  const widest = Math.max(1, ...[...rows.values()].map((r) => r.length))
  const width = widest * size.width + (widest - 1) * size.gapX + 2 * size.margin
  const boxes = new Map<string, LayoutBox>()
  levels.forEach((level, row) => {
    const list = [...(rows.get(level) ?? [])].sort((a, b) => a.order - b.order)
    const rowWidth = list.length * size.width + (list.length - 1) * size.gapX
    const left = (width - rowWidth) / 2
    list.forEach((n, i) => boxes.set(n.id, { x: left + i * (size.width + size.gapX), y: size.margin + row * (size.height + size.gapY), width: size.width, height: size.height }))
  })
  const height = levels.length * size.height + Math.max(0, levels.length - 1) * size.gapY + 2 * size.margin
  return { width, height, boxes }
}
