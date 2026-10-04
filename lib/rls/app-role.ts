/**
 * The database role the application uses with KLEDG_RLS=enforce, and the
 * check that the connected role is subject to the policies (docs/rls.md#roles).
 *
 * The statements run with the owner's connection (the role that runs the
 * migrations): `pnpm db:rls-role` (scripts/rls-role.ts) and the test
 * database helper (lib/__tests__/helpers/test-db.ts).
 */

import { RlsConfigurationError } from './mode'

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/

export const DEFAULT_APP_ROLE = 'kledg_app'

/**
 * SECURITY DEFINER functions the application role calls: the access
 * functions of the policies and the company identifier check
 * (lib/companies/identifiers.ts). Every other definer function is a trigger
 * function or runs from one, or is a maintenance function for the owner
 * (kledg_purge_audit_logs): migration 20261029090000_definer_function_hardening
 * revokes EXECUTE on those from PUBLIC and the application role.
 */
export const APP_CALLABLE_DEFINER_FUNCTIONS: readonly string[] = [
  'kledg_company_identifier_taken',
  'kledg_group_subsidiary_ids',
  'kledg_rls_company_ids',
  'kledg_rls_unrestricted',
]

/** Definer functions that only the owner executes (signatures), revoked again after the blanket grant below. */
export const OWNER_ONLY_FUNCTIONS: readonly string[] = [
  'kledg_purge_audit_logs(timestamptz)',
  'kledg_assert_fiscal_year_open(text)',
]

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Creates `role` (LOGIN, no superuser, no BYPASSRLS) when missing, sets its
 * password when one is given, grants it data access to the existing and
 * future tables of the owner, and switches the policies on
 * (kledg_rls_enforced() returns true). Idempotent.
 */
export function appRoleStatements(role: string, password?: string): string[] {
  if (!ROLE_NAME.test(role)) throw new Error(`Invalid role name "${role}": lowercase letters, digits and _`)
  const login = password ? `LOGIN PASSWORD ${quoteLiteral(password)}` : 'LOGIN'
  return [
    `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(role)}) THEN
    CREATE ROLE "${role}" ${login} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$`,
    ...(password ? [`ALTER ROLE "${role}" ${login}`] : []),
    // Before PostgreSQL 15 every role may create objects in public, which
    // would let the app role shadow a function or table that the SECURITY
    // DEFINER functions resolve through search_path. Only the owner creates.
    `REVOKE CREATE ON SCHEMA public FROM PUBLIC`,
    `REVOKE CREATE ON SCHEMA public FROM "${role}"`,
    `GRANT USAGE ON SCHEMA public TO "${role}"`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`,
    // The migration history belongs to the migration role only.
    `DO $$ BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE public."_prisma_migrations" FROM "${role}";
  END IF;
END $$`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`,
    `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "${role}"`,
    // Owner-only definer functions (migration 20261029090000_definer_function_hardening).
    ...OWNER_ONLY_FUNCTIONS.map(
      (fn) => `DO $$ BEGIN
  IF to_regprocedure(${quoteLiteral(fn)}) IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION ${fn} FROM "${role}";
  END IF;
END $$`,
    ),
    // Tables and sequences created by later migrations (run by this owner).
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${role}"`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${role}"`,
    enforcedStatement(true),
  ]
}

/** Switches the policies on or off for every role (docs/rls.md#enabling-it-on-an-existing-instance). */
export function enforcedStatement(enforced: boolean): string {
  return `CREATE OR REPLACE FUNCTION kledg_rls_enforced() RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT ${enforced} $$`
}

interface RoleCheckRow {
  role: string
  rolsuper: boolean
  rolbypassrls: boolean
  owns: boolean
  enforced: boolean
}

/** The query `verifyAppRole` runs: who the connection is and whether the policies apply to it. */
export const ROLE_CHECK_SQL = `SELECT current_user AS role, r.rolsuper, r.rolbypassrls,
  pg_has_role(current_user, c.relowner, 'USAGE') AS owns,
  kledg_rls_enforced() AS enforced
FROM pg_roles r, pg_class c
WHERE r.rolname = current_user AND c.oid = to_regclass('public.companies')`

/**
 * With KLEDG_RLS=enforce the application must connect as a role the policies
 * apply to. Throws an RlsConfigurationError (every statement is then
 * refused) when the role is a superuser, has BYPASSRLS, owns the tables, or
 * when the policies were not switched on.
 */
export async function verifyAppRole(query: (sql: string) => Promise<{ rows: unknown[] }>): Promise<void> {
  let row: RoleCheckRow | undefined
  try {
    row = (await query(ROLE_CHECK_SQL)).rows[0] as RoleCheckRow | undefined
  } catch (error) {
    if ((error as { code?: string }).code === '42883') {
      throw new RlsConfigurationError('KLEDG_RLS=enforce but the row level security migration is not applied: run the migrations first')
    }
    throw error
  }
  if (!row) throw new RlsConfigurationError('KLEDG_RLS=enforce but the companies table was not found: run the migrations first')
  const problems = [
    row.rolsuper && 'is a superuser',
    row.rolbypassrls && 'has BYPASSRLS',
    row.owns && 'owns the tables',
  ].filter(Boolean)
  if (problems.length > 0) {
    throw new RlsConfigurationError(
      `KLEDG_RLS=enforce but the database role "${row.role}" ${problems.join(', ')}: the policies do not apply to it. ` +
        'Connect DATABASE_URL as the application role created by `pnpm db:rls-role` (docs/rls.md).',
    )
  }
  if (!row.enforced) {
    throw new RlsConfigurationError(
      'KLEDG_RLS=enforce but the policies are not switched on in the database: run `pnpm db:rls-role` with the owner connection (docs/rls.md).',
    )
  }
}
