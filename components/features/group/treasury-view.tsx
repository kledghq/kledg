'use client'

import { GroupFlowsSection } from './flows-section'
import { GroupTreasurySection } from './treasury-page'
import { GroupViewFrame } from './view-frame'

/**
 * Trésorerie (/<holding>/group/treasury): where is the group's cash, who
 * owes whom inside the group, and where is it heading? Bank balances per
 * company and combined, cash month by month, current accounts and loans
 * between the companies, hints from the pace and the known deadlines, and
 * the flows between the companies.
 */
export function GroupTreasuryView() {
  return (
    <GroupViewFrame
      title="Trésorerie"
      description="Où est l'argent du groupe, qui doit quoi à qui entre les sociétés, et où va la trésorerie : soldes par société, comptes courants, perspectives et flux entre sociétés."
      tabs={[
        { id: 'soldes', label: 'Soldes et perspectives', content: <GroupTreasurySection /> },
        { id: 'flux', label: 'Flux entre sociétés', content: <GroupFlowsSection /> },
      ]}
    />
  )
}
