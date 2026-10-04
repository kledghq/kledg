-- Tax and legal deadline calendar (lib/deadlines): the settings Kledg cannot
-- infer from the company (VAT filing day, quarterly CA3, IS and CFE
-- acomptes, DAS2, CVAE, online filing of the annual accounts). JSON
-- validated by DeadlineSettingsSchema; NULL means the defaults. Additive.

ALTER TABLE "companies" ADD COLUMN "deadlineSettings" JSONB;
