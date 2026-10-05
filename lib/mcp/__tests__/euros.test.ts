/**
 * Euros and percents at the edge of the MCP tools that reuse route schemas
 * (lib/mcp/euros.ts): the assistant never sees a field in cents or in basis
 * points, and what it sends becomes the exact route body.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { assistantInput, centsInput, forAssistant, routeBody } from '@/lib/mcp/euros'

const Route = z.object({
  label: z.string().trim().min(1, 'Le libellé est requis'),
  totalCents: z.number().int().min(0),
  acompteCents: z.number().int().nullable().optional(),
  vatRateBp: z.number().int().min(0).max(10000).default(2000),
  day: z.string().transform((value) => value.slice(0, 10)),
  lines: z.array(z.object({ amountCents: z.number().int() })).default([]),
})

describe('assistantInput', () => {
  it('renames fields in cents and basis points, keeps the others, and leaves transforms to the route', () => {
    const schema = assistantInput(Route) as z.ZodObject
    const json = JSON.stringify(z.toJSONSchema(schema, { unrepresentable: 'any' }))
    expect(Object.keys(schema.shape).sort()).toEqual(['acompte', 'day', 'label', 'lines', 'total', 'vatRate'])
    expect(json).not.toMatch(/Cents|Bp/)
    // The transform of `day` is not applied twice: the assistant schema keeps the input.
    expect(schema.parse({ label: 'x', total: 1, day: '2025-03-01T10:00:00Z' }).day).toBe('2025-03-01T10:00:00Z')
  })
})

describe('centsInput and routeBody', () => {
  it('turns euros and percents into the route body', () => {
    const value = { label: 'CFE', total: 1234.56, acompte: null, vatRate: 5.5, day: '2025-03-01', lines: [{ amount: 10.1 }] }
    expect(centsInput(Route, value)).toEqual({ label: 'CFE', totalCents: 123456, acompteCents: null, vatRateBp: 550, day: '2025-03-01', lines: [{ amountCents: 1010 }] })
    expect(routeBody(Route, { label: ' CFE ', total: 1, day: '2025-03-01T10:00:00Z' })).toEqual({
      label: 'CFE',
      totalCents: 100,
      vatRateBp: 2000,
      day: '2025-03-01',
      lines: [],
    })
  })

  it('refuses three decimals and answers the route messages in French', () => {
    expect(() => centsInput(Route, { total: 1.005 })).toThrow('total : montant invalide, en euros avec deux décimales au plus.')
    expect(() => centsInput(Route, { vatRate: 5.555 })).toThrow('vatRate : taux invalide, en pour cent avec deux décimales au plus.')
    expect(() => routeBody(Route, { label: '', total: 1, day: '2025-03-01' })).toThrow('label: Le libellé est requis')
  })
})

describe('forAssistant', () => {
  it('gives euros, percents and days', () => {
    expect(
      forAssistant({ amountCents: 1250, amount: 'kept', rateBp: 2000, on: new Date('2025-03-01T00:00:00.000Z'), at: new Date('2025-03-01T10:00:00.000Z'), nested: [{ paidCents: null }] }),
    ).toEqual({ amountEuros: 12.5, amount: 'kept', rate: 20, on: '2025-03-01', at: '2025-03-01T10:00:00.000Z', nested: [{ paid: null }] })
  })
})
