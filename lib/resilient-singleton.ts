/**
 * A singleton whose asynchronous initialization may fail transiently, made
 * from scratch again after a failure instead of staying broken.
 *
 * Why: Better Auth starts its context as soon as the instance is created,
 * and its OAuth provider plugin seeds the MCP resource with a database query
 * at that moment. On a scale-to-zero database (Neon) waking up, that query
 * can time out: the context promise rejects with nobody awaiting it yet (an
 * unhandled rejection, which ends the serverless process) and every later
 * call of the same instance fails with it. Seen on the demo as "Erreur
 * inattendue" on /companies right after signing in (digest 1800116984,
 * "Connection terminated due to connection timeout" in
 * oauthResource.findFirst).
 *
 * The returned proxy creates the instance on first use, observes its
 * initialization (so a failure is never unhandled) and drops the instance
 * when it fails, so the next access starts a fresh one. Pure: no imports.
 */
export function resilientSingleton<T extends object>(
  create: () => T,
  initOf: (instance: T) => Promise<unknown>,
  onFailure: (error: unknown) => void,
): T {
  let current: T | null = null
  const instance = (): T => {
    if (current) return current
    const created = create()
    current = created
    initOf(created).catch((error: unknown) => {
      onFailure(error)
      if (current === created) current = null
    })
    return created
  }
  return new Proxy({} as T, {
    get: (_target, property) => Reflect.get(instance(), property),
    has: (_target, property) => Reflect.has(instance(), property),
  })
}
