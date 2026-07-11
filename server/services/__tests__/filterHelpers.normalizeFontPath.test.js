import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { normalizeFontPath } from '../filterHelpers.js'

// Property 3: Font-path normalization is safe for `fontfile=`
// Validates: Requirements 4.4
//
// For any Windows- or Unix-style font path, the output of normalizeFontPath:
//   (1) contains no backslash characters EXCEPT the single backslash that is
//       part of the escaped drive-letter colon (`\:`). Robust check: strip the
//       `\:` escape sequence, then assert no `\` remains.
//   (2) has every drive-letter colon escaped: if the input starts with
//       `[A-Za-z]:`, the output starts with `[A-Za-z]\:`.
//   (3) never wraps its output in single quotes: the helper produces
//       unquoted-safe values (FFmpeg's quoted vs unquoted escaping rules
//       differ — see AUDIT_PROMPT.md / ERROR_LOG.md #8). Callers embed the
//       result directly as `option=<value>` without quotes.

// A path segment: letters, digits, dots, spaces, hyphens, underscores.
const segmentChar = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._- '.split('')
)
const segment = fc.array(segmentChar, { minLength: 1, maxLength: 12 }).map((cs) => cs.join(''))
const driveLetter = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
)

// Windows-style: `C:\seg\seg\file.ttf`
const windowsPath = fc
  .tuple(driveLetter, fc.array(segment, { minLength: 1, maxLength: 5 }))
  .map(([drive, segs]) => `${drive}:\\${segs.join('\\')}`)

// Unix-style: `/seg/seg/file.ttf`
const unixPath = fc
  .array(segment, { minLength: 1, maxLength: 5 })
  .map((segs) => `/${segs.join('/')}`)

// Mixed / relative style with stray backslashes.
const mixedPath = fc
  .array(segment, { minLength: 1, maxLength: 5 })
  .map((segs) => segs.join('\\'))

const fontPathArb = fc.oneof(windowsPath, unixPath, mixedPath)

describe('normalizeFontPath — Property 3: font-path normalization is safe for fontfile=', () => {
  it('produces no stray backslashes and escapes every drive-letter colon', () => {
    fc.assert(
      fc.property(fontPathArb, (fontPath) => {
        const out = normalizeFontPath(fontPath)

        // (1) The only backslashes allowed are the drive-colon escape `\\:`.
        //     Strip that sequence, then assert no backslash remains.
        const withoutDriveEscape = out.replace(/\\\\:/g, '')
        expect(withoutDriveEscape.includes('\\')).toBe(false)

        // (2) Drive-letter colon is escaped when the input has a drive letter.
        const driveMatch = /^([A-Za-z]):/.exec(fontPath)
        if (driveMatch) {
          expect(out.startsWith(`${driveMatch[1]}\\:`)).toBe(true)
        } else {
          // No drive letter -> output must contain no backslash at all.
          expect(out.includes('\\')).toBe(false)
        }

        // (3) Output is never wrapped in single quotes. The helper's contract is
        //     to produce unquoted-safe values; a leading quote would break the
        //     `\\:` colon escape (backslashes are literal inside single quotes).
        expect(out.includes("'")).toBe(false)
      }),
      { numRuns: 200 }
    )
  })
})
