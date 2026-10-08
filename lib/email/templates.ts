/**
 * Email templates (French). Plain HTML with inline styles so they render in
 * every client without a build step.
 */

import { APP_NAME } from '@/lib/config'
import type { EmailMessage } from '@/lib/email'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Only http(s) links reach a template; the URL is escaped wherever it appears (KLEDG-R3-INPUT-06). */
function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? escapeHtml(url) : '#'
}

function layout(title: string, intro: string, cta: { label: string; url: string }, outro: string): string {
  const url = safeUrl(cta.url)
  return `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:32px 16px;background:#f6f6f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#18181b">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px">
      <tr><td style="padding:32px">
        <p style="margin:0 0 24px;font-size:15px;font-weight:600;letter-spacing:-0.01em">${APP_NAME}</p>
        <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${title}</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3f3f46">${intro}</p>
        <a href="${url}" style="display:inline-block;padding:10px 18px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500">${cta.label}</a>
        <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#71717a">${outro}</p>
        <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#a1a1aa;word-break:break-all">${url}</p>
      </td></tr>
    </table>
  </body>
</html>`
}

export function resetPasswordEmail(to: string, url: string): EmailMessage {
  return {
    to,
    subject: `Réinitialisation de votre mot de passe ${APP_NAME}`,
    html: layout(
      'Réinitialiser votre mot de passe',
      'Vous avez demandé à réinitialiser votre mot de passe. Ce lien est valable une heure.',
      { label: 'Choisir un nouveau mot de passe', url },
      "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe reste inchangé.",
    ),
    text: `Réinitialisez votre mot de passe ${APP_NAME} (lien valable une heure) : ${url}`,
  }
}

export function setupLinkEmail(to: string, url: string, ttlMinutes: number): EmailMessage {
  return {
    to,
    subject: `Votre lien d'installation ${APP_NAME}`,
    html: layout(
      'Créer le compte administrateur',
      `Votre instance ${APP_NAME} est en ligne. Ce lien ouvre la création du compte administrateur ; il est valable ${ttlMinutes} minutes.`,
      { label: 'Créer mon compte', url },
      "Si vous n'avez pas déployé Kledg, ignorez cet email : sans ce lien, personne ne peut créer le compte.",
    ),
    text: `Créez le compte administrateur de votre instance ${APP_NAME} (lien valable ${ttlMinutes} minutes) : ${url}`,
  }
}

export function testEmail(to: string, url: string): EmailMessage {
  return {
    to,
    subject: `Email de test ${APP_NAME}`,
    html: layout(
      'Les emails fonctionnent',
      `Cet email de test confirme que votre instance ${APP_NAME} envoie ses emails : invitations, mots de passe oubliés et liens de vérification partiront de la même adresse.`,
      { label: 'Ouvrir la configuration', url },
      "Vous l'avez demandé depuis la page Configuration de votre instance.",
    ),
    text: `Email de test ${APP_NAME} : votre instance envoie ses emails. ${url}`,
  }
}

export function verifyEmailEmail(to: string, url: string): EmailMessage {
  return {
    to,
    subject: `Confirmez votre adresse email ${APP_NAME}`,
    html: layout(
      'Confirmer votre adresse email',
      'Confirmez votre adresse pour finaliser la création de votre compte.',
      { label: "Confirmer l'adresse", url },
      "Si vous n'avez pas créé de compte, ignorez cet email.",
    ),
    text: `Confirmez votre adresse email ${APP_NAME} : ${url}`,
  }
}

export function welcomeEmail(to: string, url: string): EmailMessage {
  return {
    to,
    subject: `Votre accès à ${APP_NAME}`,
    html: layout(
      `Bienvenue sur ${APP_NAME}`,
      'Un administrateur vous a ouvert un accès. Choisissez votre mot de passe pour vous connecter. Ce lien est valable une heure ; passé ce délai, utilisez « Mot de passe oublié » sur la page de connexion.',
      { label: 'Choisir mon mot de passe', url },
      "Si vous n'attendiez pas cet accès, ignorez cet email.",
    ),
    text: `Un accès ${APP_NAME} vous a été ouvert. Choisissez votre mot de passe : ${url}`,
  }
}

/** Sent to the new address of an email change: following the link proves the user owns it. */
export function changeEmailVerificationEmail(to: string, url: string): EmailMessage {
  return {
    to,
    subject: `Confirmez votre nouvelle adresse email ${APP_NAME}`,
    html: layout(
      'Confirmer votre nouvelle adresse',
      `Vous avez demandé à utiliser cette adresse pour votre compte ${APP_NAME}. Confirmez-la pour terminer le changement : vous vous connecterez ensuite avec elle.`,
      { label: 'Confirmer la nouvelle adresse', url },
      "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : l'adresse du compte ne change pas.",
    ),
    text: `Confirmez votre nouvelle adresse email ${APP_NAME} : ${url}`,
  }
}

/** Sent to the current address when a change to `newEmail` is requested. */
export function emailChangeNoticeEmail(to: string, newEmail: string, profileUrl: string): EmailMessage {
  return {
    to,
    subject: `Changement d'adresse email demandé sur ${APP_NAME}`,
    html: layout(
      "Changement d'adresse demandé",
      `Un changement de l'adresse de votre compte ${APP_NAME} vers <strong>${escapeHtml(newEmail)}</strong> a été demandé. Il ne prend effet que lorsque le lien envoyé à la nouvelle adresse est ouvert.`,
      { label: 'Ouvrir mon profil', url: profileUrl },
      "Si vous n'êtes pas à l'origine de cette demande, changez votre mot de passe et déconnectez les autres sessions depuis votre profil.",
    ),
    text: `Un changement de l'adresse de votre compte ${APP_NAME} vers ${newEmail} a été demandé. Si ce n'est pas vous, changez votre mot de passe : ${profileUrl}`,
  }
}

/**
 * Notice to the owner of a new API key (KLEDG-R3-AUTH-01): someone who held
 * the session could create one; the owner hears of it. Never the secret,
 * only its name, its access and its expiry.
 */
export function apiKeyCreatedEmail(
  to: string,
  key: { name: string; access: string; expiresOn: string | null },
  settingsUrl: string,
): EmailMessage {
  const expiry = key.expiresOn ? `Elle expire le ${key.expiresOn}.` : 'Elle n’expire pas (lecture seule).'
  return {
    to,
    subject: `Nouvelle clé API sur ${APP_NAME}`,
    html: layout(
      'Nouvelle clé API',
      `Une clé API « ${escapeHtml(key.name)} » a été créée sur votre compte ${APP_NAME}, avec l’accès « ${escapeHtml(key.access)} ». ${expiry}`,
      { label: 'Voir mes clés API', url: settingsUrl },
      "Si vous n'êtes pas à l'origine de cette clé, révoquez-la depuis vos clés API, puis changez votre mot de passe : cela supprime aussi toutes vos clés et déconnecte vos assistants IA.",
    ),
    text: `Une clé API « ${key.name} » a été créée sur votre compte ${APP_NAME} (accès : ${key.access}). ${expiry} Si ce n'est pas vous, révoquez-la et changez votre mot de passe : ${settingsUrl}`,
  }
}
