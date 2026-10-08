-- Company identifiers checked within a scope (pentest round 3,
-- KLEDG-R3-CLOUD-01). Additive: no table or column change.
--
-- kledg_company_identifier_taken gains:
-- - `scope`: the ids of the companies a SIREN or a SIRET must differ from,
--   given by the instance policy (companyIdentifierScope,
--   lib/instance/policy.ts); NULL, the default and Kledg's answer, means
--   every company of the instance, as before. The slug ignores it: it is
--   part of company URLs and stays unique across the instance;
-- - `siret`: an establishment holds this SIRET. The establishment checks
--   read through it instead of the table, which row level security limits
--   to the user's own companies.
-- It still answers a boolean only, never which company.
-- lib/companies/identifiers.ts
--
-- The old three-argument function is replaced by the new one, whose `scope`
-- defaults to NULL: a server still running the previous version calls it
-- the same way.

DROP FUNCTION IF EXISTS kledg_company_identifier_taken(text, text, text);

CREATE FUNCTION kledg_company_identifier_taken(field text, value text, except_company_id text, scope text[] DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE field
    WHEN 'siren' THEN EXISTS (
      SELECT 1 FROM "companies" c
      WHERE c."siren" = value
        AND c."id" IS DISTINCT FROM except_company_id
        AND (scope IS NULL OR c."id" = ANY (scope))
    )
    WHEN 'siret' THEN EXISTS (
      SELECT 1 FROM "establishments" e
      WHERE e."siret" = value
        AND (scope IS NULL OR e."companyId" = ANY (scope))
    )
    WHEN 'slug' THEN EXISTS (
      SELECT 1 FROM "companies" c
      WHERE c."slug" = value
        AND c."id" IS DISTINCT FROM except_company_id
    )
    ELSE false
  END
$$;
