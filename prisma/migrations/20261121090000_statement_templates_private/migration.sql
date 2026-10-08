-- KLEDG-R3-AUTHZ-01: balance sheet and income statement layout templates are
-- shared across the instance only when Kledg provides them: a row without
-- company, written by an unrestricted context (a migration, an operator). A
-- template a company saves stays its own; its administrators used to be able
-- to publish one to every tenant of the instance, with nobody able to remove it.
--
-- 1. Templates a company published go back to that company, private. The
--    company is the one of the saved layout (configData.companyId).
-- 2. A published template whose company is gone is hidden (no longer public).
-- 3. Writes of a row without company need an unrestricted context; a user
--    context writes and deletes only the templates of its companies. Reads
--    are unchanged (a company's own templates and Kledg's public ones).
--
-- Additive: no column or table change; existing rows are only reassigned.

-- balance_sheet_config_templates
UPDATE "balance_sheet_config_templates" t
SET "companyId" = t."configData"->>'companyId', "isPublic" = false
WHERE t."companyId" IS NULL
  AND EXISTS (SELECT 1 FROM "companies" c WHERE c."id" = t."configData"->>'companyId');
UPDATE "balance_sheet_config_templates" SET "isPublic" = false WHERE "companyId" IS NULL AND "createdBy" IS NOT NULL;

DROP POLICY IF EXISTS "kledg_rls_insert" ON "balance_sheet_config_templates";
DROP POLICY IF EXISTS "kledg_rls_update" ON "balance_sheet_config_templates";
DROP POLICY IF EXISTS "kledg_rls_delete" ON "balance_sheet_config_templates";
CREATE POLICY "kledg_rls_insert" ON "balance_sheet_config_templates" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "balance_sheet_config_templates" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "balance_sheet_config_templates" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- income_statement_config_templates
UPDATE "income_statement_config_templates" t
SET "companyId" = t."configData"->>'companyId', "isPublic" = false
WHERE t."companyId" IS NULL
  AND EXISTS (SELECT 1 FROM "companies" c WHERE c."id" = t."configData"->>'companyId');
UPDATE "income_statement_config_templates" SET "isPublic" = false WHERE "companyId" IS NULL AND "createdBy" IS NOT NULL;

DROP POLICY IF EXISTS "kledg_rls_insert" ON "income_statement_config_templates";
DROP POLICY IF EXISTS "kledg_rls_update" ON "income_statement_config_templates";
DROP POLICY IF EXISTS "kledg_rls_delete" ON "income_statement_config_templates";
CREATE POLICY "kledg_rls_insert" ON "income_statement_config_templates" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "income_statement_config_templates" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "income_statement_config_templates" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
