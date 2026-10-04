-- The audit log is append-only (audit trail of the books: who validated,
-- closed, deleted, connected what). Additive: one trigger function, one
-- trigger, one purge function; no table or column change.
--
-- Every UPDATE or DELETE of an audit_logs row raises
-- KLEDG_AUDIT_LOG_APPEND_ONLY, for every code path (the app, a script, an
-- SQL console using the application role), with two exceptions:
--   - the company foreign key is ON DELETE SET NULL: deleting a company
--     (only allowed without validated entries nor closed fiscal years, see
--     lib/companies/manage-company.service.ts) clears "companyId" and
--     nothing else, so its rows stay;
--   - retention: rows older than 10 years (Code de commerce art. L123-22,
--     books and supporting documents are kept 10 years) may be deleted, only
--     inside kledg_purge_audit_logs, which sets kledg.audit_purge for its
--     own transaction. The 10 year floor is checked by the trigger itself, so
--     setting the flag by hand never removes a younger row.
-- TRUNCATE and disabling triggers stay possible for the database owner:
-- this guards the application and its role, not a database superuser.
-- Test: lib/audit/__tests__/append-only.db.test.ts.

CREATE OR REPLACE FUNCTION kledg_guard_audit_log() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."companyId" IS NOT NULL AND NEW."companyId" IS NULL
       AND (to_jsonb(NEW) - 'companyId') = (to_jsonb(OLD) - 'companyId') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'KLEDG_AUDIT_LOG_APPEND_ONLY: audit log rows cannot be modified'
      USING ERRCODE = 'P0001';
  END IF;

  IF current_setting('kledg.audit_purge', true) = 'on'
     AND OLD."createdAt" < (now() AT TIME ZONE 'UTC') - interval '10 years' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'KLEDG_AUDIT_LOG_APPEND_ONLY: audit log rows are kept 10 years and cannot be deleted'
    USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER "audit_logs_append_only"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION kledg_guard_audit_log();

-- Deletes the audit rows created before `older_than`, never a row younger
-- than 10 years. SECURITY DEFINER so that an operator may grant EXECUTE on
-- it to a maintenance role without granting DELETE on the table.
CREATE OR REPLACE FUNCTION kledg_purge_audit_logs(older_than timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  purged integer;
BEGIN
  PERFORM set_config('kledg.audit_purge', 'on', true);
  DELETE FROM "audit_logs"
  WHERE "createdAt" < LEAST(older_than AT TIME ZONE 'UTC', (now() AT TIME ZONE 'UTC') - interval '10 years');
  GET DIAGNOSTICS purged = ROW_COUNT;
  PERFORM set_config('kledg.audit_purge', 'off', true);
  RETURN purged;
END;
$$;
