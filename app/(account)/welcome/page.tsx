import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, ArrowUpRight, CircleArrowUp, DatabaseBackup, Mail } from 'lucide-react'
import { getCurrentUser } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { isGlobalAdmin } from '@/lib/rbac/authorize'
import { isActionAllowed } from '@/lib/instance'
import { getDeployedVersion } from '@/lib/updates/version'
import { instanceStatus, type EmailStatus } from '@/lib/onboarding/instance-status'
import { docsUrl } from '@/lib/docs-links'
import { PLATFORM_LABELS, type Platform } from '@/lib/updates/hosting'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader, StatusBadge, type StatusTone } from '@/components/shared'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Bienvenue' }

const SELF_HOSTING_URL = 'https://www.kledg.com/fr/self-hosting'

/** Hosts whose PostgreSQL service is managed (and backed up) by the host, under its own plans. */
const MANAGED_DATABASE_HOSTS: ReadonlySet<Platform> = new Set<Platform>(['railway', 'render', 'fly', 'clevercloud'])

const EMAIL: Record<EmailStatus, { tone: StatusTone; label: string }> = {
  configured: { tone: 'success', label: 'Configuré' },
  'test-sender': { tone: 'warning', label: 'Expéditeur de test' },
  'log-only': { tone: 'warning', label: 'Non configuré' },
  disabled: { tone: 'neutral', label: 'Désactivé sur cette instance' },
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-link inline-flex items-center gap-1 underline-offset-4 hover:underline pointer-coarse:-my-3 pointer-coarse:py-3">
      {children}
      <ArrowUpRight aria-hidden className="size-3.5" />
    </a>
  )
}

function StatusRow({
  icon: Icon,
  title,
  status,
  children,
}: {
  icon: typeof Mail
  title: string
  status: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <li className="flex gap-3 py-4 first:pt-0 last:pb-0">
      <span aria-hidden className="bg-background text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {status}
        </div>
        <div className="text-muted-foreground max-w-prose space-y-2 text-sm">{children}</div>
      </div>
    </li>
  )
}

/**
 * First run of an instance, after /setup: what works already, what to set
 * up (emails), where updates and backups happen, then the first company.
 * Instance administrators only; an instance may hide it (policy action
 * "onboarding").
 */
export default async function WelcomePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!isGlobalAdmin(user) || !(await isActionAllowed('onboarding', user))) redirect('/companies')

  const status = instanceStatus(process.env, { sendEmailAllowed: await isActionAllowed('send-email', user) })
  const { version } = getDeployedVersion()
  const companies = await prisma.company.count()
  const email = EMAIL[status.email]

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Bienvenue sur votre instance Kledg"
        description="Votre compte administrateur est prêt. Voici l'état de l'instance et les trois points à connaître avant de créer votre première société."
        docsHref={docsUrl('install')}
      />

      <Card>
        <CardHeader>
          <CardTitle>État de l&apos;instance</CardTitle>
          <CardDescription>Ces réglages se font dans les variables d&apos;environnement de votre hébergement.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            <StatusRow icon={Mail} title="Envoi des emails" status={<StatusBadge tone={email.tone}>{email.label}</StatusBadge>}>
              {status.email === 'configured' ? (
                <p>
                  Les emails partent de <span className="text-foreground">{status.emailFrom}</span> : mot de passe oublié et
                  accès donnés à vos collaborateurs.
                </p>
              ) : status.email === 'test-sender' ? (
                <p>
                  RESEND_API_KEY est défini, mais pas EMAIL_FROM&nbsp;: l&apos;expéditeur de test de Resend ne livre qu&apos;à
                  l&apos;adresse de votre compte Resend. Ajoutez EMAIL_FROM avec une adresse de votre domaine vérifié chez
                  Resend, puis redéployez.
                </p>
              ) : status.email === 'disabled' ? (
                <p>Cette instance n&apos;envoie pas d&apos;emails&nbsp;: ils sont écrits dans les journaux du serveur.</p>
              ) : (
                <p>
                  Sans RESEND_API_KEY, aucun email ne part&nbsp;: le lien de mot de passe oublié et les accès des
                  collaborateurs sont seulement écrits dans les journaux du serveur. Créez un compte Resend, puis
                  ajoutez RESEND_API_KEY et EMAIL_FROM et redéployez.
                </p>
              )}
              {status.email !== 'configured' && status.email !== 'disabled' ? (
                <p>
                  <ExternalLink href={SELF_HOSTING_URL}>Configurer les emails</ExternalLink>
                </p>
              ) : null}
            </StatusRow>

            <StatusRow
              icon={CircleArrowUp}
              title="Mises à jour"
              status={
                <StatusBadge tone="info">
                  Version <span className="num">{version}</span>
                </StatusBadge>
              }
            >
              <p>
                Kledg évolue régulièrement. La page Mises à jour indique la version installée, les nouveautés et les
                changements de la base ; une fois GitHub connecté, une mise à jour s&apos;installe en deux clics.
              </p>
              <p>
                <Link href="/settings/updates" className="text-link inline-flex underline-offset-4 hover:underline pointer-coarse:-my-3 pointer-coarse:py-3">
                  Ouvrir Mises à jour
                </Link>
              </p>
            </StatusRow>

            <StatusRow icon={DatabaseBackup} title="Sauvegardes" status={<StatusBadge>À organiser</StatusBadge>}>
              {status.platform === 'vercel' ? (
                <p>
                  Votre base est chez Neon. Avant chaque mise à jour, créez une branche de sauvegarde dans la console Neon&nbsp;:
                  c&apos;est une copie instantanée de la base. Neon permet aussi de revenir à un état passé, dans la limite
                  de l&apos;historique de votre offre.
                </p>
              ) : MANAGED_DATABASE_HOSTS.has(status.platform) ? (
                <p>
                  Vérifiez dans la console {PLATFORM_LABELS[status.platform]} que la base est sauvegardée automatiquement et
                  combien de temps les sauvegardes sont gardées (selon l&apos;offre). Pour une copie indépendante, planifiez aussi
                  un <code className="font-mono text-xs">pg_dump</code> vers un stockage que vous contrôlez.
                </p>
              ) : (
                <p>
                  Planifiez chaque jour un <code className="font-mono text-xs">pg_dump</code> de la base, copiez les
                  fichiers hors du serveur et testez de temps en temps une restauration avec{' '}
                  <code className="font-mono text-xs">pg_restore</code>.
                </p>
              )}
              <p>Les livres se conservent dix ans&nbsp;: gardez aussi l&apos;export FEC de chaque exercice clôturé.</p>
              <p>
                <ExternalLink href={status.platform === 'vercel' ? docsUrl('install') : `${docsUrl('docker')}#les-sauvegardes`}>
                  {status.platform === 'vercel' ? 'Installer et mettre à jour Kledg' : 'Sauvegarder une instance Docker'}
                </ExternalLink>
              </p>
            </StatusRow>
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        {companies === 0 ? (
          <Button asChild size="lg">
            <Link href="/companies/new">
              Créer ma première société
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        ) : (
          <Button asChild size="lg">
            <Link href="/companies">
              Aller à mes sociétés
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        )}
        <p className="text-muted-foreground text-sm">Vous retrouverez cette page dans Instance, État de l&apos;instance.</p>
      </div>
    </div>
  )
}
