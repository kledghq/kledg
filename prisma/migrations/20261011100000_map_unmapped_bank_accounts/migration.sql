-- Data migration: gives bank accounts without a 512 account the one their
-- company would use anyway. No schema change; idempotent (a second run finds
-- no unmapped account it can map).
--
-- Bank accounts created by a sync (Qonto, Revolut, Ponto) had no
-- "ledgerAccountCode", so the Banque and Informations pages showed
-- "Non associé" / "Compte 512 à choisir". New accounts are now mapped by the
-- sync (pickLedgerCodeForBankAccount, lib/banking/ledger-account.ts); this
-- maps the existing ones with the same rule, on the company's current fiscal
-- year (the most recent open one, else the most recent):
--   - a euro account: the company's default bank account
--     (defaultBankAccountCode) when it exists in that year, else its only
--     detailed 512 account that is not a currency account (PCG 5121 "Comptes
--     en euros"; 5124 "Comptes en devises" and the parent 512 do not count);
--   - an account in another currency: the only 5124 account.
-- With several candidates the account stays unmapped: the choice is the
-- user's, on the Banque page. Mapped accounts are never touched.
-- Test: lib/banking/__tests__/map-unmapped-bank-accounts-migration.db.test.ts.

WITH current_year AS (
  SELECT DISTINCT ON (fy."companyId") fy."companyId", fy."id"
  FROM "fiscal_years" AS fy
  ORDER BY fy."companyId", fy."isClosed" ASC, fy."year" DESC
),
bank_codes AS (
  SELECT cy."companyId", a."code"
  FROM current_year AS cy
  JOIN "accounts" AS a ON a."fiscalYearId" = cy."id" AND a."companyId" = cy."companyId"
  WHERE a."code" LIKE '512%'
),
candidates AS (
  SELECT ba."id" AS "bankAccountId",
    CASE
      WHEN upper(ba."currency") = 'EUR' THEN COALESCE(
        (SELECT bc."code" FROM bank_codes AS bc
          WHERE bc."companyId" = c."id" AND bc."code" = c."defaultBankAccountCode" LIMIT 1),
        (SELECT MIN(bc."code") FROM bank_codes AS bc
          WHERE bc."companyId" = c."id" AND length(bc."code") > 3 AND bc."code" NOT LIKE '5124%' HAVING COUNT(*) = 1)
      )
      ELSE (SELECT MIN(bc."code") FROM bank_codes AS bc
          WHERE bc."companyId" = c."id" AND bc."code" LIKE '5124%' AND length(bc."code") > 3 HAVING COUNT(*) = 1)
    END AS "code"
  FROM "bank_accounts" AS ba
  JOIN "bank_connections" AS conn ON conn."id" = ba."bankConnectionId"
  JOIN "companies" AS c ON c."id" = conn."companyId"
  WHERE ba."ledgerAccountCode" IS NULL
)
UPDATE "bank_accounts" AS ba
SET "ledgerAccountCode" = candidates."code"
FROM candidates
WHERE ba."id" = candidates."bankAccountId"
  AND candidates."code" IS NOT NULL;
