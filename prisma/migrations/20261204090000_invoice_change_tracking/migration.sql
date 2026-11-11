-- Invoices changed by the rows their status is derived from. Additive:
-- functions and triggers only, no column, no backfill.
--
-- A sync reads the invoices changed since an instant through "updatedAt"
-- (MCP list_invoices, updatedSince; lib/invoices/manage-invoices.service.ts).
-- Prisma sets that column when the invoice row itself is updated, but the
-- status, paid and remaining amounts, last payment date and entry number of
-- an invoice are derived (lib/invoices/status.ts) from other rows:
-- - its payments (invoice_payments), recorded and removed by
--   lib/invoices/invoice-payments.service.ts, or deleted with their line;
-- - the lettering of the lines of its entry (lettered with its payments, or
--   by hand in Lettrage, lib/lettering/lettering.service.ts);
-- - the number and status of its entry (validation gives the definitive
--   number);
-- - its link to its entry, cleared by the database (ON DELETE SET NULL) when
--   its draft entry is deleted from the entries.
-- These triggers move "updatedAt" when any of them changes, whatever the code
-- path, so a sync never misses a change of status. Times are UTC, like the
-- values Prisma writes in these timestamp columns without time zone.
-- SECURITY INVOKER: the invoice belongs to the company of the row that
-- changed, which the caller's row level security context already reaches.
-- Test: lib/invoices/__tests__/invoices.db.test.ts ("changes for a sync").

CREATE OR REPLACE FUNCTION kledg_touch_invoice_of_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD."invoiceId" IS DISTINCT FROM NEW."invoiceId") THEN
    UPDATE "invoices" SET "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE "id" = OLD."invoiceId";
  END IF;
  IF TG_OP <> 'DELETE' THEN
    UPDATE "invoices" SET "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE "id" = NEW."invoiceId";
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "invoice_payments_touch_invoice"
AFTER INSERT OR UPDATE OR DELETE ON "invoice_payments"
FOR EACH ROW EXECUTE FUNCTION kledg_touch_invoice_of_payment();

CREATE OR REPLACE FUNCTION kledg_touch_invoice_of_entry_line() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "invoices" SET "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE "entryId" = NEW."accountingEntryId";
  RETURN NULL;
END;
$$;

CREATE TRIGGER "entry_lines_lettering_touch_invoice"
AFTER UPDATE OF "letteringCode" ON "entry_lines"
FOR EACH ROW WHEN (OLD."letteringCode" IS DISTINCT FROM NEW."letteringCode")
EXECUTE FUNCTION kledg_touch_invoice_of_entry_line();

CREATE OR REPLACE FUNCTION kledg_touch_invoice_of_entry() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "invoices" SET "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE "entryId" = NEW."id";
  RETURN NULL;
END;
$$;

CREATE TRIGGER "accounting_entries_touch_invoice"
AFTER UPDATE OF "entryNumber", "status" ON "accounting_entries"
FOR EACH ROW WHEN (OLD."entryNumber" IS DISTINCT FROM NEW."entryNumber" OR OLD."status" IS DISTINCT FROM NEW."status")
EXECUTE FUNCTION kledg_touch_invoice_of_entry();

CREATE OR REPLACE FUNCTION kledg_touch_invoice_entry_link() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."updatedAt" := (now() AT TIME ZONE 'UTC');
  RETURN NEW;
END;
$$;

CREATE TRIGGER "invoices_entry_link_touch"
BEFORE UPDATE OF "entryId" ON "invoices"
FOR EACH ROW WHEN (OLD."entryId" IS DISTINCT FROM NEW."entryId")
EXECUTE FUNCTION kledg_touch_invoice_entry_link();
