"use client"

import { Info } from "lucide-react"

import type { NavGroup } from "@/components/layout/nav-config"
import { isGroupHideable, isItemHideable, toggleGroup, toggleItem } from "@/components/layout/sidebar-menu"
import { isNothingHidden, type SidebarHidden } from "@/lib/navigation/sidebar-preferences"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

/**
 * "Personnaliser le menu" (docs/modes-et-menu.md): a switch per group and a
 * box per entry of the menu of the user's mode in this company. Every change
 * applies at once (`onChange`, saved by the sidebar). The home entry is
 * always shown and its group has no switch, so the menu never empties and
 * this editor, which is not an entry, stays reachable. Hiding the page the
 * user is on is allowed, with the reason it stays open.
 */
export function SidebarMenuEditor({
  open,
  onOpenChange,
  groups,
  hidden,
  onChange,
  currentUrl,
  companyName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The menu of the mode, filtered for the company (companyNavGroups). */
  groups: readonly NavGroup[]
  hidden: SidebarHidden
  onChange: (next: SidebarHidden) => void
  /** URL of the entry of the current page, when the menu lists it. */
  currentUrl?: string
  companyName?: string | null
}) {
  const hiddenItems = new Set(hidden.hiddenItems)
  const hiddenGroups = new Set(hidden.hiddenGroups)
  const groupHidden = (group: NavGroup) => isGroupHideable(group) && hiddenGroups.has(group.id)
  const currentGroup = currentUrl ? groups.find((group) => group.items.some((item) => item.url === currentUrl)) : undefined
  const currentHidden = currentUrl !== undefined && (hiddenItems.has(currentUrl) || (currentGroup !== undefined && groupHidden(currentGroup)))
  const visibleGroups = groups.filter((group) => group.items.length > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Personnaliser le menu</DialogTitle>
          <DialogDescription>
            {companyName ? <>Pour cette société&nbsp;: {companyName}. </> : <>Pour cette société. </>}
            Les pages masquées restent accessibles par leur adresse et par les liens. Ce réglage ne concerne que vous.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 max-h-[60vh] space-y-4 overflow-y-auto pr-3 pl-1">
          {visibleGroups.map((group) => {
            const isHidden = groupHidden(group)
            const headingId = `sidebar-editor-${group.id}`
            return (
              <section key={group.id} aria-labelledby={group.label ? headingId : undefined} className="space-y-2">
                {group.label ? (
                  <div className="flex items-center justify-between gap-3">
                    <h3 id={headingId} className="text-sm font-semibold">
                      {group.label}
                    </h3>
                    {isGroupHideable(group) ? (
                      <Switch
                        checked={!isHidden}
                        onCheckedChange={(shown) => onChange(toggleGroup(hidden, group.id, !shown))}
                        aria-label={`Afficher le groupe ${group.label}`}
                      />
                    ) : null}
                  </div>
                ) : null}
                <ul className="space-y-1.5">
                  {group.items.map((item) => {
                    const id = `sidebar-editor-item-${item.url.replace(/\//g, "-")}`
                    const fixed = !isItemHideable(item.url)
                    return (
                      <li key={item.url} className="flex items-center gap-2">
                        <Checkbox
                          id={id}
                          checked={fixed || !hiddenItems.has(item.url)}
                          disabled={fixed || isHidden}
                          onCheckedChange={(checked) => onChange(toggleItem(hidden, item.url, checked !== true))}
                        />
                        <Label htmlFor={id} className="flex min-w-0 flex-1 items-center gap-2 font-normal">
                          <item.icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
                          <span className="truncate">{item.title}</span>
                          {item.url === currentUrl ? (
                            <Badge variant="outline" className="shrink-0">
                              Page actuelle
                            </Badge>
                          ) : null}
                          {fixed ? <span className="text-muted-foreground ml-auto shrink-0 text-xs">Toujours affiché</span> : null}
                        </Label>
                      </li>
                    )
                  })}
                </ul>
                {isHidden ? <p className="text-muted-foreground text-xs">Groupe masqué du menu.</p> : null}
              </section>
            )
          })}
        </div>
        {currentHidden ? (
          <Alert>
            <Info aria-hidden />
            <AlertDescription>
              Vous êtes sur cette page&nbsp;: elle reste ouverte. Le menu indique «&nbsp;Page masquée du menu&nbsp;» avec un lien pour la
              réafficher.
            </AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={isNothingHidden(hidden)} onClick={() => onChange({ hiddenItems: [], hiddenGroups: [] })}>
            Afficher tout
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Terminé
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
