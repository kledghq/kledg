/** "12 k€" on a chart axis; the tooltip shows the full amount. */
export function compactEuros(value: number): string {
  if (Math.abs(value) >= 1000) return `${Math.round(value / 1000)} k€`
  return `${Math.round(value)} €`
}
