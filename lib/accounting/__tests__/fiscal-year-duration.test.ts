import { describe, expect, it } from 'vitest'
import { ValidationError } from '@/lib/accounting/errors'
import { assertFiscalYearDuration } from '../fiscal-year-duration'

describe('exercice length (C. com. art. L123-12, #139)', () => {
  it('accepts up to 24 months, a first long exercice included', () => {
    expect(() => assertFiscalYearDuration('2026-01-01', '2026-12-31')).not.toThrow()
    expect(() => assertFiscalYearDuration('2025-07-01', '2026-12-31')).not.toThrow()
    expect(() => assertFiscalYearDuration('2025-01-01', '2026-12-31')).not.toThrow()
    expect(() => assertFiscalYearDuration('2024-02-29', '2026-02-28')).not.toThrow()
  })

  it('refuses an exercice longer than 24 months', () => {
    expect(() => assertFiscalYearDuration('2025-01-01', '2027-01-01')).toThrow(ValidationError)
    expect(() => assertFiscalYearDuration('2022-01-01', '2026-12-31')).toThrow(/31\/12\/2023 au plus tard/)
  })
})
