-- Row level security: tenant isolation in the database (docs/rls.md).
--
-- Additive. Policies are created on every tenant table, but nothing changes
-- for an existing install:
-- - the policies never apply to the table owner (RLS is enabled, not
--   forced), and single-role installs connect as the owner;
-- - until `pnpm db:rls-role` switches kledg_rls_enforced() to true, the
--   policies let every role through, so an install whose application role
--   is not the owner keeps working too.
-- With KLEDG_RLS=enforce the application connects as a non-owner role and
-- sets its context per transaction (lib/rls):
--   kledg.access         'user' | 'system' | 'anonymous'
--   kledg.user_id        the acting user ('user')
--   kledg.company_scope  text array literal narrowing the companies, or empty
-- Tests: lib/rls/__tests__ (policy coverage, tenant isolation).

-- ---------------------------------------------------------------------------
-- Context and access functions
-- ---------------------------------------------------------------------------

-- Switched to `SELECT true` by `pnpm db:rls-role` (scripts/rls-role.ts), run
-- by the owner. IMMUTABLE: folded into each plan, so the switch costs nothing.
CREATE OR REPLACE FUNCTION kledg_rls_enforced() RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT false
$$;

-- The acting user ('user' contexts only). Plain SQL: inlined into the
-- policies of the user scoped tables.
CREATE OR REPLACE FUNCTION kledg_rls_user_id() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN current_setting('kledg.access', true) = 'user'
    THEN nullif(current_setting('kledg.user_id', true), '') END
$$;

-- The companies the context is narrowed to, NULL for no narrowing. A
-- malformed literal raises an error (fails closed).
CREATE OR REPLACE FUNCTION kledg_rls_scope() RETURNS text[]
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('kledg.company_scope', true), '')::text[]
$$;

-- Whether the context reaches every row: RLS not switched on yet, a system
-- context without scope, or an active instance administrator without scope
-- (isGlobalAdmin in lib/rbac/authorize.ts, read from the database: the
-- application cannot make a user an administrator by a flag). Banned users
-- follow getCurrentUser (lib/session.ts). PL/pgSQL so that its query plan is
-- cached per connection; SECURITY DEFINER to read "user" whatever its access.
CREATE OR REPLACE FUNCTION kledg_rls_unrestricted() RETURNS boolean
LANGUAGE plpgsql STABLE PARALLEL SAFE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  access text := current_setting('kledg.access', true);
BEGIN
  IF NOT kledg_rls_enforced() THEN
    RETURN true;
  END IF;
  IF kledg_rls_scope() IS NOT NULL THEN
    RETURN false;
  END IF;
  IF access = 'system' THEN
    RETURN true;
  END IF;
  IF access IS DISTINCT FROM 'user' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM "user" u
    WHERE u."id" = kledg_rls_user_id() AND u."role" = 'admin'
      AND (u."banned" IS NOT TRUE OR (u."banExpires" IS NOT NULL AND u."banExpires" <= (now() AT TIME ZONE 'UTC')))
  );
END;
$$;

-- The companies the context reaches when it is not unrestricted: the scope
-- for system contexts and administrators; for an active user, the companies
-- of their memberships within the scope; nothing otherwise. Reads "user",
-- member and organization as the owner (their own policies would recurse).
CREATE OR REPLACE FUNCTION kledg_rls_company_ids() RETURNS text[]
LANGUAGE plpgsql STABLE PARALLEL SAFE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  access text := current_setting('kledg.access', true);
  scope text[] := kledg_rls_scope();
  acting text := kledg_rls_user_id();
  role text;
  ids text[];
BEGIN
  IF access = 'system' THEN
    RETURN coalesce(scope, '{}'::text[]);
  END IF;
  IF acting IS NULL THEN
    RETURN '{}'::text[];
  END IF;
  SELECT coalesce(u."role", '') INTO role FROM "user" u
  WHERE u."id" = acting
    AND (u."banned" IS NOT TRUE OR (u."banExpires" IS NOT NULL AND u."banExpires" <= (now() AT TIME ZONE 'UTC')));
  IF NOT FOUND THEN
    RETURN '{}'::text[];
  END IF;
  IF role = 'admin' THEN
    RETURN coalesce(scope, '{}'::text[]);
  END IF;
  SELECT array_agg(o."companyId") INTO ids
  FROM "member" m
  JOIN "organization" o ON o."id" = m."organizationId"
  WHERE m."userId" = acting
    AND o."companyId" IS NOT NULL
    AND (scope IS NULL OR o."companyId" = ANY (scope));
  RETURN coalesce(ids, '{}'::text[]);
