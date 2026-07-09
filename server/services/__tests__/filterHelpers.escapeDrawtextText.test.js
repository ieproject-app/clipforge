import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { escapeDrawtextText } from '../filterHelpers.js'

// Property 1: Escaped drawtext text is always well-formed
// Validates: Requirements 4.2
//
// For any title string (quotes, backslashes, %, :, ,, |, {}, (), unicode,
// emoji, embedded newlines), the output of escapeDrawtextText, embedded inside
// a drawtext option `text='<value>'`, must:
//   (1) contain no unescaped single-quote terminator,
//   (2) contain no bare percent sign,
//   (3) contain no carriage-return or newline,
//   (4) have every backslash doubled for each original backslash (verified by a
//       faithful re-parse that reproduces the original logical text).

/**
 * Scan an escaped drawtext value the way FFmpeg's single-quoted-value parser
 * does: a backslash escapes exactly the next character. Returns findings about
 * unescaped terminators and bare percent signs, plus the decoded logical text.
 */
function scanQuotedValue(escaped) {
  let i = 0
  let unescapedTerminator = false
  let barePercent = false
  let decoded = ''
  while (i < escaped.length) {
    const c = escaped[i]
    if (c === '\\') {
      // Backslash escapes the next character; consume both.
      if (i + 1 < escaped.length) {
        decoded += escaped[i + 1]
        i += 2
      } else {
        // Trailing lone backslash would itself be malformed.
        decoded += '\\'
        i += 1
      }
      continue
    }
    if (c === "'") {
      // An unescaped single-quote inside the value closes the option early.
      unescapedTerminator = true
      break
    }
    if (c === '%') {
      barePercent = true
    }
    decoded += c
    i += 1
  }
  return { unescapedTerminator, barePercent, decoded }
}

// Generator that heavily features the hostile characters called out by the
// spec, while also covering the full unicode/emoji space.
const hostileChar = fc.constantFrom(
  "'", '\\', '%', ':', ',', '|', '{', '}', '(', ')',
  '\n', '\r', '\r\n', '"', ' ', 'a', 'é', '你', '😀', '👍🏽'
)
const hostileString = fc.array(hostileChar).map((parts) => parts.join(''))
const textArb = fc.oneof(hostileString, fc.fullUnicodeString(), fc.string())

describe('escapeDrawtextText — Property 1: escaped drawtext text is always well-formed', () => {
  it('produces a well-formed, faithfully re-parseable value for arbitrary hostile input', () => {
    fc.assert(
      fc.property(textArb, (text) => {
        const escaped = escapeDrawtextText(text)

        // (3) No carriage-return or newline survives escaping.
        expect(escaped.includes('\r')).toBe(false)
        expect(escaped.includes('\n')).toBe(false)

        const { unescapedTerminator, barePercent, decoded } = scanQuotedValue(escaped)

        // (1) No unescaped single-quote would prematurely terminate text='...'.
        expect(unescapedTerminator).toBe(false)

        // (2) No bare percent sign (every % is escaped).
        expect(barePercent).toBe(false)

        // (4) Every backslash is doubled for original backslashes: a faithful
        //     re-parse reproduces the original logical text with newlines
        //     collapsed to spaces.
        const expectedLogical = text.replace(/\r\n?|\n/g, ' ')
        expect(decoded).toBe(expectedLogical)

        // Well-formedness end-to-end: the closing terminator of the full
        // `text='<escaped>'` option appears only at the very end.
        const wrapped = `text='${escaped}'`
        const body = wrapped.slice("text='".length, -1)
        const bodyScan = scanQuotedValue(body)
        expect(bodyScan.unescapedTerminator).toBe(false)
      })
    )
  })
})
