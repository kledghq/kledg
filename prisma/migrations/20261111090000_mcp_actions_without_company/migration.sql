-- Pending MCP actions outside any company (lib/mcp/full-control/pending-actions.ts).
-- Additive: "companyId" becomes optional.
--
-- create_company (lib/mcp/full-control/companies.ts) is a high-impact full
-- control tool that acts before its company exists: in validation mode its
-- pending action has no company. Such a row is bound to its user only; the
-- row level security policies keep the rows of a company for its members
-- within the narrowed scope, and give a row without company to its own user.

-- AlterTable
ALTER TABLE "mcp_pending_actions" ALTER COLUMN "companyId" DROP NOT NULL;

-- Row level security (docs/rls.md)
DROP POLICY IF EXISTS "kledg_rls_select" ON "mcp_pending_actions";
DROP POLICY IF EXISTS "kledg_rls_insert" ON "mcp_pending_actions";
DROP POLICY IF EXISTS "kledg_rls_update" ON "mcp_pending_actions";
DROP POLICY IF EXISTS "kledg_rls_delete" ON "mcp_pending_actions";
CREATE POLICY "kledg_rls_select" ON "mcp_pending_actions" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR (("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) OR "companyId" IS NULL) AND "userId" = (SELECT kledg_rls_user_id()))));
CREATE POLICY "kledg_rls_insert" ON "mcp_pending_actions" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR (("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) OR "companyId" IS NULL) AND "userId" = (SELECT kledg_rls_user_id()))));
CREATE POLICY "kledg_rls_update" ON "mcp_pending_actions" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR (("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) OR "companyId" IS NULL) AND "userId" = (SELECT kledg_rls_user_id())))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR (("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) OR "companyId" IS NULL) AND "userId" = (SELECT kledg_rls_user_id()))));
CREATE POLICY "kledg_rls_delete" ON "mcp_pending_actions" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR (("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) OR "companyId" IS NULL) AND "userId" = (SELECT kledg_rls_user_id()))));
