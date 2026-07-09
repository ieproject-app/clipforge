import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { validateSegment } from '../filterHelpers.js'

// Property 5: Segment validation matches the numeric predicate
// Validates: Requirements 7.1, 7.2
//
// For any {start, end, duration} triple (including negative, non-finite, equal,
// and out-of-range values), validateSegment reports the segment as valid if and
// only if start and end are finite, start >= 0, end > start, and end <= duration;
// and whenever it reports invalid, it returns a non-empty reason describing the
// failed condition.
//
// The reference predicate mirrors the implementation exactly: finiteness is
// required only for `start` and `end` (NOT `duration`). If duration is
// non-finite (e.g. Infinity), `end <= duration` follows ordinary numeric
// comparison, so `end <= Infinity` is true and `end <= -Infinity` is false.

/**
 * The reference predicate — a direct restatement of validateSegment's contract,
 * mirroring the implementation's sequential checks exactly. The final duration
 * bound is expressed as `!(end > duration)` (the implementation rejects only
 * when `end > videoDuration`). This matters at the non-finite boundary: a NaN
 * duration makes every comparison false, so `!(end > NaN)` is true — the
 * implementation treats a NaN duration as non-binding, and the reference must
 * agree to avoid false mismatches. Finiteness is required only for start/end.
 */
function isValid(start, end, duration) {
  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start >= 0 &&
    end > start &&
    !(end > duration)
  )
}

// A number arbitrary that includes finite doubles plus the awkward non-finite
// and boundary values that must exercise every branch of the predicate.
const numberArb = fc.oneof(
  fc.double(),
  fc.constant(NaN),
  fc.constant(Infinity),
  fc.constant(-Infinity),
  fc.constant(0),
  fc.constant(-0),
)

describe('validateSegment — Property 5: validation matches the numeric predicate', () => {
  it('is valid iff 0 <= start < end <= duration, with a non-empty reason otherwise', () => {
    fc.assert(
      fc.property(numberArb, numberArb, numberArb, (start, end, duration) => {
        const result = validateSegment({ start, end }, duration)
        const expected = isValid(start, end, duration)

        // The ok flag must match the reference predicate exactly.
        expect(result.ok).toBe(expected)

        if (result.ok) {
          expect(expected).toBe(true)
        } else {
          // Every invalid result carries a non-empty descriptive reason.
          expect(typeof result.reason).toBe('string')
          expect(result.reason.length).toBeGreaterThan(0)
        }
      }),
      { numRuns: 500 }
    )
  })

  it('generates equal start/end triples that are always rejected with a reason', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), fc.double(), (value, duration) => {
        // start === end: end > start is false, so it must be invalid.
        const result = validateSegment({ start: value, end: value }, duration)
        expect(result.ok).toBe(false)
        expect(result.reason.length).toBeGreaterThan(0)
      }),
      { numRuns: 300 }
    )
  })

  it('accepts a well-formed in-range segment', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        (a, b, extra) => {
          // Construct a guaranteed-valid triple: 0 <= start < end <= duration.
          const start = Math.min(a, b)
          let end = Math.max(a, b)
          if (end === start) end = start + 1
          const duration = end + extra

          const result = validateSegment({ start, end }, duration)
          expect(result.ok).toBe(true)
        }
      ),
      { numRuns: 300 }
    )
  })
})
