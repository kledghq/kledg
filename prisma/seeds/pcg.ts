import { prisma } from '@/lib/prisma'
import { PCG_ACCOUNTS, isOptionalPcgAccount } from '@/lib/accounting/pcg-data'

/**
 * Seed le PCG pour une entreprise et un exercice fiscal
 * @param companyId - ID de l'entreprise
 * @param fiscalYearId - ID de l'exercice fiscal
 * @param includeOptionalAccounts - Si true, inclut les comptes facultatifs (classe 8 et comptes > 4 chiffres, hors comptes mouvementés par Kledg)
 */
export async function seedPCG(companyId: string, fiscalYearId: string, includeOptionalAccounts: boolean = false) {
  console.log(`Seeding PCG for company ${companyId}, fiscal year ${fiscalYearId} (optional accounts: ${includeOptionalAccounts})...`)

  // Filtrer les comptes selon le paramètre
  const accountsToSeed = includeOptionalAccounts
    ? PCG_ACCOUNTS
    : PCG_ACCOUNTS.filter(account => !isOptionalPcgAccount(account.code))

  // Créer un mapping des codes de compte vers les IDs créés
  const accountMap = new Map<string, string>()

  // Récupérer les comptes existants pour cet exercice fiscal pour initialiser accountMap
  const existingAccounts = await prisma.account.findMany({
    where: {
      companyId,
      fiscalYearId,
      isPCG: true,
    },
  })
  existingAccounts.forEach(acc => {
    accountMap.set(acc.code, acc.id)
  })

  // Créer les comptes en plusieurs passes pour gérer les dépendances parent-enfant
  const remainingAccounts = new Map(accountsToSeed.map(acc => [acc.code, acc]))
  const maxIterations = 100 // Protection contre les boucles infinies
  let iteration = 0

  while (remainingAccounts.size > 0 && iteration < maxIterations) {
    iteration++
    let accountsProcessedThisPass = 0

    // Traiter tous les comptes dont le parent existe déjà
    for (const [code, pcgAccount] of remainingAccounts.entries()) {
      // Vérifier si le parent existe
      const parentExists = !pcgAccount.parentCode || accountMap.has(pcgAccount.parentCode)
      
      if (parentExists) {
        const parentId = pcgAccount.parentCode ? accountMap.get(pcgAccount.parentCode) : null

        const account = await prisma.account.upsert({
          where: {
            companyId_code_fiscalYearId: {
              companyId,
              code: pcgAccount.code,
              fiscalYearId,
            },
          },
          update: {
            label: pcgAccount.label,
            parentId: parentId || undefined,
            isPCG: true,
          },
          create: {
            code: pcgAccount.code,
            label: pcgAccount.label,
            companyId,
            fiscalYearId,
            parentId: parentId || undefined,
            isPCG: true,
          },
        })

        accountMap.set(pcgAccount.code, account.id)
        remainingAccounts.delete(code)
        accountsProcessedThisPass++
      }
    }

    // Si aucun compte n'a été traité dans cette passe, on a un problème de dépendances
    if (accountsProcessedThisPass === 0 && remainingAccounts.size > 0) {
      // Essayer de créer les comptes restants sans parent (au cas où il y aurait une erreur dans les données)
      const accountsWithoutParent = Array.from(remainingAccounts.values()).filter(
        acc => !acc.parentCode
      )
      
      if (accountsWithoutParent.length === 0) {
        // Tous les comptes restants ont un parent qui n'existe pas
        console.warn(
          `Warning: ${remainingAccounts.size} account(s) could not be seeded due to missing parent(s)`
        )
        break
      }
    }
  }

  const seededCount = accountsToSeed.length - remainingAccounts.size
  if (remainingAccounts.size > 0) {
    console.warn(
      `Warning: ${remainingAccounts.size} account(s) could not be seeded after ${iteration} iteration(s)`
    )
  }

  console.log(`✓ Seeded ${seededCount} PCG accounts for company ${companyId}, fiscal year ${fiscalYearId}`)
}
