/**
 * The name of the assistant that asked, shown as data between « »: an OAuth
 * client chooses its own name at registration (it could call itself
 * "Kledg"), so it never reads as part of the sentence. Invisible and
 * control characters are dropped and the name is cut short.
 */
export function requesterName(callerName: string | null): string {
  const name = (callerName ?? '').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim()
  if (!name) return 'un assistant'
  return `l'assistant «\u00a0${name.length > 60 ? `${name.slice(0, 59)}\u2026` : name}\u00a0»`
}
