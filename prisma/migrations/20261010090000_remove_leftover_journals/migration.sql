-- Data migration: removes the journals that reading the Journaux page used
-- to create. No schema change; idempotent (running it again deletes nothing
-- more).
--
-- Until commit 02d803d, GET /api/journals upserted AC "Achats", VT "Ventes",
-- BQ "Banque", CA "Caisse" and OD "Opérations diverses" on every read, on
-- top of the canonical set every company gets at creation
-- (DEFAULT_JOURNALS, lib/accounting/default-journals.ts):
--
--   AC Achats, VE Ventes, BQ Banque, OD Opérations diverses, AN À-nouveaux
--
-- AC, BQ and OD already existed, so the upsert left them alone: the extra
-- journals are VT "Ventes" (a second sales journal next to VE) and
-- CA "Caisse". This deletes such a journal only when all of these hold:
--   - its code and label are still exactly what the old read wrote
--     (VT "Ventes", CA "Caisse"): a renamed journal was taken over by a user;
--   - for VT, the company also has its canonical VE journal, so sales keep
--     a journal;
--   - no accounting entry uses it (drafts included, any fiscal year);
--   - no transaction rule of the company books into it (journalCode).
-- Nothing else refers to a journal: bank accounts, integrations and company
-- settings hold no journal id or code (checked by the test of this
-- migration, which lists every column naming a journal).
-- Canonical journals (AC, VE, BQ, OD, AN) and the journals Kledg creates
-- later (CL at closing) are never touched.
-- Test: lib/accounting/__tests__/leftover-journals-migration.db.test.ts.

DELETE FROM "journals" AS j
WHERE (
    (j."code" = 'VT' AND j."label" = 'Ventes'
      AND EXISTS (
        SELECT 1 FROM "journals" AS ve
        WHERE ve."companyId" = j."companyId" AND ve."code" = 'VE'
      ))
    OR (j."code" = 'CA' AND j."label" = 'Caisse')
  )
  AND NOT EXISTS (
    SELECT 1 FROM "accounting_entries" AS e WHERE e."journalId" = j."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "transaction_rules" AS r
    WHERE r."companyId" = j."companyId" AND r."journalCode" = j."code"
  );
