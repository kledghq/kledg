import { LockKeyhole } from 'lucide-react'
import { StatusBadge } from '@/components/shared'
import { ExternalLink, StatusRow } from './status-row'

/** What countLegacySecrets reports (lib/crypto/reencrypt.ts). */
export interface LegacySecretsCounts {
  total: number
  bankConnections: number
  integrationFields: number
  updateTokens: number
}

/**
 * Configuration page: secrets still sealed in the legacy encryption format,
 * which Kledg 0.4 no longer reads. Nothing is shown once every value is in
 * the current format.
 */
export function LegacySecretsRow({ counts, docHref }: { counts: LegacySecretsCounts | null; docHref: string }) {
  if (!counts || counts.total === 0) return null
  const banks = counts.bankConnections + counts.integrationFields
  return (
    <StatusRow icon={LockKeyhole} title="Ancien format de chiffrement" status={<StatusBadge tone="warning">À chiffrer de nouveau</StatusBadge>}>
      <p>
        {counts.total === 1 ? 'Une valeur chiffrée reste' : `${counts.total} valeurs chiffrées restent`} dans l&apos;ancien format
        {banks > 0 && counts.updateTokens > 0 ? ' (accès bancaires et jeton GitHub)' : banks > 0 ? ' (accès bancaires)' : ' (jeton GitHub)'}, que Kledg 0.4
        ne lira plus.
      </p>
      <p>
        Redémarrez le serveur ou lancez <code className="font-mono text-xs">pnpm secrets:reencrypt</code>&nbsp;: chaque valeur lisible est
        chiffrée de nouveau. Une valeur qui reste ensuite ne s&apos;ouvre plus avec le secret actuel&nbsp;: reconnectez la banque concernée
        {counts.updateTokens > 0 ? ', ou GitHub dans Mises à jour' : ''}.
      </p>
      <p>
        <ExternalLink href={docHref}>Ancien format de chiffrement</ExternalLink>
      </p>
    </StatusRow>
  )
}