END;
$$;

-- Instance-wide uniqueness of a company's SIREN and slug: whether another
-- company holds the value, whatever the context (a user renaming their
-- company cannot see the others). Answers a boolean only, which the unique
-- indexes reveal anyway; never which company. lib/companies/identifiers.ts
CREATE OR REPLACE FUNCTION kledg_company_identifier_taken(field text, value text, except_company_id text)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM "companies" c
    WHERE c."id" IS DISTINCT FROM except_company_id
      AND CASE field WHEN 'siren' THEN c."siren" = value WHEN 'slug' THEN c."slug" = value ELSE false END
  )
$$;

-- ---------------------------------------------------------------------------
-- Integrity triggers see every row, whatever the context
-- ---------------------------------------------------------------------------
-- Triggers run as the role of the statement: under RLS, a lock that reads
-- the fiscal year or the entry of a row it cannot see would let the change
-- through. As SECURITY DEFINER they read as the owner, like foreign keys.

ALTER FUNCTION kledg_assert_fiscal_year_open(text) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION kledg_lock_closed_year_entries() SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION kledg_lock_closed_year_entry_lines() SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION kledg_lock_closed_fiscal_years() SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION kledg_guard_accounting_entry() SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION kledg_guard_entry_line() SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION kledg_guard_company_delete() SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION kledg_delete_grant_on_consent_delete() SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION kledg_revoke_tokens_on_consent_delete() SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION kledg_narrow_tokens_on_consent_update() SECURITY DEFINER SET search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- Denormalized companyId on the two large child tables
-- ---------------------------------------------------------------------------
-- A policy through the parent (EXISTS) runs once per row read: the trial
-- balance of the benchmark went from 38 ms to 167 ms with it, 47 ms with a
-- companyId column (docs/rls.md). The column is the parent's company, set by
-- the database; the application never writes it.

ALTER TABLE "entry_lines" ADD COLUMN "companyId" TEXT;
ALTER TABLE "bank_transactions" ADD COLUMN "companyId" TEXT;

