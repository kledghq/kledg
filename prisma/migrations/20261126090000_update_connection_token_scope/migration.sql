-- Scope of the GitHub token of the update connection (lib/updates/connection.ts,
-- KLEDG-R3-INPUT-05): true when, at connection, the token listed another
-- private repository than the instance's own (created with "All repositories"
-- instead of "Only select repositories"); the Mises à jour page then warns.
-- Null: not checked (connected before this column, or GitHub did not answer).
--
-- Additive: one nullable column, no new table.

-- AlterTable
ALTER TABLE "update_connection" ADD COLUMN "tokenReachesOtherRepos" BOOLEAN;
