import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  test: {
    globals: true,
    // Database tests create and migrate their own database in beforeAll; with
    // the whole suite in parallel, 5 s is not always enough.
    testTimeout: 20_000,
    hookTimeout: 60_000,
    exclude: ['**/node_modules/**', '.next', 'dist', '.claude/**'],
    // `pnpm test:coverage`: source files of the app only (tests, generated
    // Prisma client and type declarations excluded). Run it with the database
    // tests enabled (KLEDG_REQUIRE_TEST_DB=1), or the services they cover read
    // as untested.
    coverage: {
      provider: 'v8',
      include: ['app/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'hooks/**/*.{ts,tsx}'],
      exclude: ['**/__tests__/**', '**/*.test.{ts,tsx}', '**/*.d.ts', 'lib/generated/**'],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['**/*.test.ts'],
          exclude: [
            '**/node_modules/**',
            '.claude/**',
            '.next',
            'dist',
            'components/**',
            'hooks/**',
            'app/**/*.test.tsx',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['**/*.test.tsx', 'components/**/*.test.ts', 'hooks/**/*.test.ts'],
          exclude: ['**/node_modules/**', '.next', 'dist', '.claude/**'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
  },
})
