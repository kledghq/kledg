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
export function GroupOperationsView({ page }: { page?: string } = {}) {
  return (
    <GroupViewFrame
      view="operations"
      page={page}
      sections={{
        transactions: <GroupTransactionsSection />,
        'grand-livre': <GroupLedgerSection />,
        eliminations: <GroupEliminationsSection />,
      }}
    />
  )
}
