'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { themeColorFor } from '@/lib/pwa/theme-color'

/**
 * Keeps the browser bar (meta theme-color, status bar of the installed app)
 * on the theme chosen with the header toggle, not only on the system
 * setting (lib/pwa/theme-color.ts). Bundled client code, no inline script
 * (page CSP). Applied again after each navigation, in case the metadata
 * tags are rendered again. Renders nothing.
 */
export function ThemeColorSync() {
  const { theme } = useTheme()
  const pathname = usePathname()

  useEffect(() => {
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      const color = themeColorFor(theme, meta.getAttribute('media'))
      if (meta.content !== color) meta.content = color
    }
  }, [theme, pathname])

  return null
}
