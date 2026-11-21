-- The supplier opted to pay VAT on its services on debits (CGI art. 269, 2, c):
-- the company deducts that VAT on the invoice. Without the option, the VAT of
-- a service is deductible once paid (CGI art. 271, I-2) and waits in 44588.
ALTER TABLE "tiers" ADD COLUMN "vatOnDebits" BOOLEAN NOT NULL DEFAULT false;
