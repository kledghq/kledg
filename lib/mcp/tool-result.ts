/**
 * Results of MCP tools: JSON text content, French error messages, and the
 * mapping of thrown errors (typed errors keep their message, anything else
 * becomes the generic message of the REST API, logged server-side).
 */

import { handleError } from '@/lib/accounting/errors'

/** structuredContent: the data of the tool's view, when it has one (lib/mcp/views). */
export type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean; structuredContent?: Record<string, unknown> }

// Prisma Decimal values serialize as strings; numbers are easier for models.
// JSON.stringify calls toJSON() before the replacer, so read the raw holder value.
function decimalReplacer(this: Record<string, unknown>, key: string, value: unknown) {
  const raw = this[key]
  if (raw && typeof raw === 'object' && 'toNumber' in raw && typeof raw.toNumber === 'function') {
    return (raw as { toNumber: () => number }).toNumber()
  }
  return value
}

export function json(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, decimalReplacer, 2) }] }
}

export function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** Runs a tool body, turning access and validation errors into tool errors. */
export async function run<T extends { content: unknown[]; isError?: boolean } = ToolResult>(fn: () => Promise<T>): Promise<T | ToolResult> {
  try {
    return await fn()
  } catch (error) {
    return fail(handleError(error).message)
  }
}

/** A calendar day as yyyy-mm-dd (dates are stored at midnight UTC). */
export const day = (d: Date) => d.toISOString().slice(0, 10)