-- Backfill before the triggers exist (the line guards let a companyId change
-- through: it is not part of an entry's content).
UPDATE "entry_lines" l SET "companyId" = e."companyId"
FROM "accounting_entries" e WHERE e."id" = l."accountingEntryId";

UPDATE "bank_transactions" t SET "companyId" = c."companyId"
FROM "bank_accounts" a JOIN "bank_connections" c ON c."id" = a."bankConnectionId"
WHERE a."id" = t."bankAccountId";

CREATE INDEX "entry_lines_companyId_idx" ON "entry_lines"("companyId");
CREATE INDEX "bank_transactions_companyId_idx" ON "bank_transactions"("companyId");

CREATE OR REPLACE FUNCTION kledg_rls_entry_line_company() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW."companyId" := (SELECT e."companyId" FROM "accounting_entries" e WHERE e."id" = NEW."accountingEntryId");
  RETURN NEW;
END;
$$;

CREATE TRIGGER "entry_lines_rls_company"
BEFORE INSERT OR UPDATE OF "accountingEntryId", "companyId" ON "entry_lines"
FOR EACH ROW EXECUTE FUNCTION kledg_rls_entry_line_company();

CREATE OR REPLACE FUNCTION kledg_rls_bank_transaction_company() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW."companyId" := (
    SELECT c."companyId" FROM "bank_accounts" a
    JOIN "bank_connections" c ON c."id" = a."bankConnectionId"
    WHERE a."id" = NEW."bankAccountId"
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "bank_transactions_rls_company"
BEFORE INSERT OR UPDATE OF "bankAccountId", "companyId" ON "bank_transactions"
FOR EACH ROW EXECUTE FUNCTION kledg_rls_bank_transaction_company();

-- A parent moved to another company takes its children along (the BEFORE
-- triggers above recompute the column).
CREATE OR REPLACE FUNCTION kledg_rls_entry_moved() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE "entry_lines" SET "companyId" = NULL WHERE "accountingEntryId" = NEW."id";
  RETURN NULL;
END;
$$;

CREATE TRIGGER "accounting_entries_rls_company"
AFTER UPDATE OF "companyId" ON "accounting_entries"
FOR EACH ROW WHEN (OLD."companyId" IS DISTINCT FROM NEW."companyId")
EXECUTE FUNCTION kledg_rls_entry_moved();

CREATE OR REPLACE FUNCTION kledg_rls_bank_account_moved() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE "bank_transactions" SET "companyId" = NULL WHERE "bankAccountId" = NEW."id";
  RETURN NULL;
END;
$$;

CREATE TRIGGER "bank_accounts_rls_company"
AFTER UPDATE OF "bankConnectionId" ON "bank_accounts"
FOR EACH ROW WHEN (OLD."bankConnectionId" IS DISTINCT FROM NEW."bankConnectionId")
EXECUTE FUNCTION kledg_rls_bank_account_moved();

CREATE OR REPLACE FUNCTION kledg_rls_bank_connection_moved() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE "bank_transactions" t SET "companyId" = NULL
  FROM "bank_accounts" a
  WHERE a."id" = t."bankAccountId" AND a."bankConnectionId" = NEW."id";
  RETURN NULL;
END;
$$;

CREATE TRIGGER "bank_connections_rls_company"
AFTER UPDATE OF "companyId" ON "bank_connections"
FOR EACH ROW WHEN (OLD."companyId" IS DISTINCT FROM NEW."companyId")
EXECUTE FUNCTION kledg_rls_bank_connection_moved();

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
-- Every tenant table: RLS enabled and four policies. The functions are called
-- through scalar subqueries, evaluated once per statement (InitPlan).
-- Exempt tables (Better Auth, rate limits, the update connection) are listed
-- with their reason in lib/rls/tables.ts.

-- companies
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "companies" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "id" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "companies" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "id" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "companies" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "id" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "id" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "companies" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "id" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- addresses
ALTER TABLE "addresses" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "addresses" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "addresses" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "addresses" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "addresses" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- establishments
ALTER TABLE "establishments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "establishments" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "establishments" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "establishments" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "establishments" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- shareholders
ALTER TABLE "shareholders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "shareholders" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "shareholders" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "shareholders" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "shareholders" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- fiscal_years
ALTER TABLE "fiscal_years" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "fiscal_years" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "fiscal_years" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "fiscal_years" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "fiscal_years" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- accounts
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "accounts" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "accounts" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "accounts" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "accounts" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- journals
ALTER TABLE "journals" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "journals" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "journals" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "journals" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "journals" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- accounting_entries
ALTER TABLE "accounting_entries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "accounting_entries" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "accounting_entries" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "accounting_entries" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "accounting_entries" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- bank_connections
ALTER TABLE "bank_connections" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "bank_connections" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "bank_connections" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "bank_connections" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "bank_connections" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- transaction_rules
ALTER TABLE "transaction_rules" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "transaction_rules" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "transaction_rules" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "transaction_rules" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "transaction_rules" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- integrations
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "integrations" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "integrations" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "integrations" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "integrations" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- import_jobs
ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "import_jobs" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "import_jobs" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "import_jobs" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "import_jobs" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- fixed_assets
ALTER TABLE "fixed_assets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "fixed_assets" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "fixed_assets" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "fixed_assets" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "fixed_assets" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- fixed_asset_depreciations
ALTER TABLE "fixed_asset_depreciations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "fixed_asset_depreciations" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "fixed_asset_depreciations" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "fixed_asset_depreciations" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "fixed_asset_depreciations" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- tax_regime_history
ALTER TABLE "tax_regime_history" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "tax_regime_history" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "tax_regime_history" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "tax_regime_history" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "tax_regime_history" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- attachments
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "attachments" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "attachments" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "attachments" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "attachments" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- balance_sheet_line_configs
ALTER TABLE "balance_sheet_line_configs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "balance_sheet_line_configs" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "balance_sheet_line_configs" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "balance_sheet_line_configs" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "balance_sheet_line_configs" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- income_statement_line_configs
ALTER TABLE "income_statement_line_configs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "income_statement_line_configs" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "income_statement_line_configs" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "income_statement_line_configs" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "income_statement_line_configs" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- company_onboarding
ALTER TABLE "company_onboarding" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "company_onboarding" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "company_onboarding" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "company_onboarding" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "company_onboarding" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- tiers
ALTER TABLE "tiers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "tiers" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "tiers" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "tiers" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "tiers" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- invoices
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "invoices" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "invoices" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "invoices" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "invoices" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- entry_lines
ALTER TABLE "entry_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "entry_lines" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "entry_lines" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "entry_lines" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "entry_lines" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- bank_transactions
ALTER TABLE "bank_transactions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "bank_transactions" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "bank_transactions" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "bank_transactions" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "bank_transactions" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- bank_accounts
ALTER TABLE "bank_accounts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "bank_accounts" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "bank_connections" p WHERE p."id" = "bank_accounts"."bankConnectionId")));
CREATE POLICY "kledg_rls_insert" ON "bank_accounts" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "bank_connections" p WHERE p."id" = "bank_accounts"."bankConnectionId")));
CREATE POLICY "kledg_rls_update" ON "bank_accounts" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "bank_connections" p WHERE p."id" = "bank_accounts"."bankConnectionId"))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "bank_connections" p WHERE p."id" = "bank_accounts"."bankConnectionId")));
CREATE POLICY "kledg_rls_delete" ON "bank_accounts" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "bank_connections" p WHERE p."id" = "bank_accounts"."bankConnectionId")));

