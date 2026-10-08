/**
 * Which password reset email is a welcome: decided on the server, never from
 * the reset URL (KLEDG-R3-INPUT-06). Anyone may ask for a reset link with
 * any redirect, so a `welcome=1` in the URL would let an anonymous caller
 * send an existing user the "Un accès vous a été ouvert" email. Adding a
 * member (lib/rbac/add-member-to-company.service.ts) requests the reset
 * inside sendAsWelcome; Better Auth calls the sendResetPassword hook
 * (lib/auth.ts) in the same async context, which isWelcomeReset reads.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

const welcome = new AsyncLocalStorage<true>()

/** Runs `request` (a password reset request) so that its email is the welcome one. */
export function sendAsWelcome<T>(request: () => Promise<T>): Promise<T> {
  return welcome.run(true, request)
}

/** Whether the reset email being sent now was requested by sendAsWelcome. */
export function isWelcomeReset(): boolean {
  return welcome.getStore() === true
}
