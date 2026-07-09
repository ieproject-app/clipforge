import { describe, it, expect } from 'vitest'
import { escapeDrawtextText } from '../filterHelpers.js'

// Unit test with the exact failing title from ERROR_LOG.md (#4/#5).
// Requirements: 4.2, 4.3
//
// The escaper only escapes `\`, `'`, and `%`, and collapses newlines to spaces.
// It does NOT escape `:`, `,`, `{`, `}`, `(`, `)`, `|`, or spaces. For the
// hostile title below:
//   - each `%` becomes `\%`
//   - each `'` becomes `\'`
//   - the colon and pipes remain literal (unescaped)

describe('escapeDrawtextText — exact failing title from ERROR_LOG.md', () => {
  const title = "Source: FULL MATCH | MEKSIKO VS INGGRIS | 100% 'HIGHLIGHT'"
  const expected =
    "Source\\: FULL MATCH | MEKSIKO VS INGGRIS | 100\\% \\'HIGHLIGHT\\'"

  it('produces the exact expected escaped value', () => {
    expect(escapeDrawtextText(title)).toBe(expected)
  })

  it('escapes the percent sign', () => {
    expect(escapeDrawtextText(title)).toContain('100\\%')
  })

  it('escapes both single quotes around HIGHLIGHT', () => {
    expect(escapeDrawtextText(title)).toContain("\\'HIGHLIGHT\\'")
  })

  it('escapes colons', () => {
    // The colon after "Source" gets escaped to prevent FFmpeg option-splitting.
    expect(escapeDrawtextText(title)).toContain('Source\\:')
  })

  it('does NOT escape pipes', () => {
    // Pipes stay literal (surrounded by spaces, no backslash inserted).
    expect(escapeDrawtextText(title)).toContain(' | ')
    expect(escapeDrawtextText(title)).not.toContain('\\|')
  })
})