-- bank_transaction_matches
ALTER TABLE "bank_transaction_matches" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "bank_transaction_matches" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "bank_accounts" p WHERE p."id" = "bank_transaction_matches"."bankAccountId")));
CREATE POLICY "kledg_rls_insert" ON "bank_transaction_matches" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "bank_accounts" p WHERE p."id" = "bank_transaction_matches"."bankAccountId")));
CREATE POLICY "kledg_rls_update" ON "bank_transaction_matches" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "bank_accounts" p WHERE p."id" = "bank_transaction_matches"."bankAccountId"))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "bank_accounts" p WHERE p."id" = "bank_transaction_matches"."bankAccountId")));
CREATE POLICY "kledg_rls_delete" ON "bank_transaction_matches" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "bank_accounts" p WHERE p."id" = "bank_transaction_matches"."bankAccountId")));

-- transaction_rule_conditions
ALTER TABLE "transaction_rule_conditions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "transaction_rule_conditions" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "transaction_rules" p WHERE p."id" = "transaction_rule_conditions"."ruleId")));
CREATE POLICY "kledg_rls_insert" ON "transaction_rule_conditions" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "transaction_rules" p WHERE p."id" = "transaction_rule_conditions"."ruleId")));
CREATE POLICY "kledg_rls_update" ON "transaction_rule_conditions" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "transaction_rules" p WHERE p."id" = "transaction_rule_conditions"."ruleId"))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "transaction_rules" p WHERE p."id" = "transaction_rule_conditions"."ruleId")));
CREATE POLICY "kledg_rls_delete" ON "transaction_rule_conditions" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "transaction_rules" p WHERE p."id" = "transaction_rule_conditions"."ruleId")));

-- transaction_rule_entry_lines
ALTER TABLE "transaction_rule_entry_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "transaction_rule_entry_lines" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "transaction_rules" p WHERE p."id" = "transaction_rule_entry_lines"."ruleId")));
CREATE POLICY "kledg_rls_insert" ON "transaction_rule_entry_lines" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "transaction_rules" p WHERE p."id" = "transaction_rule_entry_lines"."ruleId")));
CREATE POLICY "kledg_rls_update" ON "transaction_rule_entry_lines" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "transaction_rules" p WHERE p."id" = "transaction_rule_entry_lines"."ruleId"))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "transaction_rules" p WHERE p."id" = "transaction_rule_entry_lines"."ruleId")));
CREATE POLICY "kledg_rls_delete" ON "transaction_rule_entry_lines" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "transaction_rules" p WHERE p."id" = "transaction_rule_entry_lines"."ruleId")));

