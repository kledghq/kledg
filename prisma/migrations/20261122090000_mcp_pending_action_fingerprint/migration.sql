-- Approval of a high-impact MCP action bound to the data it acts on
-- (lib/mcp/full-control/define.ts, finding KLEDG-R3-MCP-01).
--
-- mcp_pending_actions."fingerprint": SHA-256 of the state the user approved
-- (the dry run and the rows the action targets: entries with their lines,
-- invoices, rules...), computed when the action is prepared. At execution
-- the tool computes it again and refuses the action when the data changed
-- since the approval. Null for an action prepared before this column: it
-- is refused and must be prepared again (actions expire after 30 minutes).
--
-- Additive: one nullable column. No new table, so no row level security change.

-- AlterTable
ALTER TABLE "mcp_pending_actions" ADD COLUMN "fingerprint" TEXT;
