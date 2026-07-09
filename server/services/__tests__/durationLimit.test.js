import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { formatMaxDuration, buildDurationLimitMessage } from '../durationLimit.js'

// Property 6: Duration-limit message matches the constant
// Validates: Requirements 8.2
//
// For any value of MAX_DURATION, the maximum-duration value stated in the
// rejection message equals the formatted MAX_DURATION constant rather than a
// divergent hardcoded literal. The historical regression (ERROR_LOG.md #5) was
// a message that always said "60 minutes" while the enforced limit was 21600s
// (6h / 360 minutes). This test pins the stated maximum to the constant.

// The fixed prefix the stated maximum follows in the rejection message. Used to
// extract the stated-maximum substring back out of the full message.
const MAX_PREFIX = 'Maximum allowed duration is '

/**
 * Extract the stated-maximum substring from a rejection message: everything
 * after "Maximum allowed duration is " up to (but not including) the trailing
 * period. Returns null if the expected structure is absent.
 */
function extractStatedMax(message) {
  const idx = message.indexOf(MAX_PREFIX)
  if (idx === -1) return null
  const after = message.slice(idx + MAX_PREFIX.length)
  // The message ends the sentence with a period; strip a single trailing '.'.
  return after.endsWith('.') ? after.slice(0, -1) : after
}

describe('durationLimit — Property 6: rejection message states the formatted constant', () => {
  it('states a maximum equal to formatMaxDuration(maxSeconds), never a divergent literal', () => {
    fc.assert(
      fc.property(
        // Arbitrary non-negative MAX_DURATION values (seconds).
        fc.integer({ min: 0, max: 100_000_000 }),
        // Arbitrary actual durations (may be over or under the limit).
        fc.integer({ min: 0, max: 100_000_000 }),
        (maxSeconds, actualSeconds) => {
          const formattedMax = formatMaxDuration(maxSeconds)
          const message = buildDurationLimitMessage(actualSeconds, maxSeconds)

          // The message contains the formatted maximum as its stated max.
          expect(message.includes(formattedMax)).toBe(true)

          // The stated-max substring equals the formatted constant exactly.
          const statedMax = extractStatedMax(message)
          expect(statedMax).toBe(formattedMax)

          // The stated maximum must NOT be a divergent hardcoded "60 minutes"
          // literal unless the formatted constant genuinely is "60 minutes".
          // (Checked against the extracted stated max, not a raw substring of
          // the whole message — otherwise a value like "1566960 minutes" would
          // spuriously match the "...60 minutes" tail of the number.)
          if (formattedMax !== '60 minutes') {
            expect(statedMax).not.toBe('60 minutes')
          }
        }
      ),
      { numRuns: 500 }
    )
  })

  // Concrete anchors for the real configured limit (21600s = 6h = 360 minutes).
  it('formats 21600s (6h) as "360 minutes"', () => {
    expect(formatMaxDuration(21600)).toBe('360 minutes')
  })

  it('builds a message stating the actual and the derived maximum', () => {
    const message = buildDurationLimitMessage(9600, 21600)
    expect(message).toContain('360 minutes')
    expect(message).toContain('160 min')
  })
})