-- transaction_mappings
ALTER TABLE "transaction_mappings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "transaction_mappings" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "bank_connections" p WHERE p."id" = "transaction_mappings"."bankConnectionId")));
CREATE POLICY "kledg_rls_insert" ON "transaction_mappings" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "bank_connections" p WHERE p."id" = "transaction_mappings"."bankConnectionId")));
CREATE POLICY "kledg_rls_update" ON "transaction_mappings" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "bank_connections" p WHERE p."id" = "transaction_mappings"."bankConnectionId"))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "bank_connections" p WHERE p."id" = "transaction_mappings"."bankConnectionId")));
CREATE POLICY "kledg_rls_delete" ON "transaction_mappings" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "bank_connections" p WHERE p."id" = "transaction_mappings"."bankConnectionId")));

-- integration_features
ALTER TABLE "integration_features" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "integration_features" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "integrations" p WHERE p."id" = "integration_features"."integrationId")));
CREATE POLICY "kledg_rls_insert" ON "integration_features" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "integrations" p WHERE p."id" = "integration_features"."integrationId")));
CREATE POLICY "kledg_rls_update" ON "integration_features" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "integrations" p WHERE p."id" = "integration_features"."integrationId"))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "integrations" p WHERE p."id" = "integration_features"."integrationId")));
CREATE POLICY "kledg_rls_delete" ON "integration_features" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "integrations" p WHERE p."id" = "integration_features"."integrationId")));

-- integration_resources
ALTER TABLE "integration_resources" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "integration_resources" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "integrations" p WHERE p."id" = "integration_resources"."integrationId")));
CREATE POLICY "kledg_rls_insert" ON "integration_resources" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "integrations" p WHERE p."id" = "integration_resources"."integrationId")));
CREATE POLICY "kledg_rls_update" ON "integration_resources" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "integrations" p WHERE p."id" = "integration_resources"."integrationId"))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "integrations" p WHERE p."id" = "integration_resources"."integrationId")));
CREATE POLICY "kledg_rls_delete" ON "integration_resources" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "integrations" p WHERE p."id" = "integration_resources"."integrationId")));

-- integration_sync_logs
ALTER TABLE "integration_sync_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "integration_sync_logs" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "integrations" p WHERE p."id" = "integration_sync_logs"."integrationId")));
CREATE POLICY "kledg_rls_insert" ON "integration_sync_logs" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "integrations" p WHERE p."id" = "integration_sync_logs"."integrationId")));
CREATE POLICY "kledg_rls_update" ON "integration_sync_logs" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "integrations" p WHERE p."id" = "integration_sync_logs"."integrationId"))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "integrations" p WHERE p."id" = "integration_sync_logs"."integrationId")));
CREATE POLICY "kledg_rls_delete" ON "integration_sync_logs" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "integrations" p WHERE p."id" = "integration_sync_logs"."integrationId")));

-- import_mappings
ALTER TABLE "import_mappings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "import_mappings" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "import_jobs" p WHERE p."id" = "import_mappings"."importJobId")));
CREATE POLICY "kledg_rls_insert" ON "import_mappings" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "import_jobs" p WHERE p."id" = "import_mappings"."importJobId")));
CREATE POLICY "kledg_rls_update" ON "import_mappings" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "import_jobs" p WHERE p."id" = "import_mappings"."importJobId"))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "import_jobs" p WHERE p."id" = "import_mappings"."importJobId")));
CREATE POLICY "kledg_rls_delete" ON "import_mappings" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "import_jobs" p WHERE p."id" = "import_mappings"."importJobId")));

-- balance_sheet_config_history
ALTER TABLE "balance_sheet_config_history" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "balance_sheet_config_history" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "balance_sheet_line_configs" p WHERE p."id" = "balance_sheet_config_history"."configId")));
CREATE POLICY "kledg_rls_insert" ON "balance_sheet_config_history" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "balance_sheet_line_configs" p WHERE p."id" = "balance_sheet_config_history"."configId")));
CREATE POLICY "kledg_rls_update" ON "balance_sheet_config_history" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "balance_sheet_line_configs" p WHERE p."id" = "balance_sheet_config_history"."configId"))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "balance_sheet_line_configs" p WHERE p."id" = "balance_sheet_config_history"."configId")));
CREATE POLICY "kledg_rls_delete" ON "balance_sheet_config_history" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "balance_sheet_line_configs" p WHERE p."id" = "balance_sheet_config_history"."configId")));

