// Regression tests for the husband-first presentation order (src/lib/
// personOrder.js) — a pure, display-only concern completely separate from
// the tax calculation itself (see married-couple-order.test.js for proof
// the two never interact).
import { describe, expect, it } from 'vitest'
import { resolvePersonDisplayOrder } from '../src/lib/personOrder.js'

const MALE = { first_name: 'Marc', last_name: 'Weber', gender: 'male' }
const FEMALE = { first_name: 'Giulia', last_name: 'Weber', gender: 'female' }

describe('resolvePersonDisplayOrder', () => {
  it('puts the husband first when primary is the wife and spouse is the husband', () => {
    const result = resolvePersonDisplayOrder({ primaryPerson: FEMALE, spousePerson: MALE, overrideOrder: null })
    expect(result.ordered.map((o) => o.kind)).toEqual(['spouse', 'primary'])
    expect(result.needsVerification).toBe(false)
  })

  it('puts the husband first when primary IS the husband (no reordering needed)', () => {
    const result = resolvePersonDisplayOrder({ primaryPerson: MALE, spousePerson: FEMALE, overrideOrder: null })
    expect(result.ordered.map((o) => o.kind)).toEqual(['primary', 'spouse'])
    expect(result.needsVerification).toBe(false)
  })

  it('falls back to primary-first and flags for verification when gender is missing on either side', () => {
    const noGender = { first_name: 'Someone', last_name: 'Weber' }
    const result = resolvePersonDisplayOrder({ primaryPerson: noGender, spousePerson: MALE, overrideOrder: null })
    expect(result.ordered.map((o) => o.kind)).toEqual(['primary', 'spouse'])
    expect(result.needsVerification).toBe(true)
  })

  it('falls back to primary-first and flags for verification when both are the same gender (including a legitimate same-sex couple)', () => {
    const otherMale = { first_name: 'Someone', last_name: 'Weber', gender: 'male' }
    const result = resolvePersonDisplayOrder({ primaryPerson: MALE, spousePerson: otherMale, overrideOrder: null })
    expect(result.ordered.map((o) => o.kind)).toEqual(['primary', 'spouse'])
    expect(result.needsVerification).toBe(true)
  })

  it('a specialist override always wins, regardless of gender', () => {
    const result = resolvePersonDisplayOrder({ primaryPerson: MALE, spousePerson: FEMALE, overrideOrder: 'spouse_first' })
    expect(result.ordered.map((o) => o.kind)).toEqual(['spouse', 'primary'])
    expect(result.needsVerification).toBe(false)
    expect(result.overridden).toBe(true)
  })

  it('a single person (no spouse at all) is just the one entry, never flagged', () => {
    const result = resolvePersonDisplayOrder({ primaryPerson: FEMALE, spousePerson: null, overrideOrder: null })
    expect(result.ordered).toHaveLength(1)
    expect(result.ordered[0].kind).toBe('primary')
    expect(result.needsVerification).toBe(false)
  })
})
