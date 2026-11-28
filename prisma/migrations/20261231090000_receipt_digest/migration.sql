-- Weekly email of the receipts still missing (docs/justificatifs-email.md#récapitulatif-hebdomadaire).
--
-- Additive: two columns of the user's own preferences row. "receiptDigest"
-- defaults to true (the email is on until the user turns it off, from
-- Paramètres, Profil); "receiptDigestSentAt" keeps the email to one a week.
-- Row level security: the user_preferences policies (the row is the acting
-- user's, docs/rls.md) cover the new columns; the weekly job reads them in
-- the system context (cron:receipt-digest).

-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN "receiptDigest" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "user_preferences" ADD COLUMN "receiptDigestSentAt" TIMESTAMP(3);
