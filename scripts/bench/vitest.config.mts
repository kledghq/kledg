import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * Hot path benchmark (scripts/bench/hot-paths.perf.ts), kept out of
 * `pnpm test:run`: it creates a large throwaway database and takes minutes.
 *
 *   pnpm vitest run --config scripts/bench/vitest.config.mts
 *
 * Variables are documented in hot-paths.perf.ts.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '../..'),
    },
  },
  test: {
    root: path.resolve(import.meta.dirname, '../..'),
    include: ['scripts/bench/**/*.perf.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30 * 60_000,
    hookTimeout: 30 * 60_000,
  },
})
