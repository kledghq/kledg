/**
 * Files shared to Kledg from another app (public/sw.js keeps them in the
 * share cache, on this device only, until the /share page takes them).
 * Read in the page through the Cache API; emptied once they are sent or set
 * aside, so a receipt never stays on the device longer than needed.
 */

/** The cache the service worker writes (SHARE_CACHE in public/sw.js). */
export const SHARE_CACHE = 'kledg-share'

export interface SharedFile {
  key: string
  file: File
}

/** The files of the last share, in the order they were shared; none without the Cache API. */
export async function readSharedFiles(storage: CacheStorage | undefined = globalThis.caches): Promise<SharedFile[]> {
  if (!storage) return []
  const cache = await storage.open(SHARE_CACHE)
  const requests = (await cache.keys()).filter((request) => new URL(request.url).pathname.startsWith('/share/file/'))
  const index = (request: Request) => Number(new URL(request.url).pathname.split('/').pop())
  const out: SharedFile[] = []
  for (const request of requests.sort((a, b) => index(a) - index(b))) {
    const response = await cache.match(request)
    if (!response) continue
    const blob = await response.blob()
    let name = 'justificatif'
    try {
      name = decodeURIComponent(response.headers.get('X-Kledg-File-Name') ?? '') || name
    } catch {
      // A name that does not decode keeps the default
    }
    out.push({ key: request.url, file: new File([blob], name, { type: response.headers.get('Content-Type') ?? blob.type }) })
  }
  return out
}

/** Forgets the shared files (sent, or set aside by the user). */
export async function clearSharedFiles(storage: CacheStorage | undefined = globalThis.caches): Promise<void> {
  if (storage) await storage.delete(SHARE_CACHE)
}
