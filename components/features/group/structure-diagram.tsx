'use client'

import * as React from 'react'
import Link from 'next/link'
import { Building2, Info, Lock, Maximize2, Minus, Plus, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PersonAvatar } from '@/components/shared'
import { cn } from '@/lib/utils'
import { edgeLabel, layoutStructure, type GroupStructure, type StructureNode } from '@/lib/group/structure'
import { ownership } from './space'

/**
 * The organigramme of the group (Structure, docs/vue-groupe.md): people and
 * companies as cards, holdings as arrows with their percentage, laid out by
 * level (lib/group/structure.ts). A company read opens its own pages; the
 * "i" button of a card shows who holds it, directly and through the group.
 * Plain HTML cards over an SVG of arrows, no chart library: it scrolls
 * inside its frame on a phone, with zoom buttons, and the same structure
 * is written as a list for screen readers ("Lire l'organigramme en texte").
 */

const KIND_SHORT = { filiale: 'filiale', participation: 'participation', autre: 'moins de 10 %' } as const
const NODE = { width: 208, height: 84, gapX: 28, gapY: 72, margin: 16 }
const ZOOMS = [0.5, 0.65, 0.8, 1, 1.2] as const

function subtitle(node: StructureNode, simple: boolean): string {
  switch (node.kind) {
    case 'holding':
      return simple ? 'Société de tête' : 'Holding'
    case 'subsidiary': {
      const i = node.holdingInterest
      if (!i) return 'Filiale'
      const total = ownership(i.totalBp)
      if (simple) return `Détenue à ${total} par le groupe`
      return i.indirectBp > 0 ? `Groupe ${total} (dont ${ownership(i.indirectBp)} indirect)` : `Détenue à ${total}`
    }
    case 'hidden':
      return 'Vous n’avez pas accès à cette société'
    case 'person':
      return 'Personne'
    case 'company':
      return 'Société hors du groupe'
    default:
      return 'Autre associé'
  }
}

function NodeIcon({ node }: { node: StructureNode }) {
  if (node.kind === 'person') return <PersonAvatar name={node.label} photo={node.photo} size="md" />
  const Icon = node.kind === 'hidden' ? Lock : node.kind === 'other' ? Users : Building2
  if (node.logo) {
    return (
      <span className="bg-background flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border">
        <img src={node.logo} alt="" className="size-8 object-contain" />
      </span>
    )
  }
  return (
    <span aria-hidden className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border">
      <Icon className="size-4" />
    </span>
  )
}

function NodeCard({ node, simple, selected, onSelect }: { node: StructureNode; simple: boolean; selected: boolean; onSelect: () => void }) {
  const href = node.slug ? (simple ? `/${node.slug}/simple` : `/${node.slug}`) : null
  const officer = node.officers[0]
  const canDetail = node.holders.length > 0 || node.officers.length > 0
  return (
    <div
      data-slot="structure-node"
      data-kind={node.kind}
      className={cn(
        'bg-card flex h-full items-start gap-2 rounded-lg border p-2.5 text-left',
        node.kind === 'holding' && 'border-foreground/40',
        node.kind === 'hidden' && 'border-dashed',
        selected && 'ring-ring/50 ring-[3px]',
      )}
    >
      <NodeIcon node={node} />
      <div className="min-w-0 flex-1">
        {href ? (
          <Link href={href} className="text-link block truncate text-sm font-medium hover:underline">
            {node.label}
          </Link>
        ) : (
          <span className={cn('block truncate text-sm font-medium', node.kind === 'hidden' && 'text-muted-foreground')}>{node.label}</span>
        )}
        <span className="text-muted-foreground block truncate text-xs">{subtitle(node, simple)}</span>
        {officer && !simple ? (
          <span className="text-muted-foreground block truncate text-xs">
            {officer.title ? `${officer.title} : ` : ''}
            {officer.name}
          </span>
        ) : null}
      </div>
      {canDetail ? (
        <Button variant="ghost" size="icon-xs" aria-label={`Qui détient ${node.label}`} title={`Qui détient ${node.label}`} aria-pressed={selected} onClick={onSelect}>
          <Info aria-hidden />
        </Button>
      ) : null}
    </div>
  )
}

