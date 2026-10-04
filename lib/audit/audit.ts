/**
 * Audit logging utilities (server-side only)
 * This file should ONLY be imported in Server Components or API routes
 * DO NOT import this in Client Components
 */

import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/session'
import { headers } from 'next/headers'
import { Prisma } from '@prisma/client'
import { logger } from '@/lib/logger'
import { resolveClientIp } from '@/lib/client-ip'

export interface AuditLogContext {
  userId?: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

type AuditLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

/**
 * Get user context from Supabase (server-side only)
 */
export async function getAuditContext(): Promise<AuditLogContext> {
  let userId: string | null = null
  let ipAddress: string | null = null
  let userAgent: string | null = null

  try {
    // Get user from Supabase
    const user = await getCurrentUser()
    userId = user?.email || user?.id || null
  } catch {
    // User not authenticated
  }

  try {
    // Get request metadata
    const headersList = await headers()
    // Only an address vouched for by the proxy configuration (lib/client-ip.ts).
    ipAddress = resolveClientIp(headersList)
    userAgent = headersList.get('user-agent') || null
  } catch {
    // Not available
  }

  return { userId, ipAddress, userAgent }
}

/**
 * Write audit log to database
 * Use this in API routes or Server Components for important operations
 */
export async function writeAuditLog(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  options?: {
    action?: string
    metadata?: Record<string, unknown>
    companyId?: string
    context?: AuditLogContext
  }
): Promise<void> {
  try {
    // Get context if not provided
    const context = options?.context || (await getAuditContext())

    // Map log level to enum
    const auditLevel = level.toUpperCase() as AuditLogLevel

    // Write to database
    await prisma.auditLog.create({
      data: {
        userId: context.userId || null,
        action: options?.action || null,
        level: auditLevel,
        message,
        metadata: options?.metadata ? (options.metadata as Prisma.InputJsonValue) : undefined,
        companyId: options?.companyId || null,
        ipAddress: context.ipAddress || null,
        userAgent: context.userAgent || null,
      },
    })
  } catch (error) {
    // Silently fail to avoid breaking the application
    logger.error('[Audit] Failed to write to database:', error)
  }
}
