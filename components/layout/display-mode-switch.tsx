"use client"

import { useState } from "react"
import { useParams, usePathname, useRouter } from "next/navigation"
import { toast } from "sonner"

import { companyHomePath, DISPLAY_MODE_LABELS, DISPLAY_MODES, type DisplayMode } from "@/lib/appearance/display-mode"
import { accountApi } from "@/components/features/account/account-api"
import { groupHomePath, groupRelativePath } from "@/components/layout/group-nav-config"
import { Eye } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * Display mode menu in the header of company pages (docs/mode-simple.md):
 * an eye icon opening the Simple / Expert choice, like the theme menu. Saves the user's display mode, then opens the home
 * of the chosen mode in the current company. The same choice is on
 * Paramètres, Apparence. In the group space it opens the group's home of
 * the chosen mode.
 */
export function DisplayModeSwitch({ mode }: { mode: DisplayMode }) {
  const router = useRouter()
  const params = useParams()
  const companyId = params?.companyId as string | undefined
  const pathname = usePathname() ?? ""
  // On a page of the group space, the group's home of the chosen mode (docs/vue-groupe.md).
  const inGroup = companyId !== undefined && groupRelativePath(pathname.slice(companyId.length + 1)) !== null
  const [current, setCurrent] = useState<DisplayMode>(mode)
  const [saving, setSaving] = useState(false)

  async function choose(next: DisplayMode) {
    if (next === current || saving) return
    const previous = current
    setCurrent(next)
    setSaving(true)
    try {
      await accountApi("/api/account/display-mode", { method: "PUT", body: { mode: next } })
      if (companyId) router.push(inGroup ? groupHomePath(companyId, next) : companyHomePath(companyId, next))
      router.refresh()
    } catch (error) {
      setCurrent(previous)
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={saving}>
        <Button variant="ghost" size="icon-sm" aria-label={`Affichage\u00a0: ${DISPLAY_MODE_LABELS[current]}`}>
          <Eye aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Affichage</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current} onValueChange={(value) => void choose(value as DisplayMode)}>
          {DISPLAY_MODES.map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {DISPLAY_MODE_LABELS[value]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
