-- Execution mode of full control AI connections (lib/ai-access/access.ts,
-- ExecutionMode): how an assistant (user and OAuth client) or an API key runs
-- the high-impact MCP tools.
--   'automatic'  the tool executes on the call (optional dry run first);
--   'validation' the user approves each action in Kledg before it runs
--                (lib/mcp/full-control/pending-actions.ts).
-- Additive: one column with a default and a check constraint. Existing
-- grants become 'automatic' through the default (owner decision,
-- 2026-10-04). Idempotent.
-- Test: lib/ai-access/__tests__/execution-mode-migration.db.test.ts.

ALTER TABLE "ai_access_grants" ADD COLUMN IF NOT EXISTS "executionMode" TEXT NOT NULL DEFAULT 'automatic';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_access_grants_execution_mode_check') THEN
    ALTER TABLE "ai_access_grants"
      ADD CONSTRAINT "ai_access_grants_execution_mode_check" CHECK ("executionMode" IN ('automatic', 'validation'));
  END IF;
END
$$;