-- income_statement_config_history
ALTER TABLE "income_statement_config_history" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "income_statement_config_history" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "income_statement_line_configs" p WHERE p."id" = "income_statement_config_history"."configId")));
CREATE POLICY "kledg_rls_insert" ON "income_statement_config_history" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "income_statement_line_configs" p WHERE p."id" = "income_statement_config_history"."configId")));
CREATE POLICY "kledg_rls_update" ON "income_statement_config_history" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "income_statement_line_configs" p WHERE p."id" = "income_statement_config_history"."configId"))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "income_statement_line_configs" p WHERE p."id" = "income_statement_config_history"."configId")));
CREATE POLICY "kledg_rls_delete" ON "income_statement_config_history" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "income_statement_line_configs" p WHERE p."id" = "income_statement_config_history"."configId")));

-- invoice_lines
ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "invoice_lines" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "invoices" p WHERE p."id" = "invoice_lines"."invoiceId")));
CREATE POLICY "kledg_rls_insert" ON "invoice_lines" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "invoices" p WHERE p."id" = "invoice_lines"."invoiceId")));
CREATE POLICY "kledg_rls_update" ON "invoice_lines" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "invoices" p WHERE p."id" = "invoice_lines"."invoiceId"))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "invoices" p WHERE p."id" = "invoice_lines"."invoiceId")));
CREATE POLICY "kledg_rls_delete" ON "invoice_lines" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "invoices" p WHERE p."id" = "invoice_lines"."invoiceId")));

-- invoice_vat_breakdowns
ALTER TABLE "invoice_vat_breakdowns" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "invoice_vat_breakdowns" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "invoices" p WHERE p."id" = "invoice_vat_breakdowns"."invoiceId")));
CREATE POLICY "kledg_rls_insert" ON "invoice_vat_breakdowns" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "invoices" p WHERE p."id" = "invoice_vat_breakdowns"."invoiceId")));
CREATE POLICY "kledg_rls_update" ON "invoice_vat_breakdowns" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "invoices" p WHERE p."id" = "invoice_vat_breakdowns"."invoiceId"))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "invoices" p WHERE p."id" = "invoice_vat_breakdowns"."invoiceId")));
CREATE POLICY "kledg_rls_delete" ON "invoice_vat_breakdowns" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "invoices" p WHERE p."id" = "invoice_vat_breakdowns"."invoiceId")));

-- invoice_payments
ALTER TABLE "invoice_payments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "invoice_payments" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "invoices" p WHERE p."id" = "invoice_payments"."invoiceId")));
CREATE POLICY "kledg_rls_insert" ON "invoice_payments" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "invoices" p WHERE p."id" = "invoice_payments"."invoiceId")));
CREATE POLICY "kledg_rls_update" ON "invoice_payments" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "invoices" p WHERE p."id" = "invoice_payments"."invoiceId"))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "invoices" p WHERE p."id" = "invoice_payments"."invoiceId")));
CREATE POLICY "kledg_rls_delete" ON "invoice_payments" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "invoices" p WHERE p."id" = "invoice_payments"."invoiceId")));

-- ai_access_grant_companies
ALTER TABLE "ai_access_grant_companies" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "ai_access_grant_companies" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "ai_access_grants" g WHERE g."id" = "ai_access_grant_companies"."grantId")));
CREATE POLICY "kledg_rls_insert" ON "ai_access_grant_companies" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR (EXISTS (SELECT 1 FROM "ai_access_grants" g WHERE g."id" = "ai_access_grant_companies"."grantId") AND "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))));
CREATE POLICY "kledg_rls_update" ON "ai_access_grant_companies" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR (EXISTS (SELECT 1 FROM "ai_access_grants" g WHERE g."id" = "ai_access_grant_companies"."grantId") AND "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR (EXISTS (SELECT 1 FROM "ai_access_grants" g WHERE g."id" = "ai_access_grant_companies"."grantId") AND "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))));
CREATE POLICY "kledg_rls_delete" ON "ai_access_grant_companies" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "ai_access_grants" g WHERE g."id" = "ai_access_grant_companies"."grantId")));

