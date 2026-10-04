import "dotenv/config";
import { defineConfig } from "prisma/config";

// Migrations use the direct (non-pooled) connection of the role that owns the
// schema: DATABASE_MIGRATION_URL when the application connects as another
// role (KLEDG_RLS=enforce, docs/rls.md), else the unpooled URL.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url:
      process.env.DATABASE_MIGRATION_URL ||
      process.env.DATABASE_URL_UNPOOLED ||
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      // Clever Cloud PostgreSQL add-on (see lib/prisma.ts).
      process.env.POSTGRESQL_ADDON_URI ||
      "",
  },
});
