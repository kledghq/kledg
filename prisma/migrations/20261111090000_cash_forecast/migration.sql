-- Cash forecast (lib/cash-forecast, docs/prevision-tresorerie.md): the
-- minimum cash threshold of the company, the horizon of the projection and
-- the flows it counts. JSON validated by CashForecastSettingsSchema; NULL
-- means the defaults (no threshold, six months). A column of "companies",
-- whose row level security policies already cover it. Additive.

ALTER TABLE "companies" ADD COLUMN "cashForecastSettings" JSONB;