-- dashboard_layouts
ALTER TABLE "dashboard_layouts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "dashboard_layouts" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR ("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) AND "userId" = (SELECT kledg_rls_user_id()))));
CREATE POLICY "kledg_rls_insert" ON "dashboard_layouts" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR ("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) AND "userId" = (SELECT kledg_rls_user_id()))));
CREATE POLICY "kledg_rls_update" ON "dashboard_layouts" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR ("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) AND "userId" = (SELECT kledg_rls_user_id())))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR ("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) AND "userId" = (SELECT kledg_rls_user_id()))));
CREATE POLICY "kledg_rls_delete" ON "dashboard_layouts" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR ("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) AND "userId" = (SELECT kledg_rls_user_id()))));

-- mcp_confirmations
ALTER TABLE "mcp_confirmations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "mcp_confirmations" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR ("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) AND "userId" = (SELECT kledg_rls_user_id()))));
CREATE POLICY "kledg_rls_insert" ON "mcp_confirmations" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR ("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) AND "userId" = (SELECT kledg_rls_user_id()))));
CREATE POLICY "kledg_rls_update" ON "mcp_confirmations" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR ("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) AND "userId" = (SELECT kledg_rls_user_id())))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR ("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) AND "userId" = (SELECT kledg_rls_user_id()))));
CREATE POLICY "kledg_rls_delete" ON "mcp_confirmations" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR ("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) AND "userId" = (SELECT kledg_rls_user_id()))));

-- mcp_pending_actions
ALTER TABLE "mcp_pending_actions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "mcp_pending_actions" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR ("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) AND "userId" = (SELECT kledg_rls_user_id()))));
CREATE POLICY "kledg_rls_insert" ON "mcp_pending_actions" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR ("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) AND "userId" = (SELECT kledg_rls_user_id()))));
CREATE POLICY "kledg_rls_update" ON "mcp_pending_actions" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR ("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) AND "userId" = (SELECT kledg_rls_user_id())))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR ("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) AND "userId" = (SELECT kledg_rls_user_id()))));
CREATE POLICY "kledg_rls_delete" ON "mcp_pending_actions" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR ("companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) AND "userId" = (SELECT kledg_rls_user_id()))));

-- ai_access_grants
ALTER TABLE "ai_access_grants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "ai_access_grants" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "userId" = (SELECT kledg_rls_user_id())));
CREATE POLICY "kledg_rls_insert" ON "ai_access_grants" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "userId" = (SELECT kledg_rls_user_id())));
CREATE POLICY "kledg_rls_update" ON "ai_access_grants" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "userId" = (SELECT kledg_rls_user_id()))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "userId" = (SELECT kledg_rls_user_id())));
CREATE POLICY "kledg_rls_delete" ON "ai_access_grants" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "userId" = (SELECT kledg_rls_user_id())));

-- user_preferences
ALTER TABLE "user_preferences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "user_preferences" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "userId" = (SELECT kledg_rls_user_id())));
CREATE POLICY "kledg_rls_insert" ON "user_preferences" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "userId" = (SELECT kledg_rls_user_id())));
CREATE POLICY "kledg_rls_update" ON "user_preferences" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "userId" = (SELECT kledg_rls_user_id()))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "userId" = (SELECT kledg_rls_user_id())));
CREATE POLICY "kledg_rls_delete" ON "user_preferences" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "userId" = (SELECT kledg_rls_user_id())));

-- organization
ALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "organization" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "organization" FOR INSERT WITH CHECK ((SELECT kledg_rls_unrestricted()));
CREATE POLICY "kledg_rls_update" ON "organization" FOR UPDATE USING ((SELECT kledg_rls_unrestricted())) WITH CHECK ((SELECT kledg_rls_unrestricted()));
CREATE POLICY "kledg_rls_delete" ON "organization" FOR DELETE USING ((SELECT kledg_rls_unrestricted()));

