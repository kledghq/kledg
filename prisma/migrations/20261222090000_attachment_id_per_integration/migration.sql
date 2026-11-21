-- #149: a Qonto attachment id is unique per integration, not across Kledg.
-- Two companies connected to the same Qonto organization each keep their
-- own copy of a receipt; the global index made the second sync fail.
DROP INDEX IF EXISTS "attachments_externalAttachmentId_key";
CREATE INDEX IF NOT EXISTS "attachments_externalAttachmentId_idx" ON "attachments"("externalAttachmentId");
