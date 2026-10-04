'use client'

import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  WIDGET_CATEGORY_LABELS,
  WIDGET_SIZE_LABELS,
  type WidgetCategory,
  type WidgetDefinition,
} from '@/lib/dashboard/widgets'

const CATEGORY_ORDER: WidgetCategory[] = ['guide', 'kpi', 'chart', 'list']

interface WidgetCatalogueProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Widgets the user may see that are not on the dashboard. */
  available: WidgetDefinition[]
  onAdd: (widget: WidgetDefinition) => void
}

/** "Ajouter un widget": the hidden widgets by kind, each with what it shows. */
export function WidgetCatalogue({ open, onOpenChange, available, onAdd }: WidgetCatalogueProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Ajouter un widget</SheetTitle>
          <SheetDescription>
            Les widgets masqués de votre tableau de bord. Un widget ajouté se place à la fin&nbsp;; déplacez-le ensuite où vous voulez.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          {available.length === 0 ? (
            <p className="text-muted-foreground text-sm">Tous les widgets disponibles sont déjà sur votre tableau de bord.</p>
          ) : (
            CATEGORY_ORDER.map((category) => {
              const widgets = available.filter((w) => w.category === category)
              if (widgets.length === 0) return null
              return (
                <section key={category} aria-labelledby={`catalogue-${category}`} className="space-y-2">
                  <h3 id={`catalogue-${category}`} className="text-muted-foreground text-xs font-medium">
                    {WIDGET_CATEGORY_LABELS[category]}
                  </h3>
                  <ul className="space-y-2">
                    {widgets.map((widget) => (
                      <li key={widget.id} className="flex items-start gap-3 rounded-lg border p-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="text-sm font-medium">{widget.title}</p>
                          <p className="text-muted-foreground text-sm">{widget.description}</p>
                          <p className="text-muted-foreground text-xs">
                            {widget.sizes.length > 1
                              ? `Formats : ${widget.sizes.map((s) => WIDGET_SIZE_LABELS[s].toLowerCase()).join(', ')}`
                              : `Format : ${WIDGET_SIZE_LABELS[widget.defaultSize].toLowerCase()}`}
                          </p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => onAdd(widget)} aria-label={`Ajouter ${widget.title}`}>
                          <Plus aria-hidden />
                          Ajouter
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
