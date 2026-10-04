'use client'

import * as React from 'react'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, GripVertical, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { moveItem } from '@/lib/dashboard/layout'
import { getWidget, WIDGET_SIZE_LABELS, type LayoutItem, type WidgetDefinition, type WidgetSize } from '@/lib/dashboard/widgets'
import { cn } from '@/lib/utils'
import { WIDGET_COMPONENTS } from './widgets'

/**
 * Widgets on a grid sized by the space the page has, not the window: one
 * column on a phone, two next to the sidebar on a laptop, four on a wide
 * screen. S takes one column, M two, L the whole row. The DOM order is the
 * reading and tab order (no dense packing that would reorder them).
 */
const SIZE_CLASSES: Record<WidgetSize, string> = {
  S: 'col-span-1',
  M: 'col-span-1 @md/dashboard:col-span-2',
  L: 'col-span-1 @md/dashboard:col-span-2 @5xl/dashboard:col-span-4',
}

const GRID = 'grid grid-cols-1 gap-4 @md/dashboard:grid-cols-2 @5xl/dashboard:grid-cols-4'

const quoted = (title: string) => `« ${title} »`
const titleOf = (id: string | number) => getWidget(String(id))?.title ?? String(id)

export function DashboardGrid({ items }: { items: LayoutItem[] }) {
  return (
    <div className="@container/dashboard">
      <div className={GRID}>
        {items.map((item) => {
          const widget = getWidget(item.id) as WidgetDefinition
          const Widget = WIDGET_COMPONENTS[item.id]
          return (
            <div key={item.id} className={cn('min-w-0', SIZE_CLASSES[item.size])} data-widget={item.id}>
              <Widget widget={widget} size={item.size} editing={false} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface EditableGridProps {
  items: LayoutItem[]
  onChange: (items: LayoutItem[], announcement: string) => void
}

/**
 * Edit mode: drag a widget by its handle (mouse, touch, or keyboard: Space
 * then the arrows), or use the Monter and Descendre buttons; pick a size;
 * hide a widget. Widget contents are inert meanwhile so Tab goes from one
 * control to the next.
 */
export function EditableDashboardGrid({ items, onChange }: EditableGridProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const position = (id: string | number) => items.findIndex((i) => i.id === id) + 1

  const announcements: Announcements = {
    onDragStart: ({ active }) => `${quoted(titleOf(active.id))} saisi, en position ${position(active.id)} sur ${items.length}.`,
    onDragOver: ({ active, over }) =>
      over ? `${quoted(titleOf(active.id))} au-dessus de la position ${position(over.id)} sur ${items.length}.` : `${quoted(titleOf(active.id))} hors de la grille.`,
    onDragEnd: ({ active, over }) =>
      over ? `${quoted(titleOf(active.id))} déposé en position ${position(over.id)} sur ${items.length}.` : `${quoted(titleOf(active.id))} déposé.`,
    onDragCancel: ({ active }) => `Déplacement de ${quoted(titleOf(active.id))} annulé.`,
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return
    const moved = items[from]
    onChange(moveItem(items, from, to), `${quoted(titleOf(moved.id))} déplacé en position ${to + 1} sur ${items.length}.`)
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    move(items.findIndex((i) => i.id === active.id), items.findIndex((i) => i.id === over.id))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            'Pour déplacer un widget, appuyez sur Espace, déplacez-le avec les flèches, puis appuyez de nouveau sur Espace pour le déposer ou sur Échap pour annuler.',
        },
      }}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
        <div className="@container/dashboard">
          <ol className={GRID} aria-label="Widgets du tableau de bord, dans l'ordre d'affichage">
            {items.map((item, index) => (
              <EditableItem
                key={item.id}
                item={item}
                index={index}
                count={items.length}
                onMove={move}
                onResize={(size) =>
                  onChange(
                    items.map((i) => (i.id === item.id ? { ...i, size } : i)),
                    `${quoted(titleOf(item.id))} passe en format ${WIDGET_SIZE_LABELS[size].toLowerCase()}.`,
                  )
                }
                onRemove={() =>
                  onChange(
                    items.filter((i) => i.id !== item.id),
                    `${quoted(titleOf(item.id))} retiré du tableau de bord. Ajoutez-le de nouveau depuis le catalogue.`,
                  )
                }
              />
            ))}
          </ol>
        </div>
      </SortableContext>
    </DndContext>
  )
}

interface EditableItemProps {
  item: LayoutItem
  index: number
  count: number
  onMove: (from: number, to: number) => void
  onResize: (size: WidgetSize) => void
  onRemove: () => void
}

function EditableItem({ item, index, count, onMove, onResize, onRemove }: EditableItemProps) {
  const widget = getWidget(item.id) as WidgetDefinition
  const Widget = WIDGET_COMPONENTS[item.id]
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const style = { transform: CSS.Translate.toString(transform), transition }

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-widget={item.id}
      className={cn(
        'outline-border bg-background relative flex min-w-0 flex-col gap-2 rounded-lg p-1.5 outline-1 outline-dashed',
        isDragging && 'z-10 shadow-lg',
        SIZE_CLASSES[item.size],
      )}
    >
      <div className="bg-muted flex flex-wrap items-center gap-1 rounded-md px-1 py-1">
        <Button
          ref={setActivatorNodeRef}
          variant="ghost"
          size="icon-sm"
          className="cursor-grab touch-none active:cursor-grabbing"
          aria-label={`Déplacer ${widget.title}`}
          title="Glisser pour déplacer"
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden />
        </Button>
        <span className="min-w-0 flex-1 basis-24 truncate px-1 text-sm font-medium">{widget.title}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Monter ${widget.title}`}
          title="Monter"
          disabled={index === 0}
          onClick={() => onMove(index, index - 1)}
        >
          <ArrowUp aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Descendre ${widget.title}`}
          title="Descendre"
          disabled={index === count - 1}
          onClick={() => onMove(index, index + 1)}
        >
          <ArrowDown aria-hidden />
        </Button>
        {widget.sizes.length > 1 ? (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={item.size}
            onValueChange={(value) => {
              if (value) onResize(value as WidgetSize)
            }}
            aria-label={`Taille de ${widget.title}`}
          >
            {widget.sizes.map((size) => (
              <ToggleGroupItem key={size} value={size} aria-label={WIDGET_SIZE_LABELS[size]} title={WIDGET_SIZE_LABELS[size]} className="px-2.5">
                {size}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
        <Button variant="ghost" size="icon-sm" aria-label={`Retirer ${widget.title}`} title="Retirer du tableau de bord" onClick={onRemove}>
          <X aria-hidden />
        </Button>
      </div>
      <div inert className="pointer-events-none flex-1 select-none">
        <Widget widget={widget} size={item.size} editing />
      </div>
    </li>
  )
}
