-- Standard display mode and personal sidebar menus (docs/modes-et-menu.md).
--
-- user_preferences.displayMode: a third value, 'standard' (the expert pages
-- with a sidebar of the day-to-day pages only). The check constraint is
-- replaced by one that also accepts it; stored values are unchanged.
--
-- sidebar_preferences: what one user hid from their sidebar in one company,
-- on top of their display mode. "hiddenItems" holds the company-relative URLs
-- of hidden entries ('/banking/statements'), "hiddenGroups" the stable ids of
-- hidden groups ('saisie'), both validated by the application
-- (components/layout/sidebar-menu.ts drops unknown ids). Without a row the
-- whole menu of the mode shows. Deleting the user or the company deletes it.
--
-- Additive: one new table, one widened check constraint.
--
-- Row level security (docs/rls.md): a "company and user" table like
-- dashboard_layouts: the company is reachable and the row is the acting
-- user's, or the context is unrestricted.

-- AlterTable
ALTER TABLE "user_preferences" DROP CONSTRAINT "user_preferences_displayMode_check";
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_displayMode_check" CHECK ("displayMode" IS NULL OR "displayMode" IN ('simple', 'standard', 'expert'));

-- CreateTable
CREATE TABLE "sidebar_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "hiddenItems" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "hiddenGroups" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sidebar_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sidebar_preferences_userId_companyId_key" ON "sidebar_preferences"("userId", "companyId");

-- CreateIndex
CREATE INDEX "sidebar_preferences_companyId_idx" ON "sidebar_preferences"("companyId");

-- AddForeignKey
ALTER TABLE "sidebar_preferences" ADD CONSTRAINT "sidebar_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sidebar_preferences" ADD CONSTRAINT "sidebar_preferences_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row level security
ALTER TABLE "sidebar_preferences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "sidebar_preferences" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR ("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) AND "userId" = (SELECT kledg_rls_user_id()))));
CREATE POLICY "kledg_rls_insert" ON "sidebar_preferences" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR ("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) AND "userId" = (SELECT kledg_rls_user_id()))));
CREATE POLICY "kledg_rls_update" ON "sidebar_preferences" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR ("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) AND "userId" = (SELECT kledg_rls_user_id())))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR ("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) AND "userId" = (SELECT kledg_rls_user_id()))));
CREATE POLICY "kledg_rls_delete" ON "sidebar_preferences" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR ("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) AND "userId" = (SELECT kledg_rls_user_id()))));
