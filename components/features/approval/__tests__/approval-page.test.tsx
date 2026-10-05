/**
 * The approval page (components/features/approval/approval-page.tsx):
 * each document cites its legal sources once (regression: the decision of
 * a SAS, a SASU or an EURL repeated the article that governs both the
 * decision and its register, "(C. com., art. L227-9, C. com., art. L227-9)").
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { buildApprovalPack } from '@/lib/approval/pack'
import type { ApprovalView } from '@/lib/approval/get-approval.service'
import { complete, contextFor } from '@/lib/approval/__tests__/fixtures'

const state = vi.hoisted(() => ({ view: null as unknown }))

vi.mock('@/components/features/year-end/shared', () => ({
  useJson: () => ({ data: state.view, error: null, reload: () => {} }),
  sendJson: vi.fn(),
}))
vi.mock('@/components/features/accounting/fiscal-year-selector', () => ({
  FiscalYearSelector: ({ onValueChange }: { onValueChange: (id: string) => void }) => {
    React.useEffect(() => onValueChange('fy25'), [onValueChange])
    return null
  },
}))

import { ApprovalPage } from '../approval-page'

function viewFor(legalType: string): ApprovalView {
  const context = contextFor(legalType)
  const details = complete()
  return { context, details, saved: null, pack: buildApprovalPack(context, details), persons: [], sources: [] }
}

describe('ApprovalPage', () => {
  it.each(['SASU', 'SAS', 'EURL'])('cites each source of the %s decision once', (legalType) => {
    state.view = viewFor(legalType)
    render(<ApprovalPage companyId="atelier-lumen" />)
    const paragraphs = screen.getAllByText(/approuve(nt)? les comptes et décide(nt)? de l’affectation du résultat/)
    expect(paragraphs).toHaveLength(1)
    const citation = paragraphs[0].textContent?.match(/\(([^)]*)\)\s*$/)?.[1] ?? ''
    const labels = citation.split(/,\s(?=C\.)/)
    expect(labels.length).toBeGreaterThan(0)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('cites every source once in the documents of every legal form', () => {
    for (const legalType of ['SARL', 'EURL', 'SAS', 'SASU', 'SA', 'SCI']) {
      const { pack } = viewFor(legalType)
      for (const doc of pack.documents) {
        const labels = doc.sources.map((s) => s.label)
        expect(new Set(labels).size, `${legalType} ${doc.id}`).toBe(labels.length)
      }
      const deadlines = pack.deadlines.sources.map((s) => s.label)
      expect(new Set(deadlines).size, `${legalType} deadlines`).toBe(deadlines.length)
    }
  })
})
