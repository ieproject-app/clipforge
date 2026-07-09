import { describe, it, expect } from 'vitest'
import { buildDrawtextFilter } from '../filterHelpers.js'

// Unit test for buildDrawtextFilter.
//
// buildDrawtextFilter composes the normalized text file path (normalizeFontPath) and the
// normalized font path (normalizeFontPath) into a single, parseable drawtext
// filter string of the form:
//   drawtext=textfile='<normalized_text_path>':fontfile='<normalized_font_path>':fontsize=18:
//   fontcolor=white@0.9:box=1:boxcolor=black@0.4:x=(w-text_w)/2:y=h-th-36

const HOSTILE_TEXT_PATH = "C:\\Users\\dev\\clipforge\\server\\temp\\watermark.txt"
const WINDOWS_FONT = 'C:\\Windows\\Fonts\\segoeui.ttf'

describe('buildDrawtextFilter — hostile text file path + Windows font path', () => {
  const filter = buildDrawtextFilter({ textFilePath: HOSTILE_TEXT_PATH, fontPath: WINDOWS_FONT })

  it('has exactly one drawtext= prefix', () => {
    expect(filter.startsWith('drawtext=')).toBe(true)
    const matches = filter.match(/drawtext=/g) || []
    expect(matches).toHaveLength(1)
  })

  it('normalizes the Windows font path (forward slashes + escaped drive colon)', () => {
    expect(filter).toContain('C\\\\:/Windows/Fonts/segoeui.ttf')
    expect(filter).not.toContain('C:\\Windows')
  })

  it('normalizes the Windows text file path (forward slashes + escaped drive colon)', () => {
    expect(filter).toContain('C\\\\:/Users/dev/clipforge/server/temp/watermark.txt')
  })

  it('emits the fontfile value with the normalized path and no quotes', () => {
    const fontMatch = filter.match(/fontfile=(.+?):fontsize/)
    expect(fontMatch).not.toBeNull()
    expect(fontMatch[1]).toBe('C\\\\:/Windows/Fonts/segoeui.ttf')
  })

  it('includes the default fontsize (18) and fontcolor (white@0.9)', () => {
    expect(filter).toContain('fontsize=18')
    expect(filter).toContain('fontcolor=white@0.9')
  })

  it('composes into the exact expected single filter string', () => {
    const expected =
      "drawtext=textfile=C\\\\:/Users/dev/clipforge/server/temp/watermark.txt:" +
      "fontfile=C\\\\:/Windows/Fonts/segoeui.ttf:fontsize=18:" +
      'fontcolor=white@0.9:box=1:boxcolor=black@0.4:x=(w-text_w)/2:y=h-th-36'
    expect(filter).toBe(expected)
  })
})

describe('buildDrawtextFilter — style options', () => {
  it('uses defaults fontsize=18 and fontcolor=white@0.9 when not provided', () => {
    const filter = buildDrawtextFilter({ textFilePath: 'text.txt', fontPath: '/usr/share/fonts/x.ttf' })
    expect(filter).toContain('fontsize=18')
    expect(filter).toContain('fontcolor=white@0.9')
  })

  it('applies overridden fontSize and fontColor', () => {
    const filter = buildDrawtextFilter({
      textFilePath: 'text.txt',
      fontPath: '/usr/share/fonts/x.ttf',
      fontSize: 42,
      fontColor: 'yellow@0.75',
    })
    expect(filter).toContain('fontsize=42')
    expect(filter).toContain('fontcolor=yellow@0.75')
    expect(filter).not.toContain('fontsize=18')
    expect(filter).not.toContain('fontcolor=white@0.9')
  })
})
