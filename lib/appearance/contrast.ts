/**
 * Contrast of chart colours (WCAG 2.2). Pure, no imports: used by the
 * settings page to warn about a colour that is hard to see on the card.
 *
 * Chart marks are graphical objects needed to read the chart, so the
 * non-text contrast criterion applies (WCAG 2.2, 1.4.11): at least 3:1
 * against the adjacent colour, here the card background.
 */

/** WCAG 2.2, 1.4.11 Non-text Contrast. */
export const NON_TEXT_MIN_CONTRAST = 3

function channel(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Relative luminance of a `#rrggbb` colour (WCAG 2.2 definition), from 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!match) throw new Error(`Not a #rrggbb colour: ${hex}`)
  const [r, g, b] = match.slice(1).map((part) => channel(parseInt(part, 16)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contrast ratio between two `#rrggbb` colours, from 1 (same) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** Whether a chart colour is visible enough on `background` (3:1). */
export function meetsNonTextContrast(color: string, background: string): boolean {
  return contrastRatio(color, background) >= NON_TEXT_MIN_CONTRAST
}

/** "2,6:1" in French notation, rounded down so 2.99 never reads as 3. */
export function formatContrastRatio(ratio: number): string {
  return `${(Math.floor(ratio * 10) / 10).toFixed(1).replace('.', ',')}:1`
}
