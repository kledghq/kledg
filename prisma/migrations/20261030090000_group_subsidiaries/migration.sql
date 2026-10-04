-- Subsidiaries of a holding, for the group view (docs/vue-groupe.md).
--
-- One definition of a holding in Kledg (lib/management-fees/holding.ts): a
-- company is a holding of another when it is recorded among that company's
-- shareholders ("shareholders"."companyShareholderId"). Those rows belong to
-- the subsidiary, so under row level security a member of the holding who is
-- not a member of a subsidiary cannot see that the subsidiary exists. The
-- group view must still say that the group has a subsidiary the user cannot
-- read (listed as not accessible, never read).
--
-- This function answers the ids of the holding's subsidiaries (active
-- companies only) and nothing else: no name, no figure. It answers only when
-- the holding itself is reachable by the context (the same test as the
-- policies), so a user learns the subsidiaries of a holding they belong to,
-- never those of another. A connection that row level security does not
-- apply to (the owner of the tables, a superuser or a BYPASSRLS role: an
-- install with KLEDG_RLS=off, which sends no context, even after the
-- policies were switched on once) could read the shareholder rows itself,
-- so it gets the ids without a context, as it would get the rows. The
-- function runs as its owner, so the connecting role is session_user.
-- The application then checks the user's access to
-- each id and reads a reachable subsidiary in its own scope
-- (lib/management-fees/access.ts); an id it cannot reach is counted, never
-- read or returned to the client. SECURITY DEFINER with a fixed search_path,
-- like kledg_company_identifier_taken.

CREATE OR REPLACE FUNCTION kledg_group_subsidiary_ids(holding_id text)
RETURNS text[]
LANGUAGE sql STABLE PARALLEL SAFE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT s."companyId" ORDER BY s."companyId"), '{}'::text[])
  FROM "shareholders" s
  JOIN "companies" c ON c."id" = s."companyId"
  WHERE s."companyShareholderId" = holding_id
    AND s."companyId" <> holding_id
    AND c."archivedAt" IS NULL
    AND (
      (SELECT kledg_rls_unrestricted())
      OR holding_id = ANY ((SELECT kledg_rls_company_ids())::text[])
      OR EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = session_user AND (r.rolsuper OR r.rolbypassrls))
      OR pg_has_role(session_user, (SELECT t.relowner FROM pg_class t WHERE t.oid = 'public.shareholders'::regclass), 'MEMBER')
    )
$$;
