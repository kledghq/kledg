-- Next definitive entry number without reading every validated entry of the
-- fiscal year (lib/accounting/services/generate-next-entry-number.service.ts).
--
-- kledg_entry_sequence is the sequence number of an entry number, the SQL
-- twin of sequentialPartOf: its last group of digits without leading zeros,
-- NULL for a provisional draft number ("BR-..."), a number without digits or
-- a group longer than 9 digits (legacy "TR-<timestamp>" numbers). The
-- partial expression index lets max() over the validated entries of a
-- fiscal year read one index entry; numbering still runs under the advisory
-- lock of the fiscal year (lockEntryNumbering), so concurrent validations
-- never get the same number.
--
-- Additive: a function and an index.

CREATE OR REPLACE FUNCTION kledg_entry_sequence(entry_number TEXT) RETURNS BIGINT
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT CASE
    WHEN entry_number LIKE 'BR-%' OR t.digits IS NULL OR length(t.trimmed) > 9 THEN NULL
    ELSE t.trimmed::BIGINT
  END
  FROM (
    SELECT d.digits, COALESCE(NULLIF(ltrim(d.digits, '0'), ''), '0') AS trimmed
    FROM (SELECT substring(entry_number FROM '([0-9]+)[^0-9]*$') AS digits) d
  ) t
$$;

CREATE INDEX "accounting_entries_validated_sequence_idx"
  ON "accounting_entries" ("fiscalYearId", kledg_entry_sequence("entryNumber"))
  WHERE "status" = 'validated';
