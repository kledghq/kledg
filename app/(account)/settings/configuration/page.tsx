import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, CircleArrowUp, DatabaseBackup, Globe, KeyRound, Landmark, Mail, ShieldCheck, Ticket } from 'lucide-react'
import { getCurrentUser } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { isGlobalAdmin } from '@/lib/rbac/authorize'
import { isActionAllowed } from '@/lib/instance'
import { getDeployedVersion } from '@/lib/updates/version'
import { instanceStatus, type EmailStatus, type InstanceStatus } from '@/lib/onboarding/instance-status'
import { docsUrl } from '@/lib/docs-links'
import { REPO_URL } from '@/lib/config'
import { PLATFORM_LABELS, type Platform } from '@/lib/updates/hosting'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader, StatusBadge, type StatusTone } from '@/components/shared'
import { ExternalLink, StatusRow, Steps } from '@/components/features/instance/status-row'
import { SecretGenerator, TestEmailButton } from '@/components/features/instance/configuration-parts'
import { LegacySecretsRow, type LegacySecretsCounts } from '@/components/features/instance/legacy-secrets-row'
import { countLegacySecrets } from '@/lib/crypto/reencrypt'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Configuration' }

const CONFIGURATION_DOC = `${REPO_URL}/blob/main/docs/configuration.md`
const EMAILS_DOC = `${docsUrl('install')}#ajouter-les-emails`

/** Hosts whose PostgreSQL service is managed (and backed up) by the host, under its own plans. */
const MANAGED_DATABASE_HOSTS: ReadonlySet<Platform> = new Set<Platform>(['railway', 'render', 'fly', 'clevercloud'])

const EMAIL: Record<EmailStatus, { tone: StatusTone; label: string }> = {
  configured: { tone: 'success', label: 'Configuré' },
  'test-sender': { tone: 'warning', label: 'Expéditeur de test' },
  'log-only': { tone: 'warning', label: 'Non configuré' },
  disabled: { tone: 'neutral', label: 'Désactivé sur cette instance' },
}

/** Where the host's environment variables are edited. */
function variablesPlace(platform: Platform): string {
  if (platform === 'vercel') return 'Vercel, Settings, Environment Variables'
  if (platform === 'docker' || platform === 'node') return "le fichier d'environnement de votre serveur"
  return `les variables du service ${PLATFORM_LABELS[platform]}`
}

function EmailsRow({ status }: { status: InstanceStatus }) {
  const email = EMAIL[status.email]
  return (
    <StatusRow icon={Mail} title="Emails" status={<StatusBadge tone={email.tone}>{email.label}</StatusBadge>}>
      {status.email === 'configured' && (
        <p>
          Les emails partent de <span className="text-foreground">{status.emailFrom}</span>&nbsp;: invitations, mots de
          passe oubliés et liens de vérification.
        </p>
      )}
      {status.email === 'disabled' && (
        <p>Cette instance n&apos;envoie pas d&apos;emails&nbsp;: ils sont écrits dans les journaux du serveur.</p>
      )}
      {status.email === 'test-sender' && (
        <>
          <p>
            Resend est branché, mais sans EMAIL_FROM son expéditeur de test n&apos;écrit qu&apos;à l&apos;adresse de votre
            compte Resend. Pour écrire à vos collaborateurs&nbsp;:
          </p>
          <Steps>
            {status.platform === 'vercel' ? (
              <li>
                dans Vercel, <strong className="text-foreground">Domains</strong>&nbsp;: ajoutez le domaine saisi pour Resend
                et revendiquez-le (<em>claim ownership</em>, un enregistrement DNS chez votre registraire)&nbsp;;
              </li>
            ) : (
              <li>dans Resend, vérifiez votre domaine (enregistrements DNS chez votre registraire)&nbsp;;</li>
            )}
            <li>
              définissez <code className="font-mono text-xs">EMAIL_FROM</code>, par exemple{' '}
              <code className="font-mono text-xs">Kledg &lt;compta@votre-societe.fr&gt;</code>, dans {variablesPlace(status.platform)}&nbsp;;
            </li>
            <li>redéployez.</li>
          </Steps>
        </>
      )}
      {status.email === 'log-only' && (
        <>
          <p>
            Aucun email ne part&nbsp;: invitations et mots de passe oubliés sont écrits dans les journaux du serveur. En
            attendant, l&apos;ajout d&apos;un membre affiche un mot de passe temporaire à lui transmettre.
          </p>
          <Steps>
            {status.platform === 'vercel' ? (
              <li>
                dans le projet Vercel, onglet <strong className="text-foreground">Storage</strong>, ajoutez{' '}
                <strong className="text-foreground">Resend</strong>&nbsp;: acceptez ses conditions, gardez l&apos;offre
                gratuite et tapez votre domaine. Vercel renseigne RESEND_API_KEY&nbsp;;
              </li>
            ) : (
              <li>
                créez un compte Resend et une clé API, puis définissez{' '}
                <code className="font-mono text-xs">RESEND_API_KEY</code> dans {variablesPlace(status.platform)}&nbsp;;
              </li>
            )}
            <li>
              revendiquez votre domaine ({status.platform === 'vercel' ? 'Vercel, Domains, claim ownership' : 'dans Resend'}),
              puis définissez <code className="font-mono text-xs">EMAIL_FROM</code>&nbsp;;
            </li>
            <li>redéployez.</li>
          </Steps>
        </>
      )}
      {status.email !== 'disabled' && status.email !== 'log-only' && <TestEmailButton />}
      {status.email !== 'configured' && status.email !== 'disabled' && (
        <p>
          <ExternalLink href={EMAILS_DOC}>Ajouter les emails</ExternalLink>
        </p>
      )}
    </StatusRow>
  )
}

