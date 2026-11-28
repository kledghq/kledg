-- Stripe connection (#1): the Stripe balance as a bank account, read with a
-- restricted API key. New enum values only, no data change.
ALTER TYPE "BankingProvider" ADD VALUE 'STRIPE';
ALTER TYPE "IntegrationProvider" ADD VALUE 'STRIPE';
