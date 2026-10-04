-- Lettering of third-party accounts and payment terms of the aged balance.
-- Additive: two columns with defaults, a check constraint and an index; no
-- data change, no trigger change.
--
-- 1. Payment terms of the company, used to compute the due date of an
--    unlettered invoice line in the aged balance (balance âgée): due date =
--    entry date + "paymentTermsDays" days, or the end of the month reached
--    after those days when "paymentTermsEndOfMonth" is set. Code de commerce
--    art. L441-10: 30 days by default (I, al. 1), at most 60 days from the
--    invoice date, or 45 days end of month when agreed (I, al. 2). The check
--    keeps every stored value within those caps.
-- 2. Lettering (letteringCode, letteringDate) already exists on entry_lines
--    (20261003180000) and stays outside the immutability and closed year
--    triggers (20261004100000): the database lets a validated line be
--    lettered. Kledg refuses lettering in a closed fiscal year in its service
--    (lib/lettering/lettering.service.ts) so that the FEC of a closed year
--    stays the one produced at closing. The index serves the lettering screen
--    and the next code of an account (lines of one account by code).

-- AlterTable
ALTER TABLE "companies" ADD COLUMN "paymentTermsDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "companies" ADD COLUMN "paymentTermsEndOfMonth" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "companies" ADD CONSTRAINT "companies_payment_terms_check" CHECK (
  "paymentTermsDays" >= 0
  AND "paymentTermsDays" <= CASE WHEN "paymentTermsEndOfMonth" THEN 45 ELSE 60 END
);

-- CreateIndex
CREATE INDEX "entry_lines_accountId_letteringCode_idx" ON "entry_lines"("accountId", "letteringCode");
