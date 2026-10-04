-- Legal forms and company onboarding.
-- Additive: new values of the CompanyLegalType enum (existing values kept)
-- and one new table. SASU, SCI, SELARL, SELAS and EI are forms of the
-- companies Kledg is made for that the enum lacked (an SASU was saved as SAS,
-- an SCI without a legal form). company_onboarding stores whether the
-- "Démarrer" checklist of a company was hidden; deleting the company deletes it.

-- AlterEnum
ALTER TYPE "CompanyLegalType" ADD VALUE IF NOT EXISTS 'SASU';
ALTER TYPE "CompanyLegalType" ADD VALUE IF NOT EXISTS 'SCI';
ALTER TYPE "CompanyLegalType" ADD VALUE IF NOT EXISTS 'SELARL';
ALTER TYPE "CompanyLegalType" ADD VALUE IF NOT EXISTS 'SELAS';
ALTER TYPE "CompanyLegalType" ADD VALUE IF NOT EXISTS 'EI';

-- CreateTable
CREATE TABLE "company_onboarding" (
    "companyId" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3),
    "dismissedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_onboarding_pkey" PRIMARY KEY ("companyId")
);

-- AddForeignKey
ALTER TABLE "company_onboarding" ADD CONSTRAINT "company_onboarding_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
