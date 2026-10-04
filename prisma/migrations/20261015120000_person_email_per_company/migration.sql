-- A person's email is unique within its company, not across the instance.
-- The global unique index let one company learn that an email address is
-- used by another company (creating a person with it was refused). Unique
-- per company keeps one person per address inside a company; persons with
-- no company (outside shareholders) are not constrained (NULLs differ).
-- kledg:allow-destructive drops a unique index only; no data is removed
DROP INDEX IF EXISTS "persons_email_key";
CREATE UNIQUE INDEX IF NOT EXISTS "persons_companyId_email_key" ON "persons"("companyId", "email");
