import type { WidgetDefinition, WidgetSize } from '@/lib/dashboard/widgets'

export interface WidgetProps {
  widget: WidgetDefinition
  size: WidgetSize
  /** The dashboard is in its edit mode: widgets that hide themselves show a placeholder instead. */
  editing: boolean
}
