/**
 * Shared types for accounting services
 */

import { prisma } from '@/lib/prisma'

export interface PCGWarning {
  code: string
  message: string
  severity: 'info' | 'warning' | 'error'
  article?: string
}

export interface AccountingEntryResult {
  entry: {
    id: string
    entryNumber: string
    date: Date
    description: string | null
    status: string
  }
  warnings: PCGWarning[]
}

export interface AccountingEntryWithWarnings {
  entry: Awaited<ReturnType<typeof prisma.accountingEntry.create>>
  warnings: PCGWarning[]
}
