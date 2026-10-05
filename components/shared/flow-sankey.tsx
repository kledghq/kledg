'use client'

import * as React from 'react'
import { Layer, Rectangle } from 'recharts'

/**
 * Shared pieces of the flow diagrams (recharts Sankey): the flows between
 * the companies of a group (components/features/group/flows-section.tsx)
 * and the flows with the customers and suppliers of a company
 * (components/features/tiers/tiers-flows-card.tsx). A link is a curved band
 * whose thickness follows the amount, in a colour token of app/globals.css
 * (--chart-flow-*); a node is a thin bar with its name beside it; the
 * legend names every colour, so colour is never the only way to read it.
 */

/** Props recharts gives a custom link. */
export interface SankeyLinkProps<P = Record<string, unknown>> {
  sourceX: number
  targetX: number
  sourceY: number
  targetY: number
  sourceControlX: number
  targetControlX: number
  linkWidth: number
  payload: P
}

/** Props recharts gives a custom node. */
export interface SankeyNodeProps<P = Record<string, unknown>> {
  x: number
  y: number
  width: number
  height: number
  payload: P
}

export function FlowLinkPath({
  sourceX,
  targetX,
  sourceY,
  targetY,
  sourceControlX,
  targetControlX,
  linkWidth,
  color,
  kind,
}: Omit<SankeyLinkProps, 'payload'> & { color: string; kind?: string }) {
  return (
    <path
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={color}
      strokeWidth={linkWidth}
      strokeOpacity={0.6}
      data-kind={kind}
    />
  )
}

/** A node bar with its name on the right (`start`), on the left (`end`) or above it (`top`). */
export function FlowNodeShape({ x, y, width, height, name, label, fill }: Omit<SankeyNodeProps, 'payload'> & { name: string; label: 'start' | 'end' | 'top'; fill?: string }) {
  const text =
    label === 'top'
      ? { x: x + width / 2, y: y - 8, textAnchor: 'middle' as const }
      : label === 'start'
        ? { x: x + width + 6, y: y + height / 2, textAnchor: 'start' as const }
        : { x: x - 6, y: y + height / 2, textAnchor: 'end' as const }
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={height} className={fill ? undefined : 'fill-foreground'} fill={fill} />
      <text {...text} dominantBaseline="central" className="fill-foreground text-xs">
        {name}
      </text>
    </Layer>
  )
}

/** The box of a flow tooltip. */
export function FlowTooltipShell({ children }: { children: React.ReactNode }) {
  return <div className="bg-popover text-popover-foreground rounded-md border px-3 py-2 text-xs shadow-md">{children}</div>
}

/** The colours of a diagram, each with its name. */
export function FlowLegend({ items, label = 'Légende des flux' }: { items: ReadonlyArray<{ key: string; label: string; color: string }>; label?: string }) {
  return (
    <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label={label}>
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}
