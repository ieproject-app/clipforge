import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { buildCutArgs } from '../filterHelpers.js'

// Property 4: Cut arguments always re-encode with fixed codecs
// Validates: Requirements 6.1, 6.2
//
// For any valid cut input (with or without a filter-script path), buildCutArgs
// produces an argument array that always includes the same fixed video codec,
// audio codec, and encoding parameters, so every segment of a job is
// concat-compatible. Presence of a filter-script path may add the
// -filter_complex_script pair, but must never alter the fixed re-encode flags.

// The fixed re-encode flags every CPU (libx264) cut must contain, as consecutive pairs.
// GPU encoder paths (nvenc/amf/qsv) have different flag sets; the default path is libx264.
const FIXED_FLAG_PAIRS = [
  ['-c:v', 'libx264'],
  ['-preset', 'ultrafast'],
  ['-crf', '23'],
  ['-c:a', 'aac'],
  ['-b:a', '96k'],
  ['-avoid_negative_ts', 'make_zero'],
]

/**
 * Assert that `flag` appears in `args` immediately followed by `value`.
 */
function expectConsecutivePair(args, flag, value) {
  const idx = args.indexOf(flag)
  expect(idx, `expected ${flag} to be present`).toBeGreaterThanOrEqual(0)
  expect(args[idx + 1], `expected ${flag} to be followed by ${value}`).toBe(value)
}

// Arbitrary non-empty-ish path strings; unicode/space/punctuation allowed since
// these are argv tokens (no shell), so any string is a valid token.
const pathArb = fc.string({ minLength: 1 })
// Numeric cut boundaries: any finite double (buildCutArgs coerces via String()).
const timeArb = fc.double({ noNaN: true, noDefaultInfinity: true })

describe('buildCutArgs — Property 4: cut arguments always re-encode with fixed codecs', () => {
  it('always contains the identical fixed codec/encoding flags, with or without a filter script', () => {
    fc.assert(
      fc.property(
        pathArb,
        pathArb,
        timeArb,
        timeArb,
        fc.option(pathArb, { nil: undefined }),
        (inputPath, outputPath, start, end, filterScriptPath) => {
          const args = buildCutArgs({ inputPath, start, end, outputPath, filterScriptPath })

          // Every fixed re-encode flag/value appears as a consecutive pair.
          for (const [flag, value] of FIXED_FLAG_PAIRS) {
            expectConsecutivePair(args, flag, value)
          }

          // Core cut flags present and correctly positioned.
          expect(args[0]).toBe('-y')
          expectConsecutivePair(args, '-ss', String(start))
          expectConsecutivePair(args, '-to', String(end))
          expectConsecutivePair(args, '-i', inputPath)

          // Output path is always the final argument.
          expect(args[args.length - 1]).toBe(outputPath)

          // Filter script only appears when provided; and when it does, it
          // sits after the input and before the fixed codec flags.
          const fcsIdx = args.indexOf('-filter_complex_script')
          if (filterScriptPath === undefined) {
            expect(fcsIdx).toBe(-1)
          } else {
            expect(fcsIdx).toBeGreaterThanOrEqual(0)
            expect(args[fcsIdx + 1]).toBe(filterScriptPath)
            expect(fcsIdx).toBeGreaterThan(args.indexOf('-i'))
            expect(fcsIdx).toBeLessThan(args.indexOf('-c:v'))
          }
        }
      ),
      { numRuns: 300 }
    )
  })

  it('produces identical fixed re-encode flags regardless of filter-script presence', () => {
    fc.assert(
      fc.property(pathArb, pathArb, timeArb, timeArb, pathArb, (inputPath, outputPath, start, end, filterScriptPath) => {
        const withScript = buildCutArgs({ inputPath, start, end, outputPath, filterScriptPath })
        const withoutScript = buildCutArgs({ inputPath, start, end, outputPath })

        // Extract only the fixed re-encode flags region: everything from -c:v
        // through the argument just before the output path.
        const fixedSlice = (args) => args.slice(args.indexOf('-c:v'), args.length - 1)

        // The fixed codec/encoding block must be byte-for-byte identical.
        expect(fixedSlice(withScript)).toEqual(fixedSlice(withoutScript))
      }),
      { numRuns: 300 }
    )
  })
})
