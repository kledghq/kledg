/**
 * Email templates (lib/email/templates.ts): French subject, HTML and plain
 * text of each message, the link in the button and in clear, and the
 * escaping of the user-provided address of an email change notice.
 */

import { describe, expect, it } from 'vitest'
import {
  changeEmailVerificationEmail,
  companyInvitationEmail,
  emailChangeNoticeEmail,
  resetPasswordEmail,
  verifyEmailEmail,
  welcomeEmail,
} from '@/lib/email/templates'

const URL = 'https://kledg.example.com/api/auth/reset-password/tok123?callbackURL=%2Freset-password'

describe.each([
  {
    name: 'resetPasswordEmail',
    build: resetPasswordEmail,
    subject: 'Réinitialisation de votre mot de passe Kledg',
    title: 'Réinitialiser votre mot de passe',
    button: 'Choisir un nouveau mot de passe',
    text: `Réinitialisez votre mot de passe Kledg (lien valable une heure) : ${URL}`,
  },
  {
    name: 'verifyEmailEmail',
    build: verifyEmailEmail,
    subject: 'Confirmez votre adresse email Kledg',
    title: 'Confirmer votre adresse email',
    button: "Confirmer l'adresse",
    text: `Confirmez votre adresse email Kledg : ${URL}`,
  },
  {
    name: 'welcomeEmail',
    build: welcomeEmail,
    subject: 'Votre accès à Kledg',
    title: 'Bienvenue sur Kledg',
    button: 'Choisir mon mot de passe',
    text: `Un accès Kledg vous a été ouvert. Choisissez votre mot de passe : ${URL}`,
  },
  {
    name: 'changeEmailVerificationEmail',
    build: changeEmailVerificationEmail,
    subject: 'Confirmez votre nouvelle adresse email Kledg',
    title: 'Confirmer votre nouvelle adresse',
    button: 'Confirmer la nouvelle adresse',
    text: `Confirmez votre nouvelle adresse email Kledg : ${URL}`,
  },
])('$name', ({ build, subject, title, button, text }) => {
  const message = build('marie@example.fr', URL)

  it('is addressed to the user with its French subject and plain text', () => {
    expect(message.to).toBe('marie@example.fr')
    expect(message.subject).toBe(subject)
    expect(message.text).toBe(text)
  })

  it('renders a French HTML page with the title, the button and the link in clear', () => {
    expect(message.html).toMatch(/^<!doctype html>\n<html lang="fr">/)
    expect(message.html).toContain(`<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${title}</h1>`)
    expect(message.html).toContain(`<a href="${URL}"`)
    expect(message.html).toContain(`>${button}</a>`)
    expect(message.html).toContain(`word-break:break-all">${URL}</p>`)
  })
})

describe('emailChangeNoticeEmail', () => {
  const profile = 'https://kledg.example.com/settings/profile'

  it('tells the current address which new address was asked, with a link to the profile', () => {
    const message = emailChangeNoticeEmail('marie@example.fr', 'marie.durand@example.fr', profile)
    expect(message.to).toBe('marie@example.fr')
    expect(message.subject).toBe("Changement d'adresse email demandé sur Kledg")
    expect(message.html).toContain('vers <strong>marie.durand@example.fr</strong> a été demandé')
    expect(message.html).toContain(`<a href="${profile}"`)
    expect(message.text).toBe(
      `Un changement de l'adresse de votre compte Kledg vers marie.durand@example.fr a été demandé. Si ce n'est pas vous, changez votre mot de passe : ${profile}`,
    )
  })

  it('escapes the new address in the HTML', () => {
    const message = emailChangeNoticeEmail('marie@example.fr', '"><img src=x onerror=alert(1)>&@evil.example', profile)
    expect(message.html).toContain('<strong>&quot;&gt;&lt;img src=x onerror=alert(1)&gt;&amp;@evil.example</strong>')
    expect(message.html).not.toContain('<img src=x')
  })
})

describe('[KLEDG-R3-INPUT-06] links in templates', () => {
  it('escapes the URL in the button and in clear', () => {
    const url = 'https://kledg.example.com/x?a=1&b="><img src=x onerror=alert(1)>'
    const { html } = resetPasswordEmail('a@example.fr', url)
    expect(html).not.toContain('"><img')
    expect(html).toContain('href="https://kledg.example.com/x?a=1&amp;b=&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"')
  })

  it('never links anything but http(s)', () => {
    const { html } = welcomeEmail('a@example.fr', 'javascript:alert(1)')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('href="#"')
  })
})

describe('companyInvitationEmail (issue #13)', () => {
  const invitation = { companyName: 'Atelier <b>Lumen</b> & Co', inviterName: 'Claire "Admin"', roleLabel: 'Comptable', expiresOn: '15/10/2026' }
  const url = 'https://kledg.example.com/invitation/abc"><img src=x>'

  it('names the company, the inviter, the role and the expiry, with the link in the button and in clear', () => {
    const message = companyInvitationEmail('expert@cabinet.fr', invitation, 'https://kledg.example.com/invitation/abc')
    expect(message.to).toBe('expert@cabinet.fr')
    expect(message.subject).toBe('Invitation à rejoindre Atelier <b>Lumen</b> & Co sur Kledg')
    expect(message.text).toContain('Comptable')
    expect(message.text).toContain('15/10/2026')
    expect(message.text).toContain('https://kledg.example.com/invitation/abc')
    expect(message.html).toContain('href="https://kledg.example.com/invitation/abc"')
  })

  it('escapes the company name, the inviter name and the URL in the HTML', () => {
    const { html } = companyInvitationEmail('expert@cabinet.fr', invitation, url)
    expect(html).not.toContain('<b>Lumen</b>')
    expect(html).toContain('Atelier &lt;b&gt;Lumen&lt;/b&gt; &amp; Co')
    expect(html).toContain('Claire &quot;Admin&quot;')
    expect(html).not.toContain('"><img')
  })
})
