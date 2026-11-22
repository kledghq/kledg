-- #161: the bypasses of the ledger guards are no longer a switch the
-- application role can turn on.
--
-- kledg.closed_year_bypass and kledg.company_purge are transaction settings
-- any role can set with set_config. They now count only when the connected
-- role (session_user) owns the ledger tables or is a superuser: the role of
-- the migrations and of maintenance. An install that connects as the owner
-- (KLEDG_RLS=off, the default) keeps one role for everything, so nothing is
-- separated there (docs/rls.md#guard-bypasses).
--
-- The application purges throwaway or deleted companies (the demo's
-- sandboxes, the accounts deleted on the hosted offer) through one function,
-- kledg_purge_companies: it deletes only companies the request's context may
-- delete (the delete policy of companies), and lets the guards through for
-- that deletion only, by a mark of its transaction in a table the
-- application role cannot write.

CREATE TABLE "kledg_purge_marks" (
  "txid" TEXT NOT NULL DEFAULT (pg_current_xact_id())::text,
  CONSTRAINT "kledg_purge_marks_pkey" PRIMARY KEY ("txid")
);
-- Owner only: no role but the owner may read or write a mark (default privileges included).
REVOKE ALL ON TABLE "kledg_purge_marks" FROM PUBLIC;
DO $$
DECLARE grantee text;
BEGIN
  FOR grantee IN
    SELECT DISTINCT g.grantee FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public' AND g.table_name = 'kledg_purge_marks' AND g.grantee <> current_user AND g.grantee <> 'PUBLIC'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public."kledg_purge_marks" FROM %I', grantee);
  END LOOP;
END $$;

-- The connected role runs the migrations: it owns the ledger tables, or is a superuser.
CREATE OR REPLACE FUNCTION kledg_maintenance_role() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = session_user), false)
      OR pg_has_role(session_user, (SELECT relowner FROM pg_class WHERE oid = 'public.accounting_entries'::regclass), 'MEMBER')
$$;

-- The current transaction is inside kledg_purge_companies. Definer: the guards that call it may run as the application role.
CREATE OR REPLACE FUNCTION kledg_purge_marked() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM "kledg_purge_marks" WHERE "txid" = pg_current_xact_id()::text)
$$;

CREATE OR REPLACE FUNCTION kledg_closed_year_bypass() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT (coalesce(current_setting('kledg.closed_year_bypass', true), '') = 'on' AND kledg_maintenance_role()) OR kledg_purge_marked()
$$;

CREATE OR REPLACE FUNCTION kledg_company_purge() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT (coalesce(current_setting('kledg.company_purge', true), '') = 'on' AND kledg_maintenance_role()) OR kledg_purge_marked()
$$;

CREATE OR REPLACE FUNCTION kledg_guard_company_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF kledg_company_purge() THEN
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM "accounting_entries" WHERE "companyId" = OLD."id" AND "status" = 'validated')
     OR EXISTS (SELECT 1 FROM "fiscal_years" WHERE "companyId" = OLD."id" AND ("isClosed" OR "closedAt" IS NOT NULL)) THEN
    RAISE EXCEPTION 'KLEDG_COMPANY_HAS_BOOKS: a company with validated entries or a closed fiscal year is kept 10 years; archive it instead'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION kledg_guard_ledger_seal() RETURNS trigger
SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR kledg_company_purge() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'KLEDG_IMMUTABLE_SEAL: un scellement du grand livre ne se modifie ni ne se supprime' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

-- Deletes companies with their books, as the request's context may (the
-- delete policy of "companies"): a company out of reach raises, nothing is
-- deleted. Foreign keys are checked at commit (SET CONSTRAINTS ALL DEFERRED),
-- as the cascade deletes rows in any order. Returns the companies deleted.
CREATE OR REPLACE FUNCTION kledg_purge_companies(company_ids text[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  out_of_reach text;
  deleted integer;
BEGIN
  IF company_ids IS NULL OR cardinality(company_ids) = 0 THEN
    RETURN 0;
  END IF;
  IF NOT kledg_rls_unrestricted() THEN
    SELECT id INTO out_of_reach FROM unnest(company_ids) AS id WHERE NOT (id = ANY (kledg_rls_company_ids())) LIMIT 1;
    IF out_of_reach IS NOT NULL THEN
      RAISE EXCEPTION 'KLEDG_PURGE_REFUSED: company % is out of reach of this context', out_of_reach USING ERRCODE = 'P0001';
    END IF;
  END IF;
  INSERT INTO "kledg_purge_marks" DEFAULT VALUES ON CONFLICT DO NOTHING;
  SET CONSTRAINTS ALL DEFERRED;
  DELETE FROM "companies" WHERE "id" = ANY (company_ids);
  GET DIAGNOSTICS deleted = ROW_COUNT;
  DELETE FROM "kledg_purge_marks" WHERE "txid" = pg_current_xact_id()::text;
  RETURN deleted;
END;
$$;
