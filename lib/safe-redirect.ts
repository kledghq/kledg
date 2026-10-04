/**
 * Validates a post-login redirect target taken from the URL (?redirect=).
 * Only same-origin relative paths are accepted ("/acme/entries?x=1"); absolute
 * URLs, protocol-relative ("//evil.com"), backslash tricks ("/\\evil.com"),
 * javascript: and control characters fall back to `fallback`.
 */
export function safeRedirectPath(value: string | null | undefined, fallback = '/'): string {
  if (!value || value.length > 2048) return fallback
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback
  try {
    const base = 'http://kledg.invalid'
    const url = new URL(value, base)
    if (url.origin !== base) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}
