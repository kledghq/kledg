-- SECURITY DEFINER hardening (pentest round 2, KLEDG-SEC-013). Additive: no
-- table or column change.
--
-- 1. Every SECURITY DEFINER function of the public schema gets
--    `search_path = public, pg_temp`. kledg_purge_audit_logs had
--    `search_path = public` only: PostgreSQL then searches pg_temp first,
--    so a temporary table of the caller named audit_logs would shadow the
--    real one inside the function. The loop also covers any other definer
--    function without a pinned path.
-- 2. EXECUTE is revoked from PUBLIC (the default of every new function) and
--    from every role but the owner on the definer functions the application
--    never calls:
--    - kledg_purge_audit_logs: retention purge, run by the owner from an SQL
--      console (docs/configuration.md); an operator may grant it to a
--      maintenance role again;
--    - kledg_assert_fiscal_year_open: called only from the integrity trigger
--      functions, which run as the owner.
--    The access functions of the policies and kledg_company_identifier_taken
--    stay executable (lib/rls/app-role.ts APP_CALLABLE_DEFINER_FUNCTIONS);
--    trigger functions cannot be called directly. `pnpm db:rls-role` revokes
--    them again after its blanket grant (lib/rls/app-role.ts).
-- Test: lib/rls/__tests__/policy-coverage.db.test.ts.

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND NOT (coalesce(p.proconfig, '{}'::text[]) @> ARRAY['search_path=public, pg_temp'])
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', fn.signature);
  END LOOP;
END $$;

DO $$
DECLARE
  fn regprocedure;
  grantee record;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'kledg_purge_audit_logs(timestamptz)'::regprocedure,
    'kledg_assert_fiscal_year_open(text)'::regprocedure
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn);
    FOR grantee IN
      SELECT DISTINCT r.rolname
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(p.proacl) a
      JOIN pg_roles r ON r.oid = a.grantee
      WHERE p.oid = fn AND a.grantee <> p.proowner
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', fn, grantee.rolname);
    END LOOP;
  END LOOP;
END $$;
