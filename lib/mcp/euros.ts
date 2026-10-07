/**
 * Euros at the edge of the MCP tools that reuse the zod schemas of the API
 * routes (docs/mcp.md, "Montants").
 *
 * Route bodies carry amounts in cents (`amountCents`, `totalCents`...);
 * assistants send and read euros only. These helpers keep the route schema
 * as the single definition of a body:
 * - `assistantInput(schema)` is the same schema for the assistant, every
 *   `xCents` number field renamed `x` and given in euros (two decimals at
 *   most), wrappers kept (optional, nullable, arrays, unions), transforms
 *   and defaults left to the route schema;
 * - `centsInput(schema, value)` turns what the assistant sent back into the
 *   route body (euros to cents, `x` to `xCents`), to be parsed by the
 *   route schema itself (French messages, refinements);
 * - `forAssistant(value)` converts a service result for the assistant:
 *   every `xCents` number becomes `x` in euros, days become yyyy-mm-dd.
 *
 * Rates in basis points (`xBp`) are handled the same way, in percent.
 */

import { z } from 'zod'
import { centsFromEuros, eurosInput } from '@/lib/mcp/tool-meta'
import { fromCents } from '@/lib/utils/money'
import { parseInput } from '@/lib/api/zod-fields'
import { ValidationError } from '@/lib/accounting/errors'

type AnySchema = z.ZodType
type Def = { type: string; shape?: Record<string, AnySchema>; innerType?: AnySchema; element?: AnySchema; options?: AnySchema[]; in?: AnySchema; defaultValue?: unknown }

/** The definition of a schema through zod's public `def` (zod 4), read as the fields this module uses. */
const defOf = (schema: AnySchema): Def => schema.def as unknown as Def

const CENTS_KEY = /^(.+)Cents$/
/** Rates in basis points (`vatRateBp`): the assistant gives and reads percents (20 for 20 %). */
const BP_KEY = /^(.+)Bp$/

/** Whether `schema`, once unwrapped, is a number (a field in cents). */
function isNumber(schema: AnySchema): boolean {
  const def = defOf(schema)
  if (def.type === 'number') return true
  if (def.type === 'optional' || def.type === 'nullable' || def.type === 'default') return isNumber(def.innerType!)
  if (def.type === 'pipe') return isNumber(def.in!)
  return false
}

/** The euros counterpart of a field in cents, with the same wrappers. */
function eurosField(schema: AnySchema): AnySchema {
  const def = defOf(schema)
  const description = 'In euros (two decimals at most).'
  if (def.type === 'optional') return eurosField(def.innerType!).optional()
  if (def.type === 'nullable') return eurosField(def.innerType!).nullable()
  if (def.type === 'default') return eurosField(def.innerType!).optional()
  return eurosInput.describe(description)
}

/** The percent counterpart of a rate in basis points, with the same wrappers. */
function percentField(schema: AnySchema): AnySchema {
  const def = defOf(schema)
  if (def.type === 'optional' || def.type === 'default') return percentField(def.innerType!).optional()
  if (def.type === 'nullable') return percentField(def.innerType!).nullable()
  return z.number({ error: 'Taux invalide : un pourcentage est attendu' }).min(0).max(100).describe('In percent (20 for 20 %).')
}

/**
 * A rate in percent sent by an assistant: 0 to 100, two decimals at most
 * (12,34 % is 1 234 basis points; 12,345 % is refused, never rounded).
 */
export const percentInput = z
  .number({ error: 'Taux invalide : un pourcentage est attendu' })
  .finite()
  .min(0)
  .max(100)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) <= 1e-6, 'Taux invalide : en pour cent avec deux décimales au plus.')

/** Basis points of a rate in percent sent by an assistant (four decimals at most), or a French 400. */
function basisPointsOf(percent: number, field: string): number {
  const bp = Math.round(percent * 100)
  if (!Number.isFinite(percent) || Math.abs(percent * 100 - bp) > 1e-6) throw new ValidationError(`${field}\u00a0: taux invalide, en pour cent avec deux décimales au plus.`)
  return bp
}

/**
 * The schema for the assistant (see the module comment): fields in cents
 * become fields in euros, and transforms and defaults are left to the route
 * schema, which parses the body next (so nothing is transformed twice).
 */