function AddressRow({ status }: { status: InstanceStatus }) {
  const custom = Boolean(status.appUrl)
  return (
    <StatusRow
      icon={Globe}
      title="Adresse de l'instance"
      status={<StatusBadge tone={custom ? 'success' : 'info'}>{custom ? 'Domaine personnalisé' : "Adresse de l'hébergeur"}</StatusBadge>}
    >
      <p>
        Kledg répond sur <span className="text-foreground">{status.effectiveUrl}</span> et met cette adresse dans ses
        emails et ses liens.
      </p>
      {!custom && (
        <>
          <p>Pour utiliser votre propre domaine, par exemple compta.votre-societe.fr&nbsp;:</p>
          <Steps>
            {status.platform === 'vercel' ? (
              <li>
                dans le projet Vercel, <strong className="text-foreground">Settings, Domains</strong>, ajoutez le domaine et
                créez chez votre registraire l&apos;enregistrement DNS indiqué&nbsp;;
              </li>
            ) : (
              <li>faites pointer le domaine vers votre serveur ou votre hébergeur, avec un certificat HTTPS&nbsp;;</li>
            )}
            <li>
              définissez <code className="font-mono text-xs">BETTER_AUTH_URL</code>=https://compta.votre-societe.fr dans{' '}
              {variablesPlace(status.platform)}, puis redéployez.
            </li>
          </Steps>
          <p>L&apos;adresse de l&apos;hébergeur reste acceptée pour se connecter.</p>
        </>
      )}
    </StatusRow>
  )
}

function BankSyncRow({ status }: { status: InstanceStatus }) {
  return (
    <StatusRow
      icon={Landmark}
      title="Synchronisation bancaire planifiée"
      status={
        <StatusBadge tone={status.cronSecretSet ? 'success' : 'warning'}>{status.cronSecretSet ? 'Protégée' : 'Ouverte, limitée'}</StatusBadge>
      }
    >
      <p>
        {status.platform === 'vercel'
          ? 'Vercel appelle la synchronisation chaque jour à 5 h (UTC), comme prévu dans vercel.json.'
          : 'Planifiez chaque jour un appel à /api/cron/sync-banks (cron du serveur, GitHub Actions…).'}
      </p>
      {status.cronSecretSet ? (
        <p>CRON_SECRET est défini&nbsp;: seul l&apos;appel qui le présente lance la synchronisation.</p>
      ) : (
        <>
          <p>
            Sans CRON_SECRET, n&apos;importe qui peut appeler la synchronisation&nbsp;: elle reste donc limitée aux comptes non
            synchronisés depuis 20 heures, quatre fois par jour au plus, et ne renvoie qu&apos;un nombre. Pour la réserver à
            votre planificateur, définissez CRON_SECRET dans {variablesPlace(status.platform)}, puis redéployez
            {status.platform === 'vercel' ? '. Vercel le transmet tout seul.' : '. Votre planificateur l’envoie en en-tête Authorization: Bearer.'}
          </p>
          <SecretGenerator name="CRON_SECRET" />
        </>
      )}
    </StatusRow>
  )
}

