-- Display mode of the user ("mode simple" or "mode expert", docs/mode-simple.md).
--
-- A per-user display preference stored next to the chart colours: the same
-- books, two ways of showing them. Permissions stay tied to the roles; the
-- mode changes no access.
--
-- Additive:
-- - "displayMode" is NULL until the user chooses (onboarding step or the
--   switch). NULL reads as 'expert', so existing users see no change.
-- - "appearance" becomes optional: a user who only chose a mode has no
--   colours saved, and NULL reads as the default colours (lib/appearance).
-- Row level security: the user_preferences policies (the row is the acting
-- user's, docs/rls.md) cover the new column; nothing to add.

-- AlterTable
ALTER TABLE "user_preferences" ALTER COLUMN "appearance" DROP NOT NULL;
ALTER TABLE "user_preferences" ADD COLUMN "displayMode" TEXT;

-- The two modes only (lib/appearance/display-mode.ts).
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_displayMode_check" CHECK ("displayMode" IS NULL OR "displayMode" IN ('simple', 'expert'));
