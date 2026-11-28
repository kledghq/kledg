-- Receipt mailbox of a company (lib/receipts/mailbox): an IMAP mailbox that
-- Kledg reads for receipts, kept as an integration of type RECEIPTS and
-- provider IMAP (credentials encrypted like the bank ones).

ALTER TYPE "IntegrationType" ADD VALUE 'RECEIPTS';
ALTER TYPE "IntegrationProvider" ADD VALUE 'IMAP';
