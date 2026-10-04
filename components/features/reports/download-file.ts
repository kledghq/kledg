'use client'

import { responseError } from '@/hooks/use-cursor-list'

/** File name of a Content-Disposition header (RFC 6266 filename* first). */
export function fileNameOf(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (star) {
    try {
      return decodeURIComponent(star[1])
    } catch {
      return fallback
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition)
  return plain ? plain[1] : fallback
}

/** Downloads a generated file from an export route; throws the French error of a refused export. */
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(await responseError(response, "L'export n'a pas abouti. Réessayez dans un instant."))
  const blob = await response.blob()
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = fileNameOf(response.headers.get('Content-Disposition'), fallbackName)
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(href)
}
