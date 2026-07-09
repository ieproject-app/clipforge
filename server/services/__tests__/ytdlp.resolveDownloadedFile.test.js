import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveDownloadedFile } from '../ytdlp.js'

// Unit tests for resolveDownloadedFile.
// Requirements: 3.1, 3.3
//
// resolveDownloadedFile(outputPathBase) reads the directory of outputPathBase,
// finds the single entry whose name is `<basename>.` + some extension, and
// returns its full path. yt-dlp writes with an `-o <base>.%(ext)s` template, so
// the real container may be .mp4, .mkv, .webm, etc. — the function must detect
// whatever was actually written rather than assuming .mp4 (Requirement 3.1).
// When no matching file exists it throws a descriptive error that names the
// expected missing output (Requirement 3.3).
//
// Each test creates a real temp directory and cleans it up afterwards.

describe('resolveDownloadedFile', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipforge-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('detects the actual downloaded container (Requirement 3.1)', () => {
    it('resolves a non-mp4 .webm file by base name', () => {
      fs.writeFileSync(path.join(tmpDir, 'source.webm'), 'fake video data')

      const resolved = resolveDownloadedFile(path.join(tmpDir, 'source'))

      expect(resolved).toBe(path.join(tmpDir, 'source.webm'))
      expect(resolved.endsWith('source.webm')).toBe(true)
    })

    it('resolves a .mkv file by base name', () => {
      fs.writeFileSync(path.join(tmpDir, 'source.mkv'), 'fake video data')

      const resolved = resolveDownloadedFile(path.join(tmpDir, 'source'))

      expect(resolved).toBe(path.join(tmpDir, 'source.mkv'))
      expect(resolved.endsWith('source.mkv')).toBe(true)
    })

    it('resolves an .mp4 file by base name', () => {
      fs.writeFileSync(path.join(tmpDir, 'source.mp4'), 'fake video data')

      const resolved = resolveDownloadedFile(path.join(tmpDir, 'source'))

      expect(resolved).toBe(path.join(tmpDir, 'source.mp4'))
    })
  })

  describe('throws when no matching file exists (Requirement 3.3)', () => {
    it('throws for an empty directory and names the expected output', () => {
      const base = path.join(tmpDir, 'source')

      expect(() => resolveDownloadedFile(base)).toThrow()
      // The error message references the expected missing output base path.
      expect(() => resolveDownloadedFile(base)).toThrow(/source/)
    })

    it('throws when only a non-matching base name is present', () => {
      // `other.mp4` does not start with `source.`, so it must not be matched.
      fs.writeFileSync(path.join(tmpDir, 'other.mp4'), 'fake video data')
      const base = path.join(tmpDir, 'source')

      expect(() => resolveDownloadedFile(base)).toThrow()
      expect(() => resolveDownloadedFile(base)).toThrow(/source/)
    })

    it('does not match a longer base name sharing the prefix', () => {
      // `source_2.mp4` shares the `source` prefix but is a different base;
      // it must not be matched because matching requires `source.` (dot).
      fs.writeFileSync(path.join(tmpDir, 'source_2.mp4'), 'fake video data')
      const base = path.join(tmpDir, 'source')

      expect(() => resolveDownloadedFile(base)).toThrow()
    })
  })
})
