/**
 * Dashboard layouts: the widgets a user shows, in order, with their size.
 * Pure (zod only): the API validates bodies and stored rows with it, the
 * page reorders with the same rules.
 *
 * Invariant: a layout that reaches the page only holds known widgets the
 * user may see, each once, at a size the widget supports. Anything else in
 * a request body or a stored row is dropped, never an error: a layout saved
 * by a newer or older version (a widget added or removed since) still loads.
 */

import { z } from 'zod'
import {
  DEFAULT_LAYOUTS,
  getWidget,
  WIDGET_SIZES,
  type DashboardProfile,
  type LayoutItem,
  type WidgetDefinition,
  type WidgetSize,
} from './widgets'

/** Version of the stored JSON (DashboardLayout.layout). */
export const LAYOUT_VERSION = 1

/** More than the registry holds, so a saved layout is never cut; bounds what a request may send. */
export const MAX_LAYOUT_ITEMS = 50

const WidgetIdField = z.string().trim().min(1).max(64)

/** Body of PUT /api/dashboard/layout. */
export const DashboardLayoutBody = z.object({
  items: z
    .array(
      z.object({
        id: WidgetIdField,
        size: z.enum(WIDGET_SIZES, { error: 'Taille de widget inconnue : S, M ou L' }).optional(),
      }),
    )
    .max(MAX_LAYOUT_ITEMS, { error: `Un tableau de bord compte au plus ${MAX_LAYOUT_ITEMS} widgets` }),
})
export type DashboardLayoutInput = z.infer<typeof DashboardLayoutBody>

/** A stored row, read leniently: sizes are checked by sanitizeLayout, not here. */
const StoredLayoutSchema = z.object({
  version: z.literal(LAYOUT_VERSION),
  items: z.array(z.object({ id: z.string(), size: z.string().optional() })).max(200),
})

export type StoredLayout = {
  version: typeof LAYOUT_VERSION
  items: LayoutItem[]
}

/**
 * Known, allowed widgets only, each once (the first occurrence wins), with a
 * size the widget supports (else its default size).
 */
export function sanitizeLayout(
  items: ReadonlyArray<{ id: string; size?: string | null }>,
  isAllowed: (widget: WidgetDefinition) => boolean,
): LayoutItem[] {
  const seen = new Set<string>()
  const result: LayoutItem[] = []
  for (const entry of items) {
    const widget = getWidget(entry.id)
    if (!widget || seen.has(widget.id) || !isAllowed(widget)) continue
    seen.add(widget.id)
    const size = widget.sizes.includes(entry.size as WidgetSize) ? (entry.size as WidgetSize) : widget.defaultSize
    result.push({ id: widget.id as LayoutItem['id'], size })
  }
  return result
}

/** The items of a stored row, or null when the row cannot be read (the default layout applies). */
export function parseStoredLayout(json: unknown, isAllowed: (widget: WidgetDefinition) => boolean): LayoutItem[] | null {
  const parsed = StoredLayoutSchema.safeParse(json)
  if (!parsed.success) return null
  return sanitizeLayout(parsed.data.items, isAllowed)
}

/** What is written to DashboardLayout.layout. */
export function toStoredLayout(items: LayoutItem[]): StoredLayout {
  return { version: LAYOUT_VERSION, items: items.map(({ id, size }) => ({ id, size })) }
}

/** The default layout of a profile, without the widgets the user may not see. */
export function defaultLayout(profile: DashboardProfile, isAllowed: (widget: WidgetDefinition) => boolean): LayoutItem[] {
  return sanitizeLayout(DEFAULT_LAYOUTS[profile], isAllowed)
}

/** Moves the item at `from` to `to` (both clamped); returns a new array. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items]
  if (from < 0 || from >= next.length) return next
  const target = Math.max(0, Math.min(next.length - 1, to))
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved)
  return next
}
