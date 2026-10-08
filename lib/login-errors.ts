/**
 * Messages of the sign-in page for the `?error=` codes Kledg and Better Auth
 * send there (KLEDG-R3-AUTH-04). The parameter is a code, never text to
 * show: anything unknown gets a generic message, so a crafted link cannot
 * make the real sign-in page display an attacker's words.
 */

const LOGIN_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  // lib/auth.ts: an email change link opened in a signed out browser.
  SIGN_IN_TO_CONFIRM_EMAIL: 'Connectez-vous pour confirmer votre nouvelle adresse email.',
  INVALID_TOKEN: 'Ce lien n’est pas valide. Demandez-en un nouveau.',
  TOKEN_EXPIRED: 'Ce lien a expiré. Demandez-en un nouveau.',
  USER_NOT_FOUND: 'Ce lien ne correspond à aucun compte.',
  INVALID_USER: 'Ce lien concerne un autre compte. Déconnectez-vous, puis ouvrez-le à nouveau.',
  EMAIL_NOT_VERIFIED: 'Confirmez d’abord votre adresse email : ouvrez le lien de confirmation reçu par email.',
  SESSION_EXPIRED: 'Votre session a expiré. Reconnectez-vous.',
  // OAuth authorization (an AI assistant connecting, RFC 6749 section 4.1.2.1).
  access_denied: 'La connexion de l’assistant a été refusée.',
  login_required: 'Connectez-vous pour continuer.',
}

export const GENERIC_LOGIN_ERROR = 'La connexion n’a pas abouti. Réessayez.'

/** The message for an `?error=` value of the sign-in page. */
export function loginErrorMessage(code: string): string {
  return Object.hasOwn(LOGIN_ERROR_MESSAGES, code) ? LOGIN_ERROR_MESSAGES[code] : GENERIC_LOGIN_ERROR
}
