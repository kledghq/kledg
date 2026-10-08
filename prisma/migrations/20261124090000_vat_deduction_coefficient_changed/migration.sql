-- Regularisation of the coefficient de déduction against the coefficient
-- actually applied during the year (docs/organisme-de-formation.md;
-- CGI ann. II art. 206, V, 2 and 207, I; BOI-TVA-DED-20-10-40, example 3:
-- definitive coefficient x VAT borne minus the VAT deducted).
--
-- vat_deduction_years."coefficientChangedOn": first day the coefficient
-- applied to the postings of the year changed after VAT had already been
-- deducted in the year (the estimate, the coefficient d'assujettissement or
-- the deduction by coefficient itself changed). The VAT borne can then no
-- longer be read back from the VAT deducted: the user enters it. Null: the
-- coefficient applied stayed the same.
--
-- Additive: one nullable column. No new table, so no row level security change.

-- AlterTable
ALTER TABLE "vat_deduction_years" ADD COLUMN "coefficientChangedOn" DATE;
