-- GitHub connection of the "Mises à jour" page (one row per instance).
-- Additive: new table only.

-- CreateTable
CREATE TABLE "update_connection" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "tokenLast4" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "isFork" BOOLEAN NOT NULL DEFAULT false,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "connectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "update_connection_pkey" PRIMARY KEY ("id")
);
