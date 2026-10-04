import { prisma } from '@/lib/prisma'

function slugifyCompany(name: string, id: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const suffix = id.slice(-6)
  return base ? `${base}-${suffix}` : `company-${suffix}`
}

export async function ensureCompanyOrganization(companyId: string) {
  const existing = await prisma.organization.findUnique({
    where: { companyId },
  })
  if (existing) return existing

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true },
  })
  if (!company) {
    throw new Error(`Company not found: ${companyId}`)
  }

  return prisma.organization.create({
    data: {
      id: company.id,
      name: company.name,
      slug: slugifyCompany(company.name, company.id),
      createdAt: new Date(),
      companyId: company.id,
    },
  })
}
