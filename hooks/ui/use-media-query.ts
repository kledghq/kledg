import * as React from "react"

/**
 * Whether a CSS media query matches, kept in sync with the window.
 * False during server rendering and hydration, so a layout
 * chosen with it starts on its wide (desktop) form.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    [query],
  )
  return React.useSyncExternalStore(
    subscribe,
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  )
}

/**
 * Below the `lg` breakpoint (1024px): phones and small tablets, where dense
 * tables become stacked lists.
 */
export const COMPACT_LAYOUT_QUERY = "(max-width: 63.99rem)"

export function useCompactLayout(): boolean {
  return useMediaQuery(COMPACT_LAYOUT_QUERY)
}