-- member
ALTER TABLE "member" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "member" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "userId" = (SELECT kledg_rls_user_id()) OR EXISTS (SELECT 1 FROM "organization" o WHERE o."id" = "member"."organizationId")));
CREATE POLICY "kledg_rls_insert" ON "member" FOR INSERT WITH CHECK ((SELECT kledg_rls_unrestricted()));
CREATE POLICY "kledg_rls_update" ON "member" FOR UPDATE USING ((SELECT kledg_rls_unrestricted())) WITH CHECK ((SELECT kledg_rls_unrestricted()));
CREATE POLICY "kledg_rls_delete" ON "member" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "userId" = (SELECT kledg_rls_user_id())));

-- invitation
ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "invitation" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "organization" o WHERE o."id" = "invitation"."organizationId")));
CREATE POLICY "kledg_rls_insert" ON "invitation" FOR INSERT WITH CHECK ((SELECT kledg_rls_unrestricted()));
CREATE POLICY "kledg_rls_update" ON "invitation" FOR UPDATE USING ((SELECT kledg_rls_unrestricted())) WITH CHECK ((SELECT kledg_rls_unrestricted()));
CREATE POLICY "kledg_rls_delete" ON "invitation" FOR DELETE USING ((SELECT kledg_rls_unrestricted()));

-- audit_logs
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "audit_logs" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "audit_logs" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) OR "companyId" IS NULL));
CREATE POLICY "kledg_rls_update" ON "audit_logs" FOR UPDATE USING ((SELECT kledg_rls_unrestricted())) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) OR "companyId" IS NULL));
CREATE POLICY "kledg_rls_delete" ON "audit_logs" FOR DELETE USING ((SELECT kledg_rls_unrestricted()));

-- persons
ALTER TABLE "persons" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "persons" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) OR ("companyId" IS NULL AND EXISTS (SELECT 1 FROM "shareholders" s WHERE s."personId" = "persons"."id"))));
CREATE POLICY "kledg_rls_insert" ON "persons" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "persons" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) OR ("companyId" IS NULL AND EXISTS (SELECT 1 FROM "shareholders" s WHERE s."personId" = "persons"."id")))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) OR ("companyId" IS NULL AND EXISTS (SELECT 1 FROM "shareholders" s WHERE s."personId" = "persons"."id"))));
CREATE POLICY "kledg_rls_delete" ON "persons" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- balance_sheet_config_templates
ALTER TABLE "balance_sheet_config_templates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "balance_sheet_config_templates" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) OR ("companyId" IS NULL AND "isPublic")));
CREATE POLICY "kledg_rls_insert" ON "balance_sheet_config_templates" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) OR ("companyId" IS NULL AND "isPublic" AND (SELECT kledg_rls_user_id()) IS NOT NULL)));
CREATE POLICY "kledg_rls_update" ON "balance_sheet_config_templates" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) OR ("companyId" IS NULL AND "isPublic"))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) OR ("companyId" IS NULL AND "isPublic" AND (SELECT kledg_rls_user_id()) IS NOT NULL)));
CREATE POLICY "kledg_rls_delete" ON "balance_sheet_config_templates" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) OR ("companyId" IS NULL AND "isPublic" AND "createdBy" = (SELECT kledg_rls_user_id()))));

-- income_statement_config_templates
ALTER TABLE "income_statement_config_templates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "income_statement_config_templates" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) OR ("companyId" IS NULL AND "isPublic")));
CREATE POLICY "kledg_rls_insert" ON "income_statement_config_templates" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) OR ("companyId" IS NULL AND "isPublic" AND (SELECT kledg_rls_user_id()) IS NOT NULL)));
CREATE POLICY "kledg_rls_update" ON "income_statement_config_templates" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) OR ("companyId" IS NULL AND "isPublic"))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) OR ("companyId" IS NULL AND "isPublic" AND (SELECT kledg_rls_user_id()) IS NOT NULL)));
CREATE POLICY "kledg_rls_delete" ON "income_statement_config_templates" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]) OR ("companyId" IS NULL AND "isPublic" AND "createdBy" = (SELECT kledg_rls_user_id()))));

