/**
 * Audit events written in the transaction of the operation they record
 * (#161): a period lock or a draft deletion and its audit row commit or
 * roll back together, and a failed write fails the operation instead of
 * being logged and dropped (writeAuditLog, run after the transaction,
 * swallows its errors). Imported by path, not through '@/lib/audit'.
 */

import type { Prisma } from '@prisma/client'
import { getAuditContext, type AuditLogContext } from './audit'

export async function writeAuditLogInTx(
  tx: Prisma.TransactionClient,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  options: { action: string; companyId: string; metadata?: Record<string, unknown>; context?: AuditLogContext },
): Promise<void> {
  const context = options.context ?? (await getAuditContext())
  // createMany: no RETURNING, readable or not under row level security (docs/rls.md)
  await tx.auditLog.createMany({
    data: {
      userId: context.userId || null,
      action: options.action,
      level: level.toUpperCase() as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
      message,
      metadata: options.metadata ? (options.metadata as Prisma.InputJsonValue) : undefined,
      companyId: options.companyId,
      ipAddress: context.ipAddress || null,
      userAgent: context.userAgent || null,
    },
  })
}
