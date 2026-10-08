import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements, memberAc } from 'better-auth/plugins/organization/access'

/**
 * Per-company permissions. Every API route declares the permission it needs
 * (lib/api/route.ts); roles below decide who has it.
 *
 * - entries: accounting entries (validate = lock a draft as validated)
 * - ledger: chart of accounts, journals, assignment rules, fiscal years
 * - closing: fiscal year closing and reopening
 * - banking: read transactions, reconcile them, manage bank connections and credentials
 * - reports: read statements, export them (PDF, Excel, FEC)
 * - settings: company information, establishments, shareholders, report layouts
 * - members: company members: invitations by email and removals (company
 *   administrators, docs/membres-et-invitations.md); direct additions and
 *   role changes stay with instance administrators
 * - expenses: expense reports (notes de frais). submit = record and submit
 *   one's own reports; validate = see, edit, return and validate everyone's
 *   (docs/notes-de-frais.md). Posting and reimbursement use entries rights.
 * - budgets: budgets of the fiscal years (docs/budget.md). Reading the budget
 *   and its comparison with the books needs reports read.
 *
 * Better Auth's organization statements (organization, member, invitation...)
 * only get the read-only member set: the app manages members through its own
 * admin routes, and lib/auth.ts blocks the organization mutation endpoints.
 */
export const statement = {
  ...defaultStatements,
  entries: ['read', 'create', 'update', 'delete', 'validate'],
  ledger: ['manage'],
  closing: ['execute'],
  banking: ['read', 'reconcile', 'manage'],
  reports: ['read', 'export'],
  settings: ['read', 'update'],
  members: ['manage'],
  expenses: ['submit', 'validate'],
  budgets: ['manage'],
} as const

export const ac = createAccessControl(statement)

const allCompanyPermissions = {
  entries: ['read', 'create', 'update', 'delete', 'validate'],
  ledger: ['manage'],
  closing: ['execute'],
  banking: ['read', 'reconcile', 'manage'],
  reports: ['read', 'export'],
  settings: ['read', 'update'],
  members: ['manage'],
  expenses: ['submit', 'validate'],
  budgets: ['manage'],
} as const

/** Everything in the company, including bank credentials, settings and deletion. */
export const companyAdmin = ac.newRole({
  ...memberAc.statements,
  ...allCompanyPermissions,
})

/** Keeps the books: entries, ledger, closing, reconciliation, exports, budgets. No settings, no bank connections. */
export const accountant = ac.newRole({
  ...memberAc.statements,
  entries: ['read', 'create', 'update', 'delete', 'validate'],
  ledger: ['manage'],
  closing: ['execute'],
  banking: ['read', 'reconcile'],
  reports: ['read', 'export'],
  settings: ['read'],
  expenses: ['submit', 'validate'],
  budgets: ['manage'],
})

/**
 * Read-only on the books. Submits their own expense reports: an employee
 * given access to Kledg records what the company owes them, and changes
 * nothing else.
 */
export const viewer = ac.newRole({
  ...memberAc.statements,
  entries: ['read'],
  banking: ['read'],
  reports: ['read'],
  settings: ['read'],
  expenses: ['submit'],
})

/**
 * Better Auth's default creator role. Kledg never assigns it (organization
 * creation is disabled), it is kept so legacy rows keep working.
 */
export const owner = ac.newRole({
  ...memberAc.statements,
  ...allCompanyPermissions,
})

export const roles = {
  owner,
  companyAdmin,
  accountant,
  viewer,
}

export type CompanyRole = keyof typeof roles

/**
 * French names of the company roles: the one source for every screen
 * (Membres, account page) and every error message. Never write a role name
 * elsewhere.
 */
export const ROLE_LABELS: Record<string, string> = {
  owner: 'Propriétaire',
  companyAdmin: 'Administrateur',
  accountant: 'Comptable',
  viewer: 'Lecture seule',
}

/** What each role may do, in one sentence, for the help of the Membres page. */
export const ROLE_DESCRIPTIONS: Record<'companyAdmin' | 'accountant' | 'viewer', string> = {
  companyAdmin: 'gère les connexions bancaires, les informations et les réglages de la société, en plus de la comptabilité.',
  accountant: 'saisit et valide les écritures et les notes de frais, établit le budget, rapproche la banque et importe les relevés.',
  viewer: 'consulte sans rien modifier, et dépose ses propres notes de frais.',
}