function SecurityRows({ status, legacySecrets }: { status: InstanceStatus; legacySecrets: LegacySecretsCounts | null }) {
  return (
    <>
      <LegacySecretsRow counts={legacySecrets} docHref={`${CONFIGURATION_DOC}#ancien-format-de-chiffrement`} />
      <StatusRow
        icon={Ticket}
        title="Jeton d'installation"
        status={<StatusBadge tone={status.setupTokenSet ? 'warning' : 'success'}>{status.setupTokenSet ? 'À supprimer' : 'Aucun'}</StatusBadge>}
      >
        {status.setupTokenSet ? (
          <p>
            SETUP_TOKEN est encore défini alors que le compte administrateur existe&nbsp;: il ne sert plus. Supprimez-le de{' '}
            {variablesPlace(status.platform)}.
          </p>
        ) : (
          <p>Le compte administrateur existe&nbsp;: /setup n&apos;accepte plus aucun jeton.</p>
        )}
      </StatusRow>
      <StatusRow
        icon={KeyRound}
        title="Secret de l'instance"
        status={<StatusBadge tone={status.secretRotation ? 'warning' : 'success'}>{status.secretRotation ? 'Rotation en cours' : 'Stable'}</StatusBadge>}
      >
        {status.secretRotation ? (
          <p>
            BETTER_AUTH_SECRETS est défini&nbsp;: au démarrage, les accès bancaires chiffrés avec l&apos;ancien secret sont
            chiffrés de nouveau. Pour terminer, mettez le nouveau secret dans BETTER_AUTH_SECRET, supprimez
            BETTER_AUTH_SECRETS et redéployez.
          </p>
        ) : (
          <p>BETTER_AUTH_SECRET signe les sessions. S&apos;il a pu être lu par quelqu&apos;un d&apos;autre, changez-le sans reconnecter les banques.</p>
        )}
        <p>
          Accès bancaires chiffrés avec{' '}
          {status.encryptionKey === 'own' ? 'ENCRYPTION_KEY.' : 'une clé dérivée de BETTER_AUTH_SECRET.'}{' '}
          <ExternalLink href={`${CONFIGURATION_DOC}#changer-le-secret`}>Changer le secret</ExternalLink>
        </p>
      </StatusRow>
      <StatusRow
        icon={ShieldCheck}
        title="Isolation des sociétés dans la base"
        status={<StatusBadge tone={status.rls === 'enforce' ? 'success' : 'neutral'}>{status.rls === 'enforce' ? 'Active' : 'Désactivée'}</StatusBadge>}
      >
        <p>
          {status.rls === 'enforce'
            ? "La base refuse les lignes des autres sociétés, même si une requête oublie son filtre."
            : "Kledg filtre chaque requête par société. Avec KLEDG_RLS=enforce, la base le vérifie aussi, en seconde barrière."}
        </p>
        {status.rls !== 'enforce' && (
          <p>
            <ExternalLink href={`${REPO_URL}/blob/main/docs/rls.md`}>Activer l&apos;isolation</ExternalLink>
          </p>
        )}
      </StatusRow>
    </>
  )
}

/**
 * Configuration of the instance: what works, what to set up and how, in the
 * host's own words (emails, address, scheduled bank sync, security, updates,
 * backups). Reads the environment only through instanceStatus, which never
 * returns a secret. Also the first page after /setup (/welcome redirects
 * here). Instance administrators only; an instance may hide it (policy
 * action "onboarding").
 */
export default async function ConfigurationPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!isGlobalAdmin(user) || !(await isActionAllowed('onboarding', user))) redirect('/companies')

  const status = instanceStatus(process.env, { sendEmailAllowed: await isActionAllowed('send-email', user) })
  const { version } = getDeployedVersion()
  const companies = await prisma.company.count()
  // Secrets the start-up pass could not seal again in the current format (lib/crypto/reencrypt.ts)
  const legacySecrets = await countLegacySecrets().catch((error: unknown) => {
    logger.error('Configuration page: legacy secrets check failed', error)
    return null
  })

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Configuration"
        description="Ce qui fonctionne, ce qui reste à régler et comment. Ces réglages se font dans les variables d'environnement de votre hébergement."
        docsHref={docsUrl('install')}
      />

      {companies === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Votre instance est prête</CardTitle>
            <CardDescription>
              Le compte administrateur existe. Créez votre première société&nbsp;; le reste de cette page peut attendre.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/companies/new">
                Créer ma première société
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Communication</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            <EmailsRow status={status} />
            <AddressRow status={status} />
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Banques</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            <BankSyncRow status={status} />
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Sécurité</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            <SecurityRows status={status} legacySecrets={legacySecrets} />
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Maintenance</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
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
                La page Mises à jour indique la version installée, les nouveautés et les changements de la base&nbsp;; une
                fois GitHub connecté, une mise à jour s&apos;installe en deux clics.
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
                  c&apos;est une copie instantanée de la base. Neon permet aussi de revenir à un état passé, dans la limite de
                  l&apos;historique de votre offre.
                </p>
              ) : MANAGED_DATABASE_HOSTS.has(status.platform) ? (
                <p>
                  Vérifiez dans la console {PLATFORM_LABELS[status.platform]} que la base est sauvegardée automatiquement et
                  combien de temps les sauvegardes sont gardées (selon l&apos;offre). Pour une copie indépendante, planifiez aussi
                  un <code className="font-mono text-xs">pg_dump</code> vers un stockage que vous contrôlez.
                </p>
              ) : (
                <p>
                  Planifiez chaque jour un <code className="font-mono text-xs">pg_dump</code> de la base, copiez les fichiers
                  hors du serveur et testez de temps en temps une restauration avec{' '}
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
    </div>
  )
}
