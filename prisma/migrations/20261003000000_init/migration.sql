-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CompanyLegalType" AS ENUM ('SARL', 'SAS', 'SA', 'EURL', 'SNC', 'SCS', 'SCA');

-- CreateEnum
CREATE TYPE "ShareholderType" AS ENUM ('PHYSICAL', 'LEGAL');

-- CreateEnum
CREATE TYPE "BankingProvider" AS ENUM ('QONTO');

-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('BANKING', 'STORAGE', 'ACCOUNTING', 'CRM', 'ECOMMERCE');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('QONTO', 'REVOLUT', 'N26', 'GOOGLE_DRIVE', 'DROPBOX');

-- CreateEnum
CREATE TYPE "IntegrationFeature" AS ENUM ('BANKING_TRANSACTIONS', 'BANKING_ACCOUNTS');

-- CreateEnum
CREATE TYPE "AuthenticationType" AS ENUM ('API_KEY', 'OAUTH2', 'BASIC_AUTH', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AuditLogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "addresses" (
    "id" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "street2" TEXT,
    "postalCode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'FR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "siren" TEXT NOT NULL,
    "addressId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "logo" TEXT,
    "foundationDate" TIMESTAMP(3),
    "closingDay" INTEGER,
    "closingMonth" INTEGER,
    "vatRegime" TEXT,
    "isVatExempt" BOOLEAN NOT NULL DEFAULT false,
    "vatExemptReason" TEXT,
    "vatNumber" TEXT,
    "corporateTaxRegime" TEXT,
    "legalType" "CompanyLegalType",
    "legalForm" TEXT,
    "color" TEXT,
    "sector" TEXT,
    "isHolding" BOOLEAN NOT NULL DEFAULT false,
    "totalShares" INTEGER,
    "shareNominalValue" DECIMAL(15,2),
    "shareCapital" DECIMAL(15,2),
    "headquartersAddressId" TEXT,
    "activityCode" TEXT,
    "taxOffice" TEXT,
    "defaultBankAccountCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "establishments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siret" TEXT NOT NULL,
    "siren" TEXT,
    "name" TEXT,
    "addressId" TEXT,
    "activityCode" TEXT,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "isTrainingOrganization" BOOLEAN NOT NULL DEFAULT false,
    "trainingActivityDeclarationNumber" TEXT,
    "trainingActivityDeclarationDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "establishments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shareholders" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "ShareholderType" NOT NULL,
    "name" TEXT,
    "siret" TEXT,
    "sharePercentage" DECIMAL(5,2) NOT NULL,
    "numberOfShares" INTEGER,
    "capitalAmount" DECIMAL(15,2),
    "companyShareholderId" TEXT,
    "personId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shareholders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_years" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "closingDay" INTEGER,
    "closingMonth" INTEGER,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parentId" TEXT,
    "companyId" TEXT NOT NULL,
    "fiscalYearId" TEXT,
    "isPCG" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journals" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_entries" (
    "id" TEXT NOT NULL,
    "entryNumber" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "journalId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "description" TEXT,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entry_lines" (
    "id" TEXT NOT NULL,
    "accountingEntryId" TEXT NOT NULL,
    "accountingEntryNumber" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountFiscalYearId" TEXT NOT NULL,
    "debit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_connections" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "BankingProvider" NOT NULL DEFAULT 'QONTO',
    "login" TEXT NOT NULL,
    "secretKeyEncrypted" TEXT NOT NULL,
    "selectedAccountId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "providerData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "bankConnectionId" TEXT NOT NULL,
    "integrationResourceId" TEXT,
    "externalAccountId" TEXT NOT NULL,
    "iban" TEXT,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "balance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "shouldSync" BOOLEAN NOT NULL DEFAULT true,
    "providerData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "externalTransactionId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "label" TEXT,
    "reference" TEXT,
    "side" TEXT NOT NULL,
    "note" TEXT,
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "reconciledAt" TIMESTAMP(3),
    "reconciledWith" TEXT,
    "logoUrl" TEXT,
    "counterpartyName" TEXT,
    "category" TEXT,
    "cashflowCategory" TEXT,
    "cashflowSubcategory" TEXT,
    "operationType" TEXT,
    "vatRate" DECIMAL(5,2),
    "vatAmount" DECIMAL(15,2),
    "status" TEXT,
    "providerData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_rules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "journalCode" TEXT NOT NULL DEFAULT 'BQ',
    "defaultVatAccountCode" TEXT,
    "autoCreate" BOOLEAN NOT NULL DEFAULT false,
    "requireApproval" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_rule_conditions" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "conditionType" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" TEXT,
    "value2" TEXT,

    CONSTRAINT "transaction_rule_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_rule_entry_lines" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "lineType" TEXT NOT NULL,
    "amountType" TEXT NOT NULL,
    "amountValue" DECIMAL(15,2),
    "description" TEXT,
    "order" INTEGER NOT NULL,
    "vatType" TEXT,
    "vatRateSource" TEXT DEFAULT 'fixed',
    "vatRate" DECIMAL(5,2),
    "vatAccountCode" TEXT,
    "vatAccount2Code" TEXT,
    "vatOnDebit" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "transaction_rule_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_mappings" (
    "id" TEXT NOT NULL,
    "bankConnectionId" TEXT NOT NULL,
    "defaultDebitAccountId" TEXT,
    "defaultCreditAccountId" TEXT,
    "rules" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "type" "IntegrationType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastSyncAt" TIMESTAMP(3),
    "credentials" JSONB NOT NULL,
    "credentialsEncrypted" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_features" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "feature" "IntegrationFeature" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_resources" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "metadata" JSONB,
    "shouldSync" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_sync_logs" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "feature" "IntegrationFeature",
    "status" TEXT NOT NULL,
    "itemsSynced" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errors" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_mappings" (
    "id" TEXT NOT NULL,
    "importJobId" TEXT,
    "sourceColumn" TEXT NOT NULL,
    "targetField" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "comment" TEXT,
    "acquisitionDate" TIMESTAMP(3) NOT NULL,
    "acquisitionValue" DECIMAL(15,2) NOT NULL,
    "amortizableAmount" DECIMAL(15,2),
    "disposalDate" TIMESTAMP(3),
    "depreciationRate" DECIMAL(5,2),
    "depreciationDuration" INTEGER,
    "depreciationMethod" TEXT NOT NULL DEFAULT 'linear',
    "decliningCoefficient" DECIMAL(5,2),
    "depreciationStartDate" TIMESTAMP(3) NOT NULL,
    "assetAccountId" TEXT NOT NULL,
    "depreciationAccountId" TEXT NOT NULL,
    "expenseAccountId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isFullyPaid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_asset_depreciations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fixedAssetId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "monthIndex" INTEGER,
    "year" INTEGER NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "note" TEXT,
    "accountingEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_asset_depreciations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_regime_history" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "regimeType" TEXT NOT NULL,
    "regime" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "notes" TEXT,
    "isVatExempt" BOOLEAN NOT NULL DEFAULT false,
    "vatExemptReason" TEXT,
    "establishmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_regime_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT,
    "level" "AuditLogLevel" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "companyId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persons" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "photo" TEXT,
    "addressId" TEXT,
    "notes" TEXT,
    "birthDate" TIMESTAMP(3),
    "birthDepartment" TEXT,
    "birthCity" TEXT,
    "birthCountry" TEXT DEFAULT 'FR',
    "usualName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "integrationId" TEXT,
    "bankTransactionId" TEXT,
    "externalAttachmentId" TEXT,
    "transactionUuid" TEXT,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER,
    "fileContentType" TEXT,
    "fileUrl" TEXT,
    "providerData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_sheet_line_configs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reportVariant" TEXT NOT NULL DEFAULT 'complete',
    "parentId" TEXT,
    "section" TEXT,
    "lineLabel" TEXT NOT NULL,
    "lineType" TEXT NOT NULL DEFAULT 'line',
    "formCode" TEXT,
    "amortissementFormCode" TEXT,
    "accountCodes" TEXT[],
    "excludedAccountCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "amortissementAccountCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "filterType" TEXT,
    "filterValue" TEXT,
    "balanceType" TEXT NOT NULL,
    "displayType" TEXT NOT NULL DEFAULT 'net',
    "hideLabel" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "templateId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "balance_sheet_line_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "income_statement_line_configs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reportVariant" TEXT NOT NULL DEFAULT 'complete',
    "parentId" TEXT,
    "section" TEXT,
    "lineLabel" TEXT NOT NULL,
    "formCode" TEXT,
    "accountCodes" TEXT[],
    "excludedAccountCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "filterType" TEXT,
    "filterValue" TEXT,
    "balanceType" TEXT NOT NULL,
    "hideLabel" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "templateId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "income_statement_line_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_sheet_config_history" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "changedBy" TEXT,
    "changeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_sheet_config_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "income_statement_config_history" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "changedBy" TEXT,
    "changeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "income_statement_config_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_sheet_config_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "reportVariant" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "companyId" TEXT,
    "configData" JSONB NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "balance_sheet_config_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "income_statement_config_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "reportVariant" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "companyId" TEXT,
    "configData" JSONB NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "income_statement_config_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "role" TEXT,
    "banned" BOOLEAN DEFAULT false,
    "banReason" TEXT,
    "banExpires" TIMESTAMP(3),

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "activeOrganizationId" TEXT,
    "impersonatedBy" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apikey" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT,
    "start" TEXT,
    "referenceId" TEXT NOT NULL,
    "prefix" TEXT,
    "key" TEXT NOT NULL,
    "refillInterval" INTEGER,
    "refillAmount" INTEGER,
    "lastRefillAt" TIMESTAMP(3),
    "enabled" BOOLEAN DEFAULT true,
    "rateLimitEnabled" BOOLEAN DEFAULT true,
    "rateLimitTimeWindow" INTEGER DEFAULT 86400000,
    "rateLimitMax" INTEGER DEFAULT 10,
    "requestCount" INTEGER DEFAULT 0,
    "remaining" INTEGER,
    "lastRequest" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "permissions" TEXT,
    "metadata" TEXT,

    CONSTRAINT "apikey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "metadata" TEXT,
    "companyId" TEXT,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inviterId" TEXT NOT NULL,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jwks" (
    "id" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "alg" TEXT,
    "crv" TEXT,

    CONSTRAINT "jwks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauthClient" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT,
    "clientDiscoveryId" TEXT,
    "disabled" BOOLEAN DEFAULT false,
    "skipConsent" BOOLEAN,
    "enableEndSession" BOOLEAN,
    "subjectType" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "clientCredentialsScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "userId" TEXT,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    "name" TEXT,
    "uri" TEXT,
    "icon" TEXT,
    "contacts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tos" TEXT,
    "policy" TEXT,
    "softwareId" TEXT,
    "softwareVersion" TEXT,
    "softwareStatement" TEXT,
    "redirectUris" TEXT[],
    "postLogoutRedirectUris" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "backchannelLogoutUri" TEXT,
    "backchannelLogoutSessionRequired" BOOLEAN,
    "tokenEndpointAuthMethod" TEXT,
    "applicationType" TEXT,
    "jwks" TEXT,
    "jwksUri" TEXT,
    "grantTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "responseTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requirePKCE" BOOLEAN,
    "dpopBoundAccessTokens" BOOLEAN DEFAULT false,
    "referenceId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "oauthClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauthResource" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accessTokenTtl" INTEGER,
    "refreshTokenTtl" INTEGER,
    "signingAlgorithm" TEXT,
    "signingKeyId" TEXT,
    "allowedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customClaims" JSONB,
    "dpopBoundAccessTokensRequired" BOOLEAN DEFAULT false,
    "disabled" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    "policyVersion" INTEGER DEFAULT 1,
    "metadata" JSONB,

    CONSTRAINT "oauthResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauthClientResource" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3),

    CONSTRAINT "oauthClientResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauthRefreshToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT NOT NULL,
    "referenceId" TEXT,
    "authorizationCodeId" TEXT,
    "resources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requestedUserInfoClaims" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3),
    "revoked" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),
    "rotationReplayResponse" TEXT,
    "rotationReplayExpiresAt" TIMESTAMP(3),
    "authTime" TIMESTAMP(3),
    "confirmation" JSONB,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "oauthRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauthAccessToken" (
    "id" TEXT NOT NULL,
    "token" TEXT,
    "clientId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT,
    "referenceId" TEXT,
    "authorizationCodeId" TEXT,
    "resources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requestedUserInfoClaims" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "refreshId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3),
    "revoked" TIMESTAMP(3),
    "confirmation" JSONB,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "oauthAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauthConsent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT,
    "referenceId" TEXT,
    "resources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requestedUserInfoClaims" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "oauthConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauthClientAssertion" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauthClientAssertion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "rateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "addresses_postalCode_city_idx" ON "addresses"("postalCode", "city");

-- CreateIndex
CREATE INDEX "addresses_country_idx" ON "addresses"("country");

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "companies_siren_key" ON "companies"("siren");

-- CreateIndex
CREATE INDEX "companies_addressId_idx" ON "companies"("addressId");

-- CreateIndex
CREATE INDEX "companies_headquartersAddressId_idx" ON "companies"("headquartersAddressId");

-- CreateIndex
CREATE UNIQUE INDEX "establishments_siret_key" ON "establishments"("siret");

-- CreateIndex
CREATE INDEX "establishments_companyId_idx" ON "establishments"("companyId");

-- CreateIndex
CREATE INDEX "establishments_siret_idx" ON "establishments"("siret");

-- CreateIndex
CREATE INDEX "establishments_isMain_idx" ON "establishments"("isMain");

-- CreateIndex
CREATE INDEX "establishments_addressId_idx" ON "establishments"("addressId");

-- CreateIndex
CREATE INDEX "shareholders_companyId_idx" ON "shareholders"("companyId");

-- CreateIndex
CREATE INDEX "shareholders_companyShareholderId_idx" ON "shareholders"("companyShareholderId");

-- CreateIndex
CREATE INDEX "shareholders_personId_idx" ON "shareholders"("personId");

-- CreateIndex
CREATE INDEX "fiscal_years_companyId_idx" ON "fiscal_years"("companyId");

-- CreateIndex
CREATE INDEX "fiscal_years_startDate_endDate_idx" ON "fiscal_years"("startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_years_companyId_year_key" ON "fiscal_years"("companyId", "year");

-- CreateIndex
CREATE INDEX "accounts_companyId_idx" ON "accounts"("companyId");

-- CreateIndex
CREATE INDEX "accounts_fiscalYearId_idx" ON "accounts"("fiscalYearId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_id_fiscalYearId_key" ON "accounts"("id", "fiscalYearId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_companyId_code_fiscalYearId_key" ON "accounts"("companyId", "code", "fiscalYearId");

-- CreateIndex
CREATE INDEX "journals_companyId_idx" ON "journals"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "journals_companyId_code_key" ON "journals"("companyId", "code");

-- CreateIndex
CREATE INDEX "accounting_entries_companyId_idx" ON "accounting_entries"("companyId");

-- CreateIndex
CREATE INDEX "accounting_entries_fiscalYearId_idx" ON "accounting_entries"("fiscalYearId");

-- CreateIndex
CREATE INDEX "accounting_entries_date_idx" ON "accounting_entries"("date");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_entries_entryNumber_fiscalYearId_key" ON "accounting_entries"("entryNumber", "fiscalYearId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_entries_id_entryNumber_key" ON "accounting_entries"("id", "entryNumber");

-- CreateIndex
CREATE INDEX "entry_lines_accountingEntryId_idx" ON "entry_lines"("accountingEntryId");

-- CreateIndex
CREATE INDEX "entry_lines_accountId_idx" ON "entry_lines"("accountId");

-- CreateIndex
CREATE INDEX "entry_lines_accountFiscalYearId_idx" ON "entry_lines"("accountFiscalYearId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_connections_companyId_key" ON "bank_connections"("companyId");

-- CreateIndex
CREATE INDEX "bank_connections_companyId_idx" ON "bank_connections"("companyId");

-- CreateIndex
CREATE INDEX "bank_connections_provider_idx" ON "bank_connections"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_integrationResourceId_key" ON "bank_accounts"("integrationResourceId");

-- CreateIndex
CREATE INDEX "bank_accounts_bankConnectionId_idx" ON "bank_accounts"("bankConnectionId");

-- CreateIndex
CREATE INDEX "bank_accounts_shouldSync_idx" ON "bank_accounts"("shouldSync");

-- CreateIndex
CREATE INDEX "bank_accounts_integrationResourceId_idx" ON "bank_accounts"("integrationResourceId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_bankConnectionId_externalAccountId_key" ON "bank_accounts"("bankConnectionId", "externalAccountId");

-- CreateIndex
CREATE INDEX "bank_transactions_bankAccountId_idx" ON "bank_transactions"("bankAccountId");

-- CreateIndex
CREATE INDEX "bank_transactions_date_idx" ON "bank_transactions"("date");

-- CreateIndex
CREATE INDEX "bank_transactions_reconciled_idx" ON "bank_transactions"("reconciled");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_bankAccountId_externalTransactionId_key" ON "bank_transactions"("bankAccountId", "externalTransactionId");

-- CreateIndex
CREATE INDEX "transaction_rules_companyId_idx" ON "transaction_rules"("companyId");

-- CreateIndex
CREATE INDEX "transaction_rules_enabled_idx" ON "transaction_rules"("enabled");

-- CreateIndex
CREATE INDEX "transaction_rules_priority_idx" ON "transaction_rules"("priority");

-- CreateIndex
CREATE INDEX "transaction_rule_conditions_ruleId_idx" ON "transaction_rule_conditions"("ruleId");

-- CreateIndex
CREATE INDEX "transaction_rule_conditions_conditionType_idx" ON "transaction_rule_conditions"("conditionType");

-- CreateIndex
CREATE INDEX "transaction_rule_entry_lines_ruleId_idx" ON "transaction_rule_entry_lines"("ruleId");

-- CreateIndex
CREATE INDEX "transaction_rule_entry_lines_order_idx" ON "transaction_rule_entry_lines"("order");

-- CreateIndex
CREATE INDEX "transaction_mappings_bankConnectionId_idx" ON "transaction_mappings"("bankConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_mappings_bankConnectionId_key" ON "transaction_mappings"("bankConnectionId");

-- CreateIndex
CREATE INDEX "integrations_companyId_idx" ON "integrations"("companyId");

-- CreateIndex
CREATE INDEX "integrations_provider_idx" ON "integrations"("provider");

-- CreateIndex
CREATE INDEX "integrations_type_idx" ON "integrations"("type");

-- CreateIndex
CREATE INDEX "integrations_status_idx" ON "integrations"("status");

-- CreateIndex
CREATE INDEX "integration_features_integrationId_idx" ON "integration_features"("integrationId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_features_integrationId_feature_key" ON "integration_features"("integrationId", "feature");

-- CreateIndex
CREATE INDEX "integration_resources_integrationId_idx" ON "integration_resources"("integrationId");

-- CreateIndex
CREATE INDEX "integration_resources_resourceType_idx" ON "integration_resources"("resourceType");

-- CreateIndex
CREATE INDEX "integration_resources_shouldSync_idx" ON "integration_resources"("shouldSync");

-- CreateIndex
CREATE UNIQUE INDEX "integration_resources_integrationId_resourceType_externalId_key" ON "integration_resources"("integrationId", "resourceType", "externalId");

-- CreateIndex
CREATE INDEX "integration_sync_logs_integrationId_idx" ON "integration_sync_logs"("integrationId");

-- CreateIndex
CREATE INDEX "integration_sync_logs_startedAt_idx" ON "integration_sync_logs"("startedAt");

-- CreateIndex
CREATE INDEX "import_jobs_companyId_idx" ON "import_jobs"("companyId");

-- CreateIndex
CREATE INDEX "import_jobs_status_idx" ON "import_jobs"("status");

-- CreateIndex
CREATE INDEX "import_mappings_importJobId_idx" ON "import_mappings"("importJobId");

-- CreateIndex
CREATE INDEX "fixed_assets_companyId_idx" ON "fixed_assets"("companyId");

-- CreateIndex
CREATE INDEX "fixed_asset_depreciations_companyId_idx" ON "fixed_asset_depreciations"("companyId");

-- CreateIndex
CREATE INDEX "fixed_asset_depreciations_fixedAssetId_idx" ON "fixed_asset_depreciations"("fixedAssetId");

-- CreateIndex
CREATE INDEX "fixed_asset_depreciations_fiscalYearId_idx" ON "fixed_asset_depreciations"("fiscalYearId");

-- CreateIndex
CREATE INDEX "fixed_asset_depreciations_accountingEntryId_idx" ON "fixed_asset_depreciations"("accountingEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_depreciations_fixedAssetId_fiscalYearId_periodT_key" ON "fixed_asset_depreciations"("fixedAssetId", "fiscalYearId", "periodType", "monthIndex");

-- CreateIndex
CREATE INDEX "tax_regime_history_companyId_idx" ON "tax_regime_history"("companyId");

-- CreateIndex
CREATE INDEX "tax_regime_history_regimeType_idx" ON "tax_regime_history"("regimeType");

-- CreateIndex
CREATE INDEX "tax_regime_history_startDate_endDate_idx" ON "tax_regime_history"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "tax_regime_history_establishmentId_idx" ON "tax_regime_history"("establishmentId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_companyId_idx" ON "audit_logs"("companyId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_level_idx" ON "audit_logs"("level");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "persons_email_key" ON "persons"("email");

-- CreateIndex
CREATE INDEX "persons_email_idx" ON "persons"("email");

-- CreateIndex
CREATE INDEX "persons_name_firstName_idx" ON "persons"("name", "firstName");

-- CreateIndex
CREATE INDEX "persons_addressId_idx" ON "persons"("addressId");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_externalAttachmentId_key" ON "attachments"("externalAttachmentId");

-- CreateIndex
CREATE INDEX "attachments_companyId_idx" ON "attachments"("companyId");

-- CreateIndex
CREATE INDEX "attachments_integrationId_idx" ON "attachments"("integrationId");

-- CreateIndex
CREATE INDEX "attachments_bankTransactionId_idx" ON "attachments"("bankTransactionId");

-- CreateIndex
CREATE INDEX "attachments_transactionUuid_idx" ON "attachments"("transactionUuid");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_integrationId_externalAttachmentId_key" ON "attachments"("integrationId", "externalAttachmentId");

-- CreateIndex
CREATE INDEX "balance_sheet_line_configs_companyId_reportVariant_idx" ON "balance_sheet_line_configs"("companyId", "reportVariant");

-- CreateIndex
CREATE INDEX "balance_sheet_line_configs_parentId_idx" ON "balance_sheet_line_configs"("parentId");

-- CreateIndex
CREATE INDEX "balance_sheet_line_configs_templateId_idx" ON "balance_sheet_line_configs"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "balance_sheet_line_configs_companyId_reportVariant_id_versi_key" ON "balance_sheet_line_configs"("companyId", "reportVariant", "id", "version");

-- CreateIndex
CREATE INDEX "income_statement_line_configs_companyId_reportVariant_idx" ON "income_statement_line_configs"("companyId", "reportVariant");

-- CreateIndex
CREATE INDEX "income_statement_line_configs_parentId_idx" ON "income_statement_line_configs"("parentId");

-- CreateIndex
CREATE INDEX "income_statement_line_configs_templateId_idx" ON "income_statement_line_configs"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "income_statement_line_configs_companyId_reportVariant_id_ve_key" ON "income_statement_line_configs"("companyId", "reportVariant", "id", "version");

-- CreateIndex
CREATE INDEX "balance_sheet_config_history_configId_idx" ON "balance_sheet_config_history"("configId");

-- CreateIndex
CREATE UNIQUE INDEX "balance_sheet_config_history_configId_version_key" ON "balance_sheet_config_history"("configId", "version");

-- CreateIndex
CREATE INDEX "income_statement_config_history_configId_idx" ON "income_statement_config_history"("configId");

-- CreateIndex
CREATE UNIQUE INDEX "income_statement_config_history_configId_version_key" ON "income_statement_config_history"("configId", "version");

-- CreateIndex
CREATE INDEX "balance_sheet_config_templates_isPublic_idx" ON "balance_sheet_config_templates"("isPublic");

-- CreateIndex
CREATE INDEX "balance_sheet_config_templates_companyId_idx" ON "balance_sheet_config_templates"("companyId");

-- CreateIndex
CREATE INDEX "income_statement_config_templates_isPublic_idx" ON "income_statement_config_templates"("isPublic");

-- CreateIndex
CREATE INDEX "income_statement_config_templates_companyId_idx" ON "income_statement_config_templates"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "auth_account_userId_idx" ON "auth_account"("userId");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE INDEX "apikey_configId_idx" ON "apikey"("configId");

-- CreateIndex
CREATE INDEX "apikey_referenceId_idx" ON "apikey"("referenceId");

-- CreateIndex
CREATE INDEX "apikey_key_idx" ON "apikey"("key");

-- CreateIndex
CREATE UNIQUE INDEX "organization_companyId_key" ON "organization"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");

-- CreateIndex
CREATE INDEX "member_organizationId_idx" ON "member"("organizationId");

-- CreateIndex
CREATE INDEX "member_userId_idx" ON "member"("userId");

-- CreateIndex
CREATE INDEX "invitation_organizationId_idx" ON "invitation"("organizationId");

-- CreateIndex
CREATE INDEX "invitation_email_idx" ON "invitation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "oauthClient_clientId_key" ON "oauthClient"("clientId");

-- CreateIndex
CREATE INDEX "oauthClient_userId_idx" ON "oauthClient"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "oauthResource_identifier_key" ON "oauthResource"("identifier");

-- CreateIndex
CREATE INDEX "oauthClientResource_clientId_idx" ON "oauthClientResource"("clientId");

-- CreateIndex
CREATE INDEX "oauthClientResource_resourceId_idx" ON "oauthClientResource"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "oauthRefreshToken_token_key" ON "oauthRefreshToken"("token");

-- CreateIndex
CREATE INDEX "oauthRefreshToken_clientId_idx" ON "oauthRefreshToken"("clientId");

-- CreateIndex
CREATE INDEX "oauthRefreshToken_sessionId_idx" ON "oauthRefreshToken"("sessionId");

-- CreateIndex
CREATE INDEX "oauthRefreshToken_userId_idx" ON "oauthRefreshToken"("userId");

-- CreateIndex
CREATE INDEX "oauthRefreshToken_authorizationCodeId_idx" ON "oauthRefreshToken"("authorizationCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "oauthAccessToken_token_key" ON "oauthAccessToken"("token");

-- CreateIndex
CREATE INDEX "oauthAccessToken_clientId_idx" ON "oauthAccessToken"("clientId");

-- CreateIndex
CREATE INDEX "oauthAccessToken_sessionId_idx" ON "oauthAccessToken"("sessionId");

-- CreateIndex
CREATE INDEX "oauthAccessToken_userId_idx" ON "oauthAccessToken"("userId");

-- CreateIndex
CREATE INDEX "oauthAccessToken_authorizationCodeId_idx" ON "oauthAccessToken"("authorizationCodeId");

-- CreateIndex
CREATE INDEX "oauthAccessToken_refreshId_idx" ON "oauthAccessToken"("refreshId");

-- CreateIndex
CREATE INDEX "oauthConsent_clientId_idx" ON "oauthConsent"("clientId");

-- CreateIndex
CREATE INDEX "oauthConsent_userId_idx" ON "oauthConsent"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "rateLimit_key_key" ON "rateLimit"("key");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_headquartersAddressId_fkey" FOREIGN KEY ("headquartersAddressId") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "establishments" ADD CONSTRAINT "establishments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "establishments" ADD CONSTRAINT "establishments_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shareholders" ADD CONSTRAINT "shareholders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shareholders" ADD CONSTRAINT "shareholders_companyShareholderId_fkey" FOREIGN KEY ("companyShareholderId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shareholders" ADD CONSTRAINT "shareholders_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_lines" ADD CONSTRAINT "entry_lines_accountingEntryId_accountingEntryNumber_fkey" FOREIGN KEY ("accountingEntryId", "accountingEntryNumber") REFERENCES "accounting_entries"("id", "entryNumber") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_lines" ADD CONSTRAINT "entry_lines_accountId_accountFiscalYearId_fkey" FOREIGN KEY ("accountId", "accountFiscalYearId") REFERENCES "accounts"("id", "fiscalYearId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_selectedAccountId_fkey" FOREIGN KEY ("selectedAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_bankConnectionId_fkey" FOREIGN KEY ("bankConnectionId") REFERENCES "bank_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_integrationResourceId_fkey" FOREIGN KEY ("integrationResourceId") REFERENCES "integration_resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_rules" ADD CONSTRAINT "transaction_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_rule_conditions" ADD CONSTRAINT "transaction_rule_conditions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "transaction_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_rule_entry_lines" ADD CONSTRAINT "transaction_rule_entry_lines_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "transaction_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_mappings" ADD CONSTRAINT "transaction_mappings_bankConnectionId_fkey" FOREIGN KEY ("bankConnectionId") REFERENCES "bank_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_features" ADD CONSTRAINT "integration_features_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_resources" ADD CONSTRAINT "integration_resources_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sync_logs" ADD CONSTRAINT "integration_sync_logs_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_assetAccountId_fkey" FOREIGN KEY ("assetAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_depreciationAccountId_fkey" FOREIGN KEY ("depreciationAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_depreciations" ADD CONSTRAINT "fixed_asset_depreciations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_depreciations" ADD CONSTRAINT "fixed_asset_depreciations_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_depreciations" ADD CONSTRAINT "fixed_asset_depreciations_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_depreciations" ADD CONSTRAINT "fixed_asset_depreciations_accountingEntryId_fkey" FOREIGN KEY ("accountingEntryId") REFERENCES "accounting_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_regime_history" ADD CONSTRAINT "tax_regime_history_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_regime_history" ADD CONSTRAINT "tax_regime_history_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "establishments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "bank_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_sheet_line_configs" ADD CONSTRAINT "balance_sheet_line_configs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_sheet_line_configs" ADD CONSTRAINT "balance_sheet_line_configs_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "balance_sheet_line_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_statement_line_configs" ADD CONSTRAINT "income_statement_line_configs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_statement_line_configs" ADD CONSTRAINT "income_statement_line_configs_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "income_statement_line_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_sheet_config_history" ADD CONSTRAINT "balance_sheet_config_history_configId_fkey" FOREIGN KEY ("configId") REFERENCES "balance_sheet_line_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_statement_config_history" ADD CONSTRAINT "income_statement_config_history_configId_fkey" FOREIGN KEY ("configId") REFERENCES "income_statement_line_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization" ADD CONSTRAINT "organization_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauthClient" ADD CONSTRAINT "oauthClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauthClientResource" ADD CONSTRAINT "oauthClientResource_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauthClientResource" ADD CONSTRAINT "oauthClientResource_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "oauthResource"("identifier") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_refreshId_fkey" FOREIGN KEY ("refreshId") REFERENCES "oauthRefreshToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauthConsent" ADD CONSTRAINT "oauthConsent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauthConsent" ADD CONSTRAINT "oauthConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

