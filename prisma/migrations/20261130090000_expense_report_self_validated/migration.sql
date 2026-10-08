-- An expense report validated by its own author, allowed only when no other
-- member of the company has the validation right (recorded and shown).
ALTER TABLE "expense_reports" ADD COLUMN "selfValidated" BOOLEAN NOT NULL DEFAULT false;