/** One sentence per holding, for screen readers and for reading the structure as text. */
function structureSentences(structure: GroupStructure): string[] {
  const label = new Map(structure.nodes.map((n) => [n.id, n.label]))
  return structure.edges.map((e) =>
    e.bp === null ? `${label.get(e.from)} détient ${label.get(e.to)} (pourcentage non connu)` : `${label.get(e.from)} détient ${edgeLabel(e)} de ${label.get(e.to)}${e.kind ? ` (${KIND_SHORT[e.kind]})` : ''}`,
  )
}

export function StructureDiagram({ structure, simple = false }: { structure: GroupStructure; simple?: boolean }) {
  const layout = React.useMemo(() => layoutStructure(structure.nodes, NODE), [structure.nodes])
  const [zoomIndex, setZoomIndex] = React.useState(3)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const frame = React.useRef<HTMLDivElement>(null)
  const zoom = ZOOMS[zoomIndex]
  const selected = structure.nodes.find((n) => n.id === selectedId) ?? null

  const fit = () => {
    const width = frame.current?.clientWidth ?? layout.width
    const fitting = [...ZOOMS].reverse().findIndex((z) => layout.width * z <= width)
    setZoomIndex(fitting === -1 ? 0 : ZOOMS.length - 1 - fitting)
  }
  // On a narrow screen, start fitted to the width.
  React.useEffect(() => {
    const width = frame.current?.clientWidth
    if (width && width < layout.width) {
      const fitting = [...ZOOMS].reverse().findIndex((z) => layout.width * z <= width)
      setZoomIndex(fitting === -1 ? 0 : ZOOMS.length - 1 - fitting)
    }
  }, [layout.width])

  const sentences = structureSentences(structure)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {simple ? 'Les flèches vont de celui qui possède vers la société possédée.' : 'Les flèches vont du détenteur vers la société détenue\u00a0: plus de 50 %, filiale ; de 10 à 50 %, participation.'}
        </p>
        <div className="flex items-center gap-1" role="group" aria-label="Zoom de l'organigramme">
          <Button variant="outline" size="icon-sm" aria-label="Zoom arrière" title="Zoom arrière" disabled={zoomIndex === 0} onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}>
            <Minus aria-hidden />
          </Button>
          <span className="num text-muted-foreground w-12 text-center text-xs" aria-live="polite">
            {Math.round(zoom * 100)}&nbsp;%
          </span>
          <Button variant="outline" size="icon-sm" aria-label="Zoom avant" title="Zoom avant" disabled={zoomIndex === ZOOMS.length - 1} onClick={() => setZoomIndex((i) => Math.min(ZOOMS.length - 1, i + 1))}>
            <Plus aria-hidden />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Ajuster à la largeur" title="Ajuster à la largeur" onClick={fit}>
            <Maximize2 aria-hidden />
          </Button>
        </div>
      </div>
      <div ref={frame} className="bg-background max-h-[36rem] overflow-auto rounded-md border" role="figure" aria-label={simple ? 'Qui possède quoi dans le groupe' : 'Organigramme du groupe'}>
        <div style={{ width: layout.width * zoom, height: layout.height * zoom }}>
          <div className="relative origin-top-left" style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}>
            <svg aria-hidden width={layout.width} height={layout.height} className="absolute inset-0">
              <defs>
                <marker id="structure-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" className="fill-muted-foreground" />
                </marker>
              </defs>
              {structure.edges.map((e) => {
                const a = layout.boxes.get(e.from)
                const b = layout.boxes.get(e.to)
                if (!a || !b) return null
                const sameRow = a.y === b.y
                const sx = sameRow ? (a.x < b.x ? a.x + a.width : a.x) : a.x + a.width / 2
                const sy = sameRow ? a.y + a.height / 2 : a.y < b.y ? a.y + a.height : a.y
                const tx = sameRow ? (a.x < b.x ? b.x : b.x + b.width) : b.x + b.width / 2
                const ty = sameRow ? b.y + b.height / 2 : a.y < b.y ? b.y : b.y + b.height
                const my = (sy + ty) / 2
                const path = sameRow ? `M ${sx} ${sy} C ${(sx + tx) / 2} ${sy - 30} ${(sx + tx) / 2} ${ty - 30} ${tx} ${ty}` : `M ${sx} ${sy} C ${sx} ${my} ${tx} ${my} ${tx} ${ty}`
                const text = simple || !e.kind ? edgeLabel(e) : `${edgeLabel(e)} · ${KIND_SHORT[e.kind]}`
                const lx = (sx + tx) / 2
                const ly = sameRow ? sy - 22 : my
                const highlighted = selectedId !== null && (e.to === selectedId || e.from === selectedId)
                return (
                  <g key={e.id}>
                    <path d={path} fill="none" strokeWidth={highlighted ? 2 : 1.25} strokeDasharray={e.bp === null ? '4 4' : undefined} className={highlighted ? 'stroke-foreground' : 'stroke-muted-foreground'} markerEnd="url(#structure-arrow)" />
                    <rect x={lx - text.length * 3.4 - 6} y={ly - 10} width={text.length * 6.8 + 12} height={20} rx={10} className="fill-background stroke-border" />
                    <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" className="fill-foreground text-[11px]">
                      {text}
                    </text>
                  </g>
                )
              })}
            </svg>
            {structure.nodes.map((n) => {
              const box = layout.boxes.get(n.id)
              if (!box) return null
              return (
                <div key={n.id} className="absolute" style={{ left: box.x, top: box.y, width: box.width, height: box.height }}>
                  <NodeCard node={n} simple={simple} selected={n.id === selectedId} onSelect={() => setSelectedId((id) => (id === n.id ? null : n.id))} />
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {selected ? <NodeDetails node={selected} simple={simple} onClose={() => setSelectedId(null)} /> : null}
      <details className="text-sm">
        <summary className="text-link cursor-pointer">Lire l&apos;organigramme en texte</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {sentences.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </details>
    </div>
  )
}

function NodeDetails({ node, simple, onClose }: { node: StructureNode; simple: boolean; onClose: () => void }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>
            <h3>Qui détient {node.label}</h3>
          </CardTitle>
          <CardDescription>
            {simple ? 'Ce que chacun possède, directement et par les autres sociétés du groupe.' : 'Direct\u00a0: parts inscrites au nom du détenteur. Indirect\u00a0: produit des pourcentages le long de chaque chaîne de sociétés du groupe. Indicatif, appliqué à aucun chiffre.'}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>
          Fermer
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {node.holders.length > 0 ? (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Détenteur</TableHead>
                  <TableHead numeric>Direct</TableHead>
                  <TableHead numeric>Indirect</TableHead>
                  <TableHead numeric>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {node.holders.map((h) => (
                  <TableRow key={h.nodeId}>
                    <TableCell className="whitespace-normal">{h.label}</TableCell>
                    <TableCell numeric>{h.directBp > 0 ? ownership(h.directBp) : '-'}</TableCell>
                    <TableCell numeric>{h.indirectBp > 0 ? ownership(h.indirectBp) : '-'}</TableCell>
                    <TableCell numeric className="font-medium">
                      {ownership(h.totalBp)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Aucun associé enregistré pour cette société.</p>
        )}
        {node.officers.length > 0 ? (
          <div className="space-y-1 text-sm">
            <p className="font-medium">Dirigeants</p>
            <ul className="text-muted-foreground space-y-0.5">
              {node.officers.map((o) => (
                <li key={`${o.name}-${o.title}`}>
                  {o.name}
                  {o.title ? `, ${o.title}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {node.slug ? (
          <Link href={simple ? `/${node.slug}/simple` : `/${node.slug}`} className="text-link text-sm hover:underline">
            Ouvrir {node.label}
          </Link>
        ) : null}
      </CardContent>
    </Card>
  )
}
