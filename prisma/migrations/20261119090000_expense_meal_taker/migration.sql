-- Meals of the exploitant of a company taxed at the impôt sur le revenu
-- (docs/notes-de-frais.md, "Repas de l'exploitant"; BOI-BNC-BASE-40-60-60).
--
-- expense_lines."mealTaker": who took a meal taken alone (category MEALS)
-- when the claimant does not say it (a member's own claimant created as an
-- employee by default): 'EXPLOITANT' (the exploitant or an associé taxed on
-- the profit: only the frais supplémentaires are deductible) or 'EMPLOYEE'
-- (employer rules, fully deductible). Null: given by the claimant, or not
-- asked. Read only for a company at IR.
--
-- Additive: one nullable column with its check constraint. No new table, so
-- no row level security change (expense_lines is reached through its report).

-- AlterTable
ALTER TABLE "expense_lines" ADD COLUMN "mealTaker" TEXT;
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_mealTaker_check" CHECK ("mealTaker" IS NULL OR "mealTaker" IN ('EXPLOITANT', 'EMPLOYEE'));
