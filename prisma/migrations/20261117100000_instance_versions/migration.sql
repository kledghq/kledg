-- Update history of the instance ("Historique des mises à jour" on the
-- "Mises à jour" page, lib/updates/history.ts): one row per version and
-- commit the instance has run, written at server start.
-- Additive: new table only.
--
-- Row level security (docs/rls.md): instance table without tenant data, read
-- by instance administrators only (checked by the route), exempt like
-- update_connection.
--
-- The unique index is NULLS NOT DISTINCT (PostgreSQL 15+, the minimum Kledg
-- supports): two servers starting at once without a known commit insert one
-- row, not two.

-- CreateTable
CREATE TABLE "instance_versions" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "commit" TEXT,
    "branch" TEXT,
    "platform" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousVersion" TEXT,
    "previousCommit" TEXT,
    "installedByUserId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'external',
    "migrations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "migrationsKnown" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "instance_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instance_versions_version_commit_key" ON "instance_versions"("version", "commit") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "instance_versions_firstSeenAt_idx" ON "instance_versions"("firstSeenAt");