export function assistantInput(schema: AnySchema): AnySchema {
  const def = defOf(schema)
  const description = schema.description
  const withDescription = (result: AnySchema) => (description ? result.describe(description) : result)
  switch (def.type) {
    case 'object': {
      const shape: Record<string, AnySchema> = {}
      for (const [key, field] of Object.entries(def.shape!)) {
        const cents = CENTS_KEY.exec(key)
        const bp = BP_KEY.exec(key)
        if (cents && isNumber(field)) shape[cents[1]] = eurosField(field)
        else if (bp && isNumber(field)) shape[bp[1]] = percentField(field)
        else shape[key] = assistantInput(field)
      }
      return withDescription(z.object(shape))
    }
    case 'optional':
    case 'default':
      return withDescription(assistantInput(def.innerType!).optional())
    case 'nullable':
      return withDescription(assistantInput(def.innerType!).nullable())
    case 'array':
      return withDescription(z.array(assistantInput(def.element!)))
    case 'union':
      return withDescription(z.union(def.options!.map((option) => assistantInput(option)) as unknown as [AnySchema, AnySchema]))
    case 'pipe':
      return withDescription(assistantInput(def.in!))
    default:
      return schema
  }
}

/** Keys of an object schema, or of every object option of a union. */
function shapeOf(schema: AnySchema): Record<string, AnySchema> | null {
  const def = defOf(schema)
  if (def.type === 'object') return def.shape!
  if (def.type === 'optional' || def.type === 'nullable' || def.type === 'default') return shapeOf(def.innerType!)
  if (def.type === 'pipe') return shapeOf(def.in!)
  if (def.type === 'union') {
    const shapes = def.options!.map(shapeOf).filter((s): s is Record<string, AnySchema> => s !== null)
    return shapes.length ? Object.assign({}, ...shapes) : null
  }
  return null
}

function elementOf(schema: AnySchema): AnySchema | null {
  const def = defOf(schema)
  if (def.type === 'array') return def.element!
  if (def.type === 'optional' || def.type === 'nullable' || def.type === 'default') return elementOf(def.innerType!)
  if (def.type === 'pipe') return elementOf(def.in!)
  return null
}

/** The route body of what the assistant sent (see the module comment); the route schema parses it next. */
export function centsInput(schema: AnySchema, value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) {
    const element = elementOf(schema)
    return element ? value.map((item) => centsInput(element, item)) : value
  }
  if (typeof value !== 'object') return value
  const shape = shapeOf(schema)
  if (!shape) return value
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) }
  for (const [key, field] of Object.entries(shape)) {
    const cents = CENTS_KEY.exec(key)
    const bp = BP_KEY.exec(key)
    if (cents && isNumber(field) && cents[1] in out) {
      const euros = out[cents[1]]
      delete out[cents[1]]
      out[key] = typeof euros === 'number' ? centsFromEuros(euros, cents[1]) : euros
    } else if (bp && isNumber(field) && bp[1] in out) {
      const percent = out[bp[1]]
      delete out[bp[1]]
      out[key] = typeof percent === 'number' ? basisPointsOf(percent, bp[1]) : percent
    } else if (key in out) {
      out[key] = centsInput(field, out[key])
    }
  }
  return out
}

/** A service result for the assistant: amounts in euros, days as yyyy-mm-dd. */
export function forAssistant(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (value instanceof Date) {
    const iso = value.toISOString()
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso
  }
  if (Array.isArray(value)) return value.map(forAssistant)
  if (typeof value !== 'object') return value
  // Prisma Decimal (euros already) and other values with their own JSON form
  if ('toNumber' in value && typeof (value as { toNumber: unknown }).toNumber === 'function') return (value as { toNumber: () => number }).toNumber()
  if (typeof (value as { toJSON?: unknown }).toJSON === 'function') return value
  const out: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    const cents = CENTS_KEY.exec(key)
    const bp = BP_KEY.exec(key)
    if (cents && (typeof field === 'number' || field === null)) {
      const name = cents[1] in (value as Record<string, unknown>) ? `${cents[1]}Euros` : cents[1]
      out[name] = field === null ? null : fromCents(field)
    } else if (bp && (typeof field === 'number' || field === null)) {
      const name = bp[1] in (value as Record<string, unknown>) ? `${bp[1]}Percent` : bp[1]
      out[name] = field === null ? null : field / 100
    } else {
      out[key] = forAssistant(field)
    }
  }
  return out
}

/** The route body of what the assistant sent, parsed by the route schema (French messages, refinements, transforms). */
export function routeBody<T extends AnySchema>(schema: T, value: unknown): z.output<T> {
  return parseInput(schema, centsInput(schema, value)) as z.output<T>
}

/** The fields of an object route schema for the assistant (see assistantInput), to spread in a tool input. */
export function assistantShape(schema: z.ZodObject): z.ZodRawShape {
  return (assistantInput(schema) as z.ZodObject).shape
}
