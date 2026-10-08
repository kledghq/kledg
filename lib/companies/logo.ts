/**
 * Company logos are rendered server-side by react-pdf, which fetches any URL
 * or reads any path it is given. Only inline images (data: URLs) and https
 * URLs on an explicit allowlist are accepted, at write time and again at
 * render time.
 */

import { ValidationError } from '@/lib/accounting/errors'

/** Largest accepted data: URL (about 1.5 MB of image). */
const MAX_LOGO_DATA_URL_LENGTH = 2 * 1024 * 1024

const DATA_URL = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/

/** Hosts allowed for https logo URLs: LOGO_ALLOWED_HOSTS, comma separated (empty by default). */
function allowedLogoHosts(): string[] {
  return (process.env.LOGO_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
}

/** Null when the logo is acceptable, else a French error message. */
export function logoError(value: string): string | null {
  if (value.startsWith('data:')) {
    if (value.length > MAX_LOGO_DATA_URL_LENGTH) return 'Logo trop volumineux (1,5 Mo maximum).'
    return DATA_URL.test(value) ? null : 'Format de logo non pris en charge (PNG, JPEG, GIF ou WebP).'
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'Logo invalide : importez une image ou indiquez une adresse https.'
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    return 'Logo invalide : seules les adresses https sont acceptées.'
  }
  if (!allowedLogoHosts().includes(url.hostname.toLowerCase())) {
    return "Logo refusé : importez l'image plutôt que d'indiquer une adresse externe."
  }
  return null
}

/**
 * Normalizes a logo from a request body: undefined (unchanged), null (removed)
 * or a validated value. Throws a ValidationError otherwise.
 */
export function parseLogoInput(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string') throw new ValidationError('Logo invalide.')
  const error = logoError(value)
  if (error) throw new ValidationError(error)
  return value
}

/** The logo if it is still safe to hand to the PDF renderer, else null. */
export function safeLogoSrc(value: string | null | undefined): string | null {
  if (!value) return null
  return logoError(value) === null ? value : null
}
