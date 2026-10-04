/**
 * Input schemas of the instance user management (app/api/users/[id]).
 * Pure (zod only): the "Utilisateurs" page validates its forms with them.
 */

import { z } from 'zod'

/** Better Auth roles of an account: instance administrator or regular user. */
export const INSTANCE_ROLES = ['admin', 'user'] as const
export type InstanceRole = (typeof INSTANCE_ROLES)[number]

export const INSTANCE_ROLE_LABELS: Record<InstanceRole, string> = {
  admin: "Administrateur de l'instance",
  user: 'Utilisateur',
}

/** Body of POST /api/users: an account created by an administrator (always a regular user). */
export const CreateInstanceUserSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse email invalide').max(254, 'Adresse email trop longue'),
  password: z.string().min(10, 'Au moins 10 caractères').max(128, 'Mot de passe trop long (128 caractères au plus)'),
  name: z.string().trim().max(100, 'Nom trop long (100 caractères au plus)').optional(),
})
export type CreateInstanceUserInput = z.infer<typeof CreateInstanceUserSchema>

export const ChangeUserEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse email invalide').max(254, 'Adresse email trop longue'),
  /** The administrator's own password: an open session alone cannot redirect an account to another mailbox. */
  password: z.string().min(1, 'Saisissez votre mot de passe'),
})
export type ChangeUserEmailInput = z.infer<typeof ChangeUserEmailSchema>

export const UpdateInstanceUserSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set-role'), role: z.enum(INSTANCE_ROLES) }),
  z.object({ action: z.literal('ban') }),
  z.object({ action: z.literal('unban') }),
  ChangeUserEmailSchema.extend({ action: z.literal('change-email') }),
])
export type UpdateInstanceUserInput = z.infer<typeof UpdateInstanceUserSchema>
