-- One spelling of the direction of a bank transaction (lib/banking/side.ts).
-- Readers used to accept "debit", "Débit" or anything starting with "d" in
-- different ways; a legacy or imported row spelled otherwise was a debit in
-- some modules and a credit in others. Existing values are normalised with
-- the rule of normalizeBankSide (a value starting with "d", any case, is
-- money out, anything else money in), then the column only accepts the two
-- canonical values.
--
-- Additive: data normalisation and a check constraint.

UPDATE "bank_transactions"
SET "side" = CASE WHEN "side" ~* '^\s*d' THEN 'debit' ELSE 'credit' END
WHERE "side" IS DISTINCT FROM 'debit' AND "side" IS DISTINCT FROM 'credit';

ALTER TABLE "bank_transactions"
  ADD CONSTRAINT "bank_transactions_side_check" CHECK ("side" IN ('debit', 'credit'));
