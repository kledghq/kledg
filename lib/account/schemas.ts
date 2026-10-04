/**
 * Input schemas of the account routes (app/api/account). Pure (zod only):
 * the profile page validates its forms with the same rules.
 */

import { z } from 'zod'

/** Same minimum as the server (emailAndPassword.minPasswordLength in lib/auth.ts). */
export const MIN_PASSWORD_LENGTH = 10

export const UpdateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Saisissez votre nom').max(100, 'Nom trop long (100 caractères au plus)'),
})
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>

export const ChangeEmailSchema = z.object({
  newEmail: z.string().trim().toLowerCase().email('Adresse email invalide').max(254, 'Adresse email trop longue'),
  password: z.string().min(1, 'Saisissez votre mot de passe'),
})
export type ChangeEmailInput = z.infer<typeof ChangeEmailSchema>

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Saisissez votre mot de passe actuel'),
  newPassword: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Au moins ${MIN_PASSWORD_LENGTH} caractères`)
    .max(128, 'Mot de passe trop long (128 caractères au plus)'),
  revokeOtherSessions: z.boolean().optional(),
})
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>

export const DeleteAccountSchema = z.object({
  /** Typed by the user to confirm: the account's email. */
  email: z.string().trim().min(1, 'Saisissez votre adresse email'),
  password: z.string().min(1, 'Saisissez votre mot de passe'),
})
export type DeleteAccountInput = z.infer<typeof DeleteAccountSchema>
