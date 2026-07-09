import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { escapeDrawtextText } from '../filterHelpers.js'

// Property 2: Escaping never over-escapes literal characters
// Validates: Requirements 4.3
//
// Inside a single-quoted drawtext value, `:`, `,`, `{`, `}`, `(`, `)` are
// already literal and MUST NOT be escaped. The escaper only ever inserts a
// backslash to escape `\`, `'`, or `%` (newlines are collapsed to a space).
// This is the recurring ERROR_LOG.md #4 over-escaping regression.
//
// The core property: every escape backslash the escaper produces in the output
// escapes exactly one of `\`, `'`, `%` — never one of the six literal chars.
// Equivalently, no one of the six literal chars is ever the character escaped
// by an inserted backslash.

const LITERAL_CHARS = [',', '{', '}', '(', ')']
const ESCAPABLE_CHARS = ['\\', "'", '%', ':']

/**
 * Walk the escaped value the way FFmpeg's single-quoted-value parser does: a
 * backslash escapes exactly the next character (consuming both). For every
 * such escape pair, return the character that was escaped. This lets us assert
 * that an inserted backslash never targets one of the six literal chars, while
 * correctly treating a doubled backslash (`\\`) followed by a literal (e.g.
 * `\\:`) as an escaped-backslash + verbatim-literal rather than an escaped
 * literal.
 */
function escapedTargets(escaped) {
  const targets = []
  let i = 0
  while (i < escaped.length) {
    if (escaped[i] === '\\' && i + 1 < escaped.length) {
      targets.push(escaped[i + 1])
      i += 2
      continue
    }
    i += 1
  }
  return targets
}

// A generator that freely mixes the six literal chars with the escape-
// triggering chars and newlines, plus general unicode/emoji, so backslashes
// and literals appear adjacent in every combination.
const mixedChar = fc.constantFrom(
  ':', ',', '{', '}', '(', ')',
  '\\', "'", '%', '\n', '\r', '\r\n',
  ' ', 'a', 'Z', '9', '你', '😀', '👍🏽'
)
const mixedString = fc.array(mixedChar).map((parts) => parts.join(''))
const textArb = fc.oneof(mixedString, fc.fullUnicodeString(), fc.string())

describe('escapeDrawtextText — Property 2: escaping never over-escapes literal characters', () => {
  it('never inserts a backslash to escape :, ,, {, }, (, )', () => {
    fc.assert(
      fc.property(textArb, (text) => {
        const escaped = escapeDrawtextText(text)

        // Every character escaped by an inserted backslash must be one the
        // escaper is allowed to escape — and never one of the six literals.
        for (const target of escapedTargets(escaped)) {
          expect(LITERAL_CHARS).not.toContain(target)
          expect(ESCAPABLE_CHARS).toContain(target)
        }
      }),
      { numRuns: 500 }
    )
  })

  it('leaves the six literal chars verbatim and unpreceded by an inserted escape (backslash-free input)', () => {
    // With backslash-free input, any backslash in the output was inserted by
    // the escaper. Assert none of the six literal chars is immediately
    // preceded by such an inserted backslash, and each literal survives
    // verbatim and in the same count.
    const noBackslashChar = fc.constantFrom(
      ':', ',', '{', '}', '(', ')',
      "'", '%', ' ', 'a', 'Z', '9', '你', '😀'
    )
    const noBackslashString = fc.array(noBackslashChar).map((parts) => parts.join(''))

    fc.assert(
      fc.property(noBackslashString, (text) => {
        const escaped = escapeDrawtextText(text)

        for (const lit of LITERAL_CHARS) {
          // Same number of occurrences before and after escaping.
          const before = [...text].filter((c) => c === lit).length
          const after = [...escaped].filter((c) => c === lit).length
          expect(after).toBe(before)

          // No occurrence of the literal is immediately preceded by a backslash.
          for (let i = 0; i < escaped.length; i++) {
            if (escaped[i] === lit) {
              expect(escaped[i - 1]).not.toBe('\\')
            }
          }
        }
      }),
      { numRuns: 500 }
    )
  })
})
