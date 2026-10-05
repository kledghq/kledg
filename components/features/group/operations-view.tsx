'use client'

import { GroupEliminationsSection } from './eliminations-page'
import { GroupLedgerSection } from './ledger-page'
import { GroupTransactionsSection } from './transactions-page'
import { GroupViewFrame } from './view-frame'

/**
 * Opérations (/<holding>/group/operations): what is behind a figure? The
 * bank transactions of every company, the combined general ledger and the
 * detail of the eliminations.
 */
export function GroupOperationsView() {
  return (
    <GroupViewFrame
      title="Opérations"
      description="Le détail derrière les chiffres : les transactions bancaires de toutes les sociétés, le grand livre combiné et les éliminations des flux entre sociétés."
      tabs={[
        { id: 'transactions', label: 'Transactions', content: <GroupTransactionsSection /> },
        { id: 'grand-livre', label: 'Grand livre combiné', content: <GroupLedgerSection /> },
        { id: 'eliminations', label: 'Éliminations', content: <GroupEliminationsSection /> },
      ]}
    />
  )
}
