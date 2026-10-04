/**
 * Keeps each Prisma query in the row level security context of its caller
 * (docs/rls.md#applying-the-context-to-a-connection).
 *
 * Prisma merges the `findUnique` calls of the same shape issued in the same
 * tick into one query (its DataLoader, keyed by `batchBy`) and dispatches
 * them from a `process.nextTick` callback: in the async context of the first
 * call. With two concurrent requests, the second one's lookup would run with
 * the first one's context and could read what only the first user may see.
 * So with KLEDG_RLS=enforce, calls outside a transaction are never batched:
 * each runs at once, in its caller's context. Calls inside a transaction
 * keep Prisma's batching: they run on the transaction's connection, whose
 * context was set when it started.
 *
 * This reaches into Prisma's request handler (`_requestHandler.dataloader`),
 * not a public API: `isolatePrismaBatches` throws when it is missing, and
 * lib/rls/__tests__/tenant-isolation.db.test.ts checks the behaviour on every
 * Prisma upgrade.
 */

type BatchBy = (request: unknown) => string | undefined

interface DataLoaderOptions {
  batchBy: BatchBy
}

export function isolatePrismaBatches(client: object): void {
  const options = (client as { _requestHandler?: { dataloader?: { options?: DataLoaderOptions } } })._requestHandler
    ?.dataloader?.options
  if (!options || typeof options.batchBy !== 'function') {
    throw new Error('KLEDG_RLS=enforce: Prisma request batching changed (lib/rls/batching.ts needs an update)')
  }
  const original = options.batchBy.bind(options)
  options.batchBy = (request) => ((request as { transaction?: unknown }).transaction ? original(request) : undefined)
}
